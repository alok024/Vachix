/**
 * Observability
 *
 * Two concerns in one module:
 *
 * A. Sentry error tracking
 *   Captures unhandled exceptions and explicit error events with
 *   user context (id, plan) so you can filter by user in Sentry.
 *
 *   When SENTRY_DSN is not set (local dev), all functions are no-ops.
 *   Zero configuration required to run without Sentry.
 *
 *   Usage:
 *     captureException(err, { userId, plan, extra })
 *     capturePaymentException(err, { userId, plan, extra })  ← payment-tagged
 *     setUserContext(userId, plan)
 *
 *   ─── Sentry Alert Rules (configure: Sentry → Alerts → Create Alert Rule) ──
 *
 *   Rule 1 — Error spike
 *     Condition : Number of errors > 10 in 5 minutes
 *     Filter    : environment = production
 *     Action    : Email + Slack notification
 *     Catches   : Regressions, bot abuse, deploy breakage.
 *
 *   Rule 2 — New issue type (first occurrence)
 *     Condition : A new issue is created
 *     Filter    : environment = production
 *     Action    : Email notification
 *     Catches   : Crash types never seen before — the silent ones.
 *
 *   Rule 3 — Payment errors (revenue-impacting, tight threshold)
 *     Condition : Number of errors > 1 in 5 minutes
 *     Filter    : environment = production
 *                 tag payment = true  (set by capturePaymentException)
 *                 OR title contains "payment" OR "razorpay" OR "subscription"
 *     Action    : Immediate email + Slack
 *     Catches   : Missed webhooks, failed subscription state transitions.
 *   ─────────────────────────────────────────────────────────────────────────
 *
 * B. In-process metrics
 *   Lightweight counters/gauges that live in memory.  Exposed via
 *   GET /health/metrics (internal — not public-facing).
 *
 *   Why not Prometheus/Datadog yet?  You'd need a sidecar or hosted
 *   service.  These counters give you the same visibility for free
 *   today and are trivially replaced by a real metrics client later.
 *
 *   Tracked automatically (wired into ai.service.ts):
 *     ai.calls.total         — every attempt
 *     ai.calls.cached        — served from cache
 *     ai.calls.groq          — reached Groq
 *     ai.calls.openai        — fell back to OpenAI
 *     ai.calls.failed        — both providers failed
 *     ai.calls.timeout       — queue timeout (503)
 *     ai.burst.rejected      — 429 burst rejections
 *     ai.circuit.groq_open   — times Groq circuit opened
 *     ai.circuit.openai_open — times OpenAI circuit opened
 *
 *   Read them at runtime:
 *     import { getMetrics } from '../../infra/observability';
 */

import { logger } from './logger';
import { env }    from '../core/config/env';

const log = logger.child({ module: 'observability' });

// A. Sentry

type SentryLike = {
  init:            (opts: Record<string, unknown>) => void;
  captureException:(err: unknown, ctx?: Record<string, unknown>) => void;
  setUser:         (user: { id: string; [k: string]: unknown } | null) => void;
  withScope:       (cb: (scope: { setExtra: (k: string, v: unknown) => void }) => void) => void;
};

let _sentry: SentryLike | null = null;

/** Call once at app startup. No-op if SENTRY_DSN is missing. */
export async function initSentry(): Promise<void> {
  const dsn = env.SENTRY_DSN || undefined;
  if (!dsn) {
    log.info('Sentry not configured (SENTRY_DSN unset) — error tracking disabled');
    return;
  }

  try {
    // Dynamic import — Sentry is an optional peer dependency.
    // Install with:  npm install @sentry/node
    const Sentry = await import('@sentry/node') as unknown as SentryLike;
    Sentry.init({
      dsn,
      environment:     env.NODE_ENV,
      tracesSampleRate: env.SENTRY_TRACES_RATE,
      release:         env.VERSION,
    });
    _sentry = Sentry;
    log.info('Sentry initialised', { dsn: dsn.replace(/\/\/.*@/, '//***@') });
  } catch (err) {
    // Sentry not installed — continue silently
    log.warn('Sentry init skipped (@sentry/node not installed)', {
      hint: 'Run: npm install @sentry/node',
    });
  }
}

/** Report an error to Sentry with optional user/plan context. */
export function captureException(
  err:  unknown,
  ctx?: { userId?: string; plan?: string; extra?: Record<string, unknown> }
): void {
  if (!_sentry) return;

  try {
    _sentry.withScope(scope => {
      if (ctx?.extra) {
        Object.entries(ctx.extra).forEach(([k, v]) => scope.setExtra(k, v));
      }
      if (ctx?.userId) {
        scope.setExtra('userId', ctx.userId);
        scope.setExtra('plan',   ctx.plan ?? 'unknown');
      }
      _sentry!.captureException(err);
    });
  } catch {
    // Never let observability crash the app
  }
}

/** Attach user context to all subsequent Sentry events in this scope. */
export function setSentryUser(userId: string, plan: string): void {
  _sentry?.setUser({ id: userId, plan });
}

/**
 * Report a payment or subscription error to Sentry.
 *
 * Identical to captureException but adds a `payment = true` tag so
 * Sentry Alert Rule 3 (tight 1-error threshold) fires on these instead
 * of waiting for the generic 10-error spike. Call this from:
 *   - payment.service.ts  (webhook processing, subscription state changes)
 *   - payment.controller.ts  (order creation, verification)
 *
 * The tag is visible in Sentry under Issue → Tags → payment.
 */
export function capturePaymentException(
  err:  unknown,
  ctx?: { userId?: string; plan?: string; extra?: Record<string, unknown> }
): void {
  if (!_sentry) return;

  try {
    _sentry.withScope(scope => {
      // Tag that drives Sentry Alert Rule 3
      (scope as unknown as { setTag: (k: string, v: unknown) => void }).setTag('payment', true);
      if (ctx?.extra) {
        Object.entries(ctx.extra).forEach(([k, v]) => scope.setExtra(k, v));
      }
      if (ctx?.userId) {
        scope.setExtra('userId', ctx.userId);
        scope.setExtra('plan',   ctx.plan ?? 'unknown');
      }
      _sentry!.captureException(err);
    });
  } catch {
    // Never let observability crash the app
  }
}

// B. Metrics

type MetricKey =
  | 'ai.calls.total'
  | 'ai.calls.cached'
  | 'ai.calls.groq'
  | 'ai.calls.openai'
  | 'ai.calls.failed'
  | 'ai.calls.timeout'
  | 'ai.burst.rejected'
  | 'ai.circuit.groq_open'
  | 'ai.circuit.openai_open'
  | 'ai.system.overload'   // queue full → 503
  | 'ai.stream.groq'
  | 'ai.stream.openai';

const _counters: Record<string, number> = {};
const _startedAt = Date.now();

export function increment(key: MetricKey, by = 1): void {
  _counters[key] = (_counters[key] ?? 0) + by;
}

export function getMetrics(): {
  uptime_s:   number;
  counters:   Record<string, number>;
  rates:      Record<string, string>;
} {
  const uptime = (Date.now() - _startedAt) / 1000;
  const total  = _counters['ai.calls.total'] ?? 0;

  const rates: Record<string, string> = {};
  if (total > 0) {
    const pct = (key: string) =>
      ((((_counters[key] ?? 0) / total) * 100).toFixed(1) + '%');
    rates['cache_hit_rate']   = pct('ai.calls.cached');
    rates['groq_success_rate'] = pct('ai.calls.groq');
    rates['fallback_rate']    = pct('ai.calls.openai');
    rates['failure_rate']     = pct('ai.calls.failed');
  }

  return { uptime_s: Math.round(uptime), counters: { ..._counters }, rates };
}
