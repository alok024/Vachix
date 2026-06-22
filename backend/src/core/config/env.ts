/**
 * Environment configuration — Zod-validated at startup.
 *
 * All required vars cause process.exit(1) with a clear diagnostic if
 * missing or malformed. Numeric and boolean vars are coerced to their
 * native types — no more parseInt() / parseFloat() scattered across modules.
 *
 * Rule: import `env` from this file everywhere.
 *       Never read process.env directly anywhere else.
 */

import { z } from 'zod';

// Schema

const EnvSchema = z.object({

  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT:     z.coerce.number().int().positive().default(3000),

  // M1: app/release version, set at build time (e.g. via Docker ARG/ENV or
  // CI `--build-arg VERSION=$(git rev-parse --short HEAD)`). Replaces direct
  // process.env.npm_package_version reads, which bypass Zod validation and
  // are undefined in most Docker builds.
  VERSION: z.string().default('unknown'),

  // Supabase
  SUPABASE_URL:         z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  // M3: required in production. Falling back to SUPABASE_SERVICE_KEY
  // bypasses Row Level Security on every client-facing query, so this can
  // no longer be silently optional outside of local dev/test. Enforced
  // below via .superRefine() (needs NODE_ENV, which isn't known yet here).
  SUPABASE_ANON_KEY:    z.string().min(1).optional(),

  // Auth
  JWT_SECRET:         z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),

  // H3: secret used to HMAC-sign public report share tokens, preventing
  // anyone from forging a valid token for a session UUID they don't
  // already hold a legitimate token for.
  REPORT_SECRET: z.string().min(1),

  // AI providers
  GROQ_API_KEY:   z.string().min(1),
  OPENAI_API_KEY: z.string().default(''),

  // Voice (optional — browser TTS fallback when unset)
  ELEVENLABS_API_KEY:  z.string().default(''),
  ELEVENLABS_VOICE_ID: z.string().default('21m00Tcm4TlvDq8ikWAM'),

  // Voice — Hindi/Hinglish (Multi-language interview mode). ElevenLabs
  // above remains the English voice; Sarvam's Bulbul v3 model handles
  // Hindi/Hinglish (code-mixed text) natively, which ElevenLabs does not.
  // Optional — if unset, hi/hinglish TTS requests fall back to the
  // ElevenLabs voice (English-accented, but not a hard failure) and the
  // controller logs a warning so it's visible the Sarvam key is missing.
  SARVAM_API_KEY:      z.string().default(''),
  SARVAM_TTS_SPEAKER:  z.string().default('shubh'),  // valid bulbul:v3 speaker name
  SARVAM_TTS_MODEL:    z.string().default('bulbul:v3'),
  // When set to 'true', Sarvam is used as the primary TTS provider for ALL
  // languages (English included), with ElevenLabs as fallback. When 'false'
  // (default for backwards-compat), ElevenLabs remains primary for English
  // and Sarvam only handles hi/hinglish requests.
  // Feature: "Voice provider switch (Sarvam primary)" — vachix_b2c_build_plan §2.
  // 2026-06: Sarvam is now the default primary voice engine for all
  // languages (English included), per the pricing/voice-stack decision —
  // lower cost + native Hinglish support. ElevenLabs remains the
  // automatic fallback on Sarvam failure (see synthesizeSpeech() in
  // voice.controller.ts). Set to 'false' to revert to ElevenLabs-primary
  // for English without a code change.
  SARVAM_PRIMARY:      z.string().transform(v => v === 'true').default('true'),
  // Sarvam language code for English requests when SARVAM_PRIMARY=true.
  // Bulbul v3 supports en-IN natively for Indian-English accent.
  SARVAM_EN_LANG_CODE: z.string().default('en-IN'),

  // Razorpay — live keys (required)
  RAZORPAY_KEY_ID:         z.string().min(1),
  RAZORPAY_KEY_SECRET:     z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),

  // Razorpay — test-mode keys (optional)
  RAZORPAY_TEST_KEY_ID:         z.string().default(''),
  RAZORPAY_TEST_KEY_SECRET:     z.string().default(''),
  RAZORPAY_TEST_WEBHOOK_SECRET: z.string().default(''),

  // URLs
  FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL').default('https://vachix.in'),

  // Fix (M2): Vercel preview deployments use dynamic subdomain URLs like
  // vachixindia-git-fix-branch-xyz.vercel.app which can't be hardcoded
  // in PROD_ORIGINS. EXTRA_ALLOWED_ORIGINS is a comma-separated list of
  // additional origins to whitelist at runtime — set it in Railway/env to
  // add preview URLs without a code deploy. Examples:
  //   EXTRA_ALLOWED_ORIGINS=https://vachixindia-pr-42.vercel.app
  //   EXTRA_ALLOWED_ORIGINS=https://preview.vachix.in,https://staging.vachix.in
  EXTRA_ALLOWED_ORIGINS: z.string().default(''),

  // Email / notifications
  RESEND_API_KEY:    z.string().default(''),
  EMAIL_FROM:        z.string().default(''),
  // Comma-separated list of recipients for internal B2B lead alerts.
  LEAD_NOTIFY_EMAIL: z.string().default(''),

  // Redis
  REDIS_URL: z.string().default(''),

  // Observability
  SENTRY_DSN:         z.string().default(''),
  SENTRY_TRACES_RATE: z.coerce.number().min(0).max(1).default(0.1),
  METRICS_TOKEN:      z.string().default(''),

  // AI rate-limiting / concurrency
  // All coerced to their native type — no more parseInt() at call sites.
  SYSTEM_MAX_RPM:          z.coerce.number().int().positive().default(60),
  // Treated as true unless the string is exactly "false".
  SYSTEM_SHED_ENABLED:     z.string().transform(v => v !== 'false').default('true'),
  MAX_CONCURRENT_AI_CALLS: z.coerce.number().int().positive().default(10),
  AI_QUEUE_TIMEOUT_MS:     z.coerce.number().int().positive().default(30_000),
  AI_BURST_LIMIT:          z.coerce.number().int().positive().default(3),
  AI_BURST_WINDOW_MS:      z.coerce.number().int().positive().default(10_000),
  // Total estimated prompt tokens (system + conversation history) the
  // sliding-window trimmer in core/utils/tokens.ts will allow through to
  // the provider, after reserving room for the response (max_tokens).
  // Keeps a 100-message / 32K-char-per-message conversation from blowing
  // past the model's usable context window.
  AI_CONTEXT_TOKEN_BUDGET: z.coerce.number().int().positive().default(8_000),
  // Optional — per-type TTLs apply when absent.
  AI_CACHE_TTL_SECONDS:    z.coerce.number().int().nonnegative().optional(),
  // Fix (S1): TTL for the per-session assembled system-prompt cache
  // (memory + weak-areas + adaptive + onboarding), keyed by session_id.
  // Sessions rarely run longer than ~20-30 min; default gives headroom
  // without keeping stale personalisation context around indefinitely.
  AI_PROMPT_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  CB_FAILURE_THRESHOLD:    z.coerce.number().int().positive().default(5),
  CB_RESET_TIMEOUT_MS:     z.coerce.number().int().positive().default(60_000),
  REFERRAL_BONUS_CALLS:    z.coerce.number().int().nonnegative().default(10),
  // Fix (H5): hard ceiling on accumulated referral_bonus per user. Without
  // this, a coordinated abuse pattern (disposable accounts all referring one
  // account, each completing a single session) grants unlimited free AI
  // calls. Enforced atomically inside the increment_referral_bonus RPC
  // (see migrations/007_referral_bonus_cap.sql) via LEAST(), not in app
  // code, so concurrent reward grants can't race past the cap.
  MAX_REFERRAL_BONUS_CALLS: z.coerce.number().int().positive().default(50),

  // Voice usage ledger (migration 011)
  // Per-plan monthly voice caps (seconds). -1 = unlimited.
  // free:    no voice (gated by requireVoiceTier in voice.routes.ts)
  // starter: 600 s = 10 min  (enough for ~20 short TTS calls)
  // pro:     3600 s = 60 min
  // elite:   -1   = unlimited
  VOICE_CAP_STARTER:       z.coerce.number().int().default(600),
  VOICE_CAP_PRO:           z.coerce.number().int().default(3600),
  // Hard ceiling on streak-milestone bonus voice seconds a user can
  // accumulate. Enforced via LEAST() inside the RPC (same as referral cap).
  MAX_BONUS_VOICE_SECONDS: z.coerce.number().int().positive().default(3600),
  // Bonus seconds awarded per streak milestone (7 / 14 / 21 / etc.)
  STREAK_VOICE_BONUS_SECS: z.coerce.number().int().nonnegative().default(300),
  // Sarvam circuit breaker — prevents hammering a downed Sarvam with full
  // traffic. After FAILURE_THRESHOLD consecutive failures the breaker opens
  // (routes straight to ElevenLabs). After COOLDOWN_MS it half-opens and
  // probes Sarvam with one request; success closes the breaker immediately.
  SARVAM_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(3),
  SARVAM_BREAKER_COOLDOWN_MS:       z.coerce.number().int().positive().default(15_000),
}).superRefine((data, ctx) => {
  // M3: SUPABASE_ANON_KEY must be set in production — the silent fallback
  // to SUPABASE_SERVICE_KEY bypasses Row Level Security. Dev/test environments
  // can still omit it for local convenience.
  if (data.NODE_ENV === 'production' && !data.SUPABASE_ANON_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SUPABASE_ANON_KEY'],
      message:
        "SUPABASE_ANON_KEY is required in production. Set it to your Supabase project's " +
        'anon/public key — falling back to the service-role key would bypass Row Level Security.',
    });
  }
});

// Parse & fail fast

const _result = EnvSchema.safeParse(process.env);

if (!_result.success) {
  const issues = _result.error.issues
    .map(i => `  • ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n❌  Environment validation failed:\n${issues}\n`);
  process.exit(1);
}

const _parsed = _result.data;

// Derived keys
// M3: production builds can no longer reach this fallback — superRefine
// above fails fast at startup if SUPABASE_ANON_KEY is missing in prod.
// In dev/test, it's still convenient to omit it and fall back to the
// service-role key, with a loud one-time warning so the gap stays visible.
const _resolvedAnonKey: string = (() => {
  if (!_parsed.SUPABASE_ANON_KEY) {
    // eslint-disable-next-line no-console
    console.warn(
      '⚠️  SUPABASE_ANON_KEY is not set — falling back to SUPABASE_SERVICE_KEY. ' +
      "This bypasses Row Level Security. Set SUPABASE_ANON_KEY to your project's anon/public key. " +
      '(Allowed in dev/test only — production fails to start without it.)'
    );
    return _parsed.SUPABASE_SERVICE_KEY;
  }
  return _parsed.SUPABASE_ANON_KEY;
})();

// Exports

export const env = {
  ..._parsed,
  // Override the optional field with its resolved (always-string) value.
  SUPABASE_ANON_KEY:         _resolvedAnonKey,
  // Alias used by any callers that reference the Supabase service-role key name.
  SUPABASE_SERVICE_ROLE_KEY: _parsed.SUPABASE_SERVICE_KEY,
};

/** Inferred type of the validated environment — import where needed for typing. */
export type Env = typeof env;

export const IS_PROD = env.NODE_ENV === 'production';

// 2026-06: 'starter' (₹299/mo, 30 sessions) is a fully integrated tier —
// exposed in the landing page pricing section, the in-app upgrade modal,
// and the billing flow (vachix_b2c_build_plan(1).md §2 "Starter tier
// (full integration)"). Every PLAN_LIMITS/PLAN_PRICES consumer below
// resolves dynamically by key, so this has applied to real Starter
// subscribers since launch — no per-feature opt-in needed here.
export type PlanType = 'free' | 'starter' | 'pro' | 'elite';

/** -1 = unlimited */
export const PLAN_LIMITS: Record<PlanType, { ai_calls: number }> = {
  free:    { ai_calls: 7 },    // returned to the client via usage.limit in /me
  starter: { ai_calls: 30 },
  pro:     { ai_calls: -1 },
  elite:   { ai_calls: -1 },
};

/**
 * In paise (INR × 100).
 * 2026-06 locked pricing (vachix_b2c_build_plan(1).md §1):
 *   Starter ₹299 · Pro ₹299→₹699 · Elite ₹599→₹1,299
 */
export const PLAN_PRICES: Record<'starter' | 'pro' | 'elite', number> = {
  starter: 29900,   // ₹299
  pro:     69900,   // ₹699  (was ₹299)
  elite:   129900,  // ₹1,299 (was ₹599)
};
