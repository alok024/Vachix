/**
 * Sarvam TTS Circuit Breaker
 *
 * Prevents per-request Sarvam→ElevenLabs fallback overhead during a real
 * Sarvam outage. Without this, every single TTS call during an outage pays
 * the cost of a failed Sarvam HTTP call (timeout + latency) before reaching
 * ElevenLabs. With it, after FAILURE_THRESHOLD consecutive failures the
 * breaker opens and requests skip Sarvam entirely until it recovers.
 *
 * States:
 *   closed (normal)    — every request tries Sarvam first.
 *   open               — Sarvam is down; route straight to ElevenLabs.
 *   half_open (probe)  — one request probes Sarvam. Success → closed
 *                        immediately. Failure → open for another cooldown.
 *
 * Redis-backed so state is shared across all horizontal instances. Fails
 * open if Redis is unavailable — degrading to per-request fallback rather
 * than blocking a paying user's voice call (matches burst-limiter.ts).
 *
 * Threshold: SARVAM_BREAKER_FAILURE_THRESHOLD (default 3)
 *   — 1 is too twitchy (one network blip trips it), 5 means 5 users all
 *   eat a failed Sarvam call before the breaker even engages.
 *
 * Cooldown: SARVAM_BREAKER_COOLDOWN_MS (default 15 000 ms)
 *   — Short enough to count as "minimum possible"; the half-open probe
 *   closes the breaker the moment Sarvam is actually back, so real
 *   recovery is faster than the cooldown in practice.
 *
 * Failure counter TTL: 5 minutes (FAILURE_COUNT_TTL_S). A consecutive-
 * failure window that resets on every success prevents isolated blips
 * hours apart from slowly accumulating toward the threshold.
 */

import { getRedis } from './queue/redis';
import { env }      from '../core/config/env';
import { logger }   from './logger';

const log = logger.child({ module: 'sarvam-breaker' });

// Redis key names
const FAILURE_COUNT_KEY = 'sarvam:cb:failure_count';
const OPENED_AT_KEY     = 'sarvam:cb:opened_at';
const PROBE_CLAIM_KEY   = 'sarvam:cb:probe_claim';

const FAILURE_COUNT_TTL_S = 300; // 5-minute rolling window for consecutive failures
const PROBE_CLAIM_TTL_MS  = 5_000; // probe lock expires in 5 s (protects against stuck claims)

type BreakerDecision =
  | { state: 'closed' }
  | { state: 'open' }
  | { state: 'half_open_probe' };   // this request is the probe

/**
 * Consult the breaker before attempting a Sarvam call.
 * - closed       → caller should try Sarvam.
 * - open         → caller should skip Sarvam entirely.
 * - half_open_probe → caller should try Sarvam; outcome MUST be reported
 *                     via recordSuccess() or recordFailure() afterwards.
 *
 * Fails open (returns closed) on Redis errors.
 */
export async function checkBreaker(): Promise<BreakerDecision> {
  const redis = getRedis();
  if (!redis) return { state: 'closed' }; // no Redis → fail open

  try {
    const openedAt = await redis.get(OPENED_AT_KEY);

    if (!openedAt) {
      // Breaker is closed — normal operation
      return { state: 'closed' };
    }

    const elapsed = Date.now() - Number(openedAt);
    if (elapsed < env.SARVAM_BREAKER_COOLDOWN_MS) {
      // Still within cooldown — stay open
      return { state: 'open' };
    }

    // Cooldown elapsed — attempt to claim the half-open probe slot atomically.
    // SET NX means only one concurrent request wins the probe; the rest see
    // the key already set and still return 'open' so they skip Sarvam.
    const claimed = await redis.set(
      PROBE_CLAIM_KEY, '1',
      'PX', PROBE_CLAIM_TTL_MS,
      'NX'
    );

    return claimed ? { state: 'half_open_probe' } : { state: 'open' };
  } catch (err) {
    log.warn('sarvam-breaker: Redis check failed — failing open', {
      error: (err as Error).message,
    });
    return { state: 'closed' };
  }
}

/**
 * Record a successful Sarvam call. Resets the failure counter regardless
 * of whether this was a probe or a normal closed-state call — every
 * success clears the slate so the threshold truly means "consecutive"
 * failures, not "failures in a rolling window with intervening successes".
 */
export async function recordSuccess(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.del(FAILURE_COUNT_KEY, OPENED_AT_KEY, PROBE_CLAIM_KEY);
  } catch (err) {
    log.warn('sarvam-breaker: recordSuccess failed (non-fatal)', {
      error: (err as Error).message,
    });
  }
}

/**
 * Record a failed Sarvam call. Increments the failure counter; if the
 * counter reaches the threshold, opens the breaker.
 *
 * For a probe failure (state was half_open_probe): re-opens the breaker
 * by refreshing OPENED_AT_KEY so the cooldown restarts from now.
 */
export async function recordFailure(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    const count = await redis.incr(FAILURE_COUNT_KEY);
    // Set/refresh TTL on the counter so isolated failures don't accumulate
    // indefinitely — they expire after FAILURE_COUNT_TTL_S seconds.
    await redis.expire(FAILURE_COUNT_KEY, FAILURE_COUNT_TTL_S);

    if (count >= env.SARVAM_BREAKER_FAILURE_THRESHOLD) {
      // Trip or re-trip the breaker (covers both closed→open and
      // half_open_probe→open after a failed probe)
      await redis.set(OPENED_AT_KEY, String(Date.now()));
      await redis.del(PROBE_CLAIM_KEY); // clear any stale probe claim
      log.warn('sarvam-breaker: breaker OPENED', {
        consecutiveFailures: count,
        threshold: env.SARVAM_BREAKER_FAILURE_THRESHOLD,
        cooldownMs: env.SARVAM_BREAKER_COOLDOWN_MS,
      });
    }
  } catch (err) {
    log.warn('sarvam-breaker: recordFailure failed (non-fatal)', {
      error: (err as Error).message,
    });
  }
}
