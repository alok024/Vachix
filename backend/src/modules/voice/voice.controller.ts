import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { env } from '../../core/config/env';
import { badRequest, fail } from '../../core/utils/response';
import { getRedis } from '../../infra/queue/redis';
import { logger } from '../../infra/logger';
import { debitVoiceSeconds } from './voice.ledger';
import {
  checkBreaker,
  recordSuccess,
  recordFailure,
} from '../../infra/sarvam-circuit-breaker';

const log = logger.child({ module: 'voice' });

type VoiceLang = 'en' | 'hi' | 'hinglish';

// Shared ElevenLabs call — used by both the full Pro/Elite TTS route and
// the free-tier warm-up route below. Streams the response straight
// through to `res` rather than buffering, same as the original /tts
// handler.
//
// Returns true if audio was successfully written to `res`, false if the
// upstream failed and an error response was written instead. Mirrors the
// contract of streamSarvamSpeech so callers can use the return value
// directly rather than inspecting res.writableEnded (which is true for
// both success and failure and therefore cannot distinguish them).
async function streamElevenLabsSpeech(res: Response, text: string): Promise<boolean> {
  const elRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': env.ELEVENLABS_API_KEY,
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );

  if (!elRes.ok || !elRes.body) {
    fail(res, 502, 'tts_upstream_failed', 'The text-to-speech service failed to respond.');
    return false;
  }

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');

  const reader = elRes.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
  return true;
}

// Sarvam Bulbul v3 — Hindi/Hinglish voice (Multi-language interview mode).
// ElevenLabs above doesn't handle Hindi/Hinglish (code-mixed) text well;
// Bulbul v3 is purpose-built for it. API: POST /text-to-speech, response
// is JSON with a base64-encoded WAV in `audios[0]` (not a byte stream),
// so this buffers and decodes rather than piping like the ElevenLabs path.
// See https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/text-to-speech/rest-api
//
// When env.SARVAM_PRIMARY=true, this function is also called for English
// with lang_code=en-IN (Indian-English accent on Bulbul v3).
//
// Returns true if it successfully wrote the response, false if the
// caller should fall back to another engine. On false, this function is
// guaranteed not to have written anything to `res` yet — safe to retry
// with a different engine.
async function streamSarvamSpeech(res: Response, text: string, langCode: string): Promise<boolean> {
  if (!env.SARVAM_API_KEY) return false;

  // `Response` in this file's scope is Express's type (imported above for
  // the `res` parameter) — alias the global Fetch API Response so the
  // Sarvam HTTP call below is typed correctly rather than against Express's.
  let sarvamRes: globalThis.Response;
  try {
    sarvamRes = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': env.SARVAM_API_KEY,
      },
      body: JSON.stringify({
        text,
        // langCode is caller-supplied: 'hi-IN' for Hindi/Hinglish (original
        // behaviour), 'en-IN' for English when SARVAM_PRIMARY=true.
        target_language_code: langCode,
        model:   env.SARVAM_TTS_MODEL,
        speaker: env.SARVAM_TTS_SPEAKER,
      }),
    });
  } catch (err) {
    log.warn('Sarvam TTS request failed — falling back', { error: (err as Error).message });
    return false;
  }

  if (!sarvamRes.ok) {
    const errBody = await sarvamRes.text().catch(() => '');
    log.warn('Sarvam TTS returned an error — falling back', {
      status: sarvamRes.status, error: errBody.slice(0, 300),
    });
    return false;
  }

  let audioBase64: string | undefined;
  try {
    const json = await sarvamRes.json() as { audios?: string[] };
    audioBase64 = json.audios?.[0];
  } catch (err) {
    log.warn('Sarvam TTS response was not valid JSON — falling back', { error: (err as Error).message });
    return false;
  }

  if (!audioBase64) {
    log.warn('Sarvam TTS returned no audio — falling back');
    return false;
  }

  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'no-store');
  res.end(Buffer.from(audioBase64, 'base64'));
  return true;
}

// Picks the right engine for the requested language, consulting the Sarvam
// circuit breaker before attempting a Sarvam call.
//
// Returns true if audio was successfully streamed to `res`, false if an
// error response was written instead (e.g. both engines failed). The caller
// uses this to decide whether to debit the voice ledger — a failed upstream
// call must never burn the user's quota.
//
// SARVAM_PRIMARY defaults to true as of 2026-06 (Sarvam is now the
// primary voice engine for all languages, English included):
// All languages try Sarvam first. English uses lang_code=en-IN (Indian-English
// accent on Bulbul v3). ElevenLabs is the fallback if Sarvam fails or is
// down. The circuit breaker short-circuits the Sarvam attempt during an
// outage so users don't pay Sarvam's failure latency on every call.
//
// When SARVAM_PRIMARY=false (legacy, opt-out):
// English always uses ElevenLabs. Hindi/Hinglish try Sarvam first, falling
// back to ElevenLabs. No circuit breaker on this path (non-primary).
async function synthesizeSpeech(res: Response, text: string, lang: VoiceLang): Promise<boolean> {
  if (env.SARVAM_PRIMARY) {
    // Consult the breaker before making the Sarvam call
    const decision = await checkBreaker();

    if (decision.state === 'open') {
      // Breaker is open — Sarvam is known-down; skip straight to ElevenLabs.
      // streamElevenLabsSpeech now returns a boolean success flag; use it
      // directly rather than inspecting res.writableEnded, which is true in
      // both the success and failure cases and cannot distinguish them.
      log.info('Sarvam-primary: breaker open — skipping Sarvam, using ElevenLabs', { lang });
      return streamElevenLabsSpeech(res, text.slice(0, 2000));
    }

    const langCode = lang === 'en' ? env.SARVAM_EN_LANG_CODE : 'hi-IN';
    const handled  = await streamSarvamSpeech(res, text, langCode);

    if (handled) {
      // Success — reset the failure counter (works for both closed and half_open_probe)
      await recordSuccess();
      return true;
    }

    // Sarvam failed — record the failure (may trip the breaker)
    await recordFailure();

    log.info('Sarvam-primary: falling back to ElevenLabs', {
      lang,
      wasProbe: decision.state === 'half_open_probe',
    });
    // Re-clip: text was sized for Sarvam's 2500-char limit; ElevenLabs
    // only accepts 2000. A 2500-char input causes a 400/422 upstream.
    return streamElevenLabsSpeech(res, text.slice(0, 2000));
  }

  // Legacy path: ElevenLabs primary for English, Sarvam primary for hi/hinglish
  if (lang !== 'en') {
    const handled = await streamSarvamSpeech(res, text, 'hi-IN');
    if (handled) return true;
    log.info('Falling back to ElevenLabs for non-English TTS request', { lang });
  }
  return streamElevenLabsSpeech(res, text);
}

// POST /api/voice/tts
// Body: { text: string, lang?: 'en' | 'hi' | 'hinglish' }
// Returns: an audio stream (audio/mpeg via ElevenLabs for English,
// audio/wav via Sarvam for Hindi/Hinglish).
// If neither provider is configured for the requested language, returns
// 501 so the frontend can fall back to the browser's built-in speechSynthesis.
export const textToSpeech = asyncHandler(async (req: Request, res: Response) => {
  const { text, lang = 'en' } = req.body as { text?: string; lang?: VoiceLang };
  const userId = req.user!.id;

  if (!text || !text.trim()) {
    badRequest(res, 'text is required', 'text_required');
    return;
  }
  if (!env.ELEVENLABS_API_KEY && !(lang !== 'en' && env.SARVAM_API_KEY) && !(env.SARVAM_PRIMARY && env.SARVAM_API_KEY)) {
    fail(res, 501, 'voice_not_configured', 'Voice synthesis is not configured on this server.');
    return;
  }

  // Clip to the primary engine's limit. When SARVAM_PRIMARY is true, all
  // languages (English included) go to Sarvam first (2500-char limit).
  // When SARVAM_PRIMARY is false, English goes directly to ElevenLabs (2000-char
  // limit). The Sarvam→ElevenLabs fallback inside synthesizeSpeech re-clips
  // to 2000 at the actual call site, so we don't under-serve Sarvam by
  // pre-clipping English to ElevenLabs' lower limit here.
  const clipped = text.slice(0, env.SARVAM_PRIMARY
    ? 2500                        // Sarvam Bulbul v3 limit (all langs)
    : lang === 'en' ? 2000 : 2500 // legacy: ElevenLabs for en, Sarvam for hi
  );
  const streamed = await synthesizeSpeech(res, clipped, lang);

  // Only debit if audio was actually streamed — a failed upstream call
  // (both engines down) must never burn the user's monthly quota.
  if (streamed) {
    // Estimate: ~0.05 s of speech per character (natural English pace ≈ 140 wpm,
    // ~5 chars/word → 700 chars/min → 1 char ≈ 86 ms; we use 50 ms as a
    // conservative estimate that holds for faster-paced Hindi/Hinglish too).
    const estimatedSecs = Math.max(1, Math.round(clipped.length * 0.05));
    debitVoiceSeconds(userId, estimatedSecs, 'voice');
  }
});

// Voice "warm-up"md).
// Lets a Free-tier user hear ~30s of Aria/Elara's HD voice once a day,
// as a taste of the paid voice feature, without requiring requireVoiceTier.
//
// Safeguards (reusing existing infra only — no new schema/table):
// - Hard character cap (~450 chars ≈ 30s of speech at natural pace)
// regardless of what the client sends.
// - Once-per-IST-calendar-day per user, tracked as a single Redis key
// with a TTL — same pattern as the prompt-context cache in
// ai.prompt-service.ts. Redis unavailable → fails open (allows the
// request) rather than blocking a legitimate free-tier user; this
// mirrors the burst-limiter's fail-open behaviour.
const WARMUP_CHAR_CAP = 450;
const WARMUP_KEY = (userId: string) => {
  const istDate = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `voice:warmup:${userId}:${istDate}`;
};

export const textToSpeechWarmup = asyncHandler(async (req: Request, res: Response) => {
  const { text } = req.body as { text?: string };
  const userId = req.user!.id;

  if (!text || !text.trim()) {
    badRequest(res, 'text is required', 'text_required');
    return;
  }
  if (!env.ELEVENLABS_API_KEY) {
    fail(res, 501, 'voice_not_configured', 'Voice synthesis is not configured on this server.');
    return;
  }

  const redis = getRedis();
  let warmupKeySet: string | null = null;
  if (!redis) {
    // Redis is required to enforce the once-per-day free cap.
    // Allowing through when Redis is down lets free users get unlimited
    // warmup calls during any outage. Fail closed instead.
    fail(res, 503, 'voice_warmup_unavailable', 'Voice preview is temporarily unavailable. Please try again shortly.');
    return;
  }
  try {
    const key = WARMUP_KEY(userId);
    const alreadyUsed = await redis.get(key);
    if (alreadyUsed) {
      fail(res, 429, 'warmup_already_used', "You've already heard today's free voice preview — upgrade to Pro for unlimited HD voice.");
      return;
    }
    // Set the flag before streaming so a slow/aborted response can't be
    // retried into multiple free plays — set first, stream second.
    await redis.set(key, '1', 'EX', 26 * 60 * 60); // a little over 24h, covers IST/UTC date-boundary skew
    warmupKeySet = key;
  } catch (err) {
    log.warn('Voice warm-up: Redis check failed — blocking request (fail-closed)', {
      userId, error: (err as Error).message,
    });
    fail(res, 503, 'voice_warmup_unavailable', 'Voice preview is temporarily unavailable. Please try again shortly.');
    return;
  }

  const clipped = text.slice(0, WARMUP_CHAR_CAP);
  try {
    await streamElevenLabsSpeech(res, clipped);
  } catch (err) {
    // a failed TTS call must not permanently burn the user's one
    // daily free preview — roll back the warm-up flag so they can retry.
    if (warmupKeySet && redis) {
      try {
        await redis.del(warmupKeySet);
      } catch (delErr) {
        log.warn('Voice warm-up: failed to roll back flag after TTS failure', {
          userId, error: (delErr as Error).message,
        });
      }
    }
    throw err;
  }
});
