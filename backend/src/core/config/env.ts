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

// ── Schema ────────────────────────────────────────────────────────

const EnvSchema = z.object({

  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT:     z.coerce.number().int().positive().default(3000),

  // M1: app/release version, set at build time (e.g. via Docker ARG/ENV or
  // CI `--build-arg VERSION=$(git rev-parse --short HEAD)`). Replaces direct
  // process.env.npm_package_version reads, which bypass Zod validation and
  // are undefined in most Docker builds.
  VERSION: z.string().default('unknown'),

  // ─── Supabase ─────────────────────────────────────────────────
  SUPABASE_URL:         z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  // Optional: falls back to SERVICE_KEY at runtime with a warning.
  // Set to your Supabase project's anon/public key so RLS is enforced
  // on client-facing queries.  See derived-key resolution below.
  SUPABASE_ANON_KEY:    z.string().min(1).optional(),

  // ─── Auth ─────────────────────────────────────────────────────
  JWT_SECRET:         z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),

  // ─── AI providers ─────────────────────────────────────────────
  GROQ_API_KEY:   z.string().min(1),
  OPENAI_API_KEY: z.string().default(''),

  // ─── Voice (optional — browser TTS fallback when unset) ───────
  ELEVENLABS_API_KEY:  z.string().default(''),
  ELEVENLABS_VOICE_ID: z.string().default('21m00Tcm4TlvDq8ikWAM'),

  // ─── Razorpay — live keys (required) ─────────────────────────
  RAZORPAY_KEY_ID:         z.string().min(1),
  RAZORPAY_KEY_SECRET:     z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),

  // ─── Razorpay — test-mode keys (optional) ────────────────────
  RAZORPAY_TEST_KEY_ID:         z.string().default(''),
  RAZORPAY_TEST_KEY_SECRET:     z.string().default(''),
  RAZORPAY_TEST_WEBHOOK_SECRET: z.string().default(''),

  // ─── URLs ─────────────────────────────────────────────────────
  FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL').default('https://vachix.in'),

  // FIX M2: Vercel preview deployments use dynamic subdomain URLs like
  // vachixindia-git-fix-branch-xyz.vercel.app which can't be hardcoded
  // in PROD_ORIGINS. EXTRA_ALLOWED_ORIGINS is a comma-separated list of
  // additional origins to whitelist at runtime — set it in Railway/env to
  // add preview URLs without a code deploy. Examples:
  //   EXTRA_ALLOWED_ORIGINS=https://vachixindia-pr-42.vercel.app
  //   EXTRA_ALLOWED_ORIGINS=https://preview.vachix.in,https://staging.vachix.in
  EXTRA_ALLOWED_ORIGINS: z.string().default(''),

  // ─── Email / notifications ────────────────────────────────────
  RESEND_API_KEY:    z.string().default(''),
  EMAIL_FROM:        z.string().default(''),
  // Comma-separated list of recipients for internal B2B lead alerts.
  LEAD_NOTIFY_EMAIL: z.string().default(''),

  // ─── Redis ────────────────────────────────────────────────────
  REDIS_URL: z.string().default(''),

  // ─── Observability ────────────────────────────────────────────
  SENTRY_DSN:         z.string().default(''),
  SENTRY_TRACES_RATE: z.coerce.number().min(0).max(1).default(0.1),
  METRICS_TOKEN:      z.string().default(''),

  // ─── AI rate-limiting / concurrency ──────────────────────────
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
  CB_FAILURE_THRESHOLD:    z.coerce.number().int().positive().default(5),
  CB_RESET_TIMEOUT_MS:     z.coerce.number().int().positive().default(60_000),
  REFERRAL_BONUS_CALLS:    z.coerce.number().int().nonnegative().default(10),
});

// ── Parse & fail fast ─────────────────────────────────────────────

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

// ── Derived keys ──────────────────────────────────────────────────
// SUPABASE_ANON_KEY falls back to SERVICE_KEY with a loud warning when
// unset, preserving backward compat while making the misconfiguration
// visible.  Warning fires once at module load — not on every call.
const _resolvedAnonKey: string = (() => {
  if (!_parsed.SUPABASE_ANON_KEY) {
    // eslint-disable-next-line no-console
    console.warn(
      '⚠️  SUPABASE_ANON_KEY is not set — falling back to SUPABASE_SERVICE_KEY. ' +
      "This bypasses Row Level Security. Set SUPABASE_ANON_KEY to your project's anon/public key."
    );
    return _parsed.SUPABASE_SERVICE_KEY;
  }
  return _parsed.SUPABASE_ANON_KEY;
})();

// ── Exports ───────────────────────────────────────────────────────

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

export type PlanType = 'free' | 'pro' | 'elite';

/** -1 = unlimited */
export const PLAN_LIMITS: Record<PlanType, { ai_calls: number }> = {
  free:  { ai_calls: 7 },   // returned to the client via usage.limit in /me
  pro:   { ai_calls: -1 },
  elite: { ai_calls: -1 },
};

/** In paise (INR × 100) */
export const PLAN_PRICES: Record<'pro' | 'elite', number> = {
  pro:   29900,  // ₹299
  elite: 59900,  // ₹599
};
