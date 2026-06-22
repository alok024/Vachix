import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authMiddleware, requireVerified, requireVoiceTier, validate } from '../../core/middleware';
import { textToSpeech, textToSpeechWarmup } from './voice.controller';
import { requireVoiceQuota } from './voice.ledger';

const router = Router();

// 30 TTS calls/minute per IP — generous for legitimate use, blocks script abuse
const ttsLimiter = rateLimit({
  windowMs: 60_000,
  max:      30,
  message:  { error: 'Too many TTS requests. Please wait a moment.' },
});

// Separate, tighter limiter for the free-tier warm-up route — it's
// already capped to once/day per user server-side (see the Redis check
// in voice.controller.ts), this is just defence against retry storms.
const warmupLimiter = rateLimit({
  windowMs: 60_000,
  max:      5,
  message:  { error: 'Too many requests. Please wait a moment.' },
});

// Multi-language interview mode — Sarvam's Bulbul v3 caps at 2500 chars
// (vs ElevenLabs' 2000); the controller clips per-engine, this schema
// just needs to allow the larger of the two through.
const TtsSchema = z.object({
  text: z.string().min(1).max(2500),
  lang: z.enum(['en', 'hi', 'hinglish']).optional(),
});

const WarmupSchema = z.object({
  text: z.string().min(1).max(2500), // controller clips to ~450 chars regardless
});

router.post('/tts',
  authMiddleware,
  requireVerified,
  requireVoiceTier,  // 🔒 Starter/Pro/Elite — free users get browser speechSynthesis
  requireVoiceQuota, // 🔒 monthly voice-minute cap (ledger gate — migration 011)
  ttsLimiter,
  validate(TtsSchema),
  textToSpeech,
);

// Voice "warm-up" — Easy build item. Available to Free-tier users too
// (intentionally no requireVoiceTier), gated instead by a once-per-IST-day
// Redis check inside the controller.
router.post('/tts/warmup',
  authMiddleware,
  requireVerified,
  warmupLimiter,
  validate(WarmupSchema),
  textToSpeechWarmup,
);

export default router;
