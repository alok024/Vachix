/**
 * features/voice/api/index.ts
 *
 * HTTP calls for text-to-speech playback during live interview sessions.
 *
 * Returns a Blob directly rather than going through `apiCall`/ApiResult,
 * since the response is audio, not JSON.
 */
export type VoiceLang = 'en' | 'hi' | 'hinglish';

export type WarmupResult =
  | { ok: true; blob: Blob }
  | { ok: false; reason: 'already_used_today' | 'not_configured' | 'error' };

export const voiceApi = {
  // Starter/Pro/Elite — real (ledger-metered) TTS. `lang` selects ElevenLabs
  // (en) vs Sarvam Bulbul v3 (hi/hinglish); omit for English-only behaviour.
  tts: async (text: string, lang?: VoiceLang): Promise<Blob | null> => {
    try {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lang ? { text, lang } : { text }),
      });
      if (!res.ok) return null;
      return res.blob();
    } catch {
      return null;
    }
  },

  // Free-tier — one ~30s HD voice preview per IST day. The result is
  // tagged so callers can show "come back tomorrow" for the expected
  // 429 (warmup_already_used) rather than a generic error message —
  // see voice.controller.ts's textToSpeechWarmup for the status codes.
  ttsWarmup: async (text: string): Promise<WarmupResult> => {
    try {
      const res = await fetch('/api/voice/tts/warmup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) return { ok: true, blob: await res.blob() };

      if (res.status === 429) return { ok: false, reason: 'already_used_today' };
      if (res.status === 501) return { ok: false, reason: 'not_configured' };
      return { ok: false, reason: 'error' };
    } catch {
      return { ok: false, reason: 'error' };
    }
  },
};
