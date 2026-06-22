/**
 * Queue Dispatcher
 *
 * The ONLY file the rest of the app imports to enqueue work.
 * sessions.service.ts and app.ts call this — never BullMQ directly.
 *
 * Degradation contract:
 *   REDIS_URL set   → job goes to BullMQ queue (retry, backoff, worker)
 *   REDIS_URL unset → job runs inline, fire-and-forget (current dev behaviour)
 *
 * This means your local dev works exactly as before with zero Redis setup.
 */

import { getBackgroundQueue } from './queues';
import { logger } from '../logger';
import type { FeedbackItem } from '../../modules/ai/ai.memory';
import { db } from '../../core/database/client';

const log = logger.child({ module: 'dispatcher' });

// Enqueue: persist mistakes from a completed session

export async function dispatchPersistMistakes(
  userId:    string,
  topic:     string,
  feedbacks: FeedbackItem[]
): Promise<void> {
  const q = getBackgroundQueue();

  if (!q) {
    // No Redis — run inline (dev / degraded mode)
    const { persistMistakesFromFeedback } =
      await import('../../modules/ai/ai.memory');
    persistMistakesFromFeedback(userId, topic, feedbacks).catch(() => {/* logged inside */});
    return;
  }

  try {
    await q.add('persist-mistakes', { userId, topic, feedbacks });
    log.debug('Queued persist-mistakes', { userId });
  } catch (err) {
    // Queue failure must never break the session save response
    log.error('Failed to queue persist-mistakes — running inline', { userId, error: err });
    const { persistMistakesFromFeedback } =
      await import('../../modules/ai/ai.memory');
    persistMistakesFromFeedback(userId, topic, feedbacks).catch(() => {});
  }
}

// Enqueue: recompute weak areas after a session

export async function dispatchRecomputeWeakAreas(userId: string): Promise<void> {
  const q = getBackgroundQueue();

  if (!q) {
    const { recomputeWeakAreas } =
      await import('../../modules/analytics/weak_areas.service');
    recomputeWeakAreas(userId).catch(() => {/* logged inside */});
    return;
  }

  try {
    // 2 second delay — let the session DB write settle first
    await q.add('recompute-weak-areas', { userId }, { delay: 2_000 });
    log.debug('Queued recompute-weak-areas', { userId });
  } catch (err) {
    log.error('Failed to queue recompute-weak-areas — running inline', { userId, error: err });
    const { recomputeWeakAreas } =
      await import('../../modules/analytics/weak_areas.service');
    recomputeWeakAreas(userId).catch(() => {});
  }
}

// Enqueue: generate Interviewer's Notes narrative for a completed session

export async function dispatchGenerateInterviewerNotes(
  sessionId:  string,
  profession: string,
  score:      number,
  feedbacks:  FeedbackItem[]
): Promise<void> {
  const q = getBackgroundQueue();

  if (!q) {
    const { generateInterviewerNotes } =
      await import('../../modules/analytics/interviewer-notes.service');
    generateInterviewerNotes(sessionId, profession, score, feedbacks).catch(() => {/* logged inside */});
    return;
  }

  try {
    await q.add('generate-interviewer-notes', { sessionId, profession, score, feedbacks });
    log.debug('Queued generate-interviewer-notes', { sessionId });
  } catch (err) {
    log.error('Failed to queue generate-interviewer-notes — running inline', { sessionId, error: err });
    const { generateInterviewerNotes } =
      await import('../../modules/analytics/interviewer-notes.service');
    generateInterviewerNotes(sessionId, profession, score, feedbacks).catch(() => {});
  }
}

// Enqueue: generate Interview Readiness Report (every-5-sessions rollup)
//
// Gated Starter+ at the call site — sessions.service.ts only calls this
// for users on a paying plan, so this dispatcher itself has no plan
// check (it trusts the caller, same as the other dispatch* functions).

export async function dispatchGenerateReadinessReport(
  userId:       string,
  sessionCount: number,
): Promise<void> {
  const q = getBackgroundQueue();

  if (!q) {
    const { generateReadinessReport } =
      await import('../../modules/analytics/readiness-report.service');
    generateReadinessReport(userId, sessionCount).catch(() => {/* logged inside */});
    return;
  }

  try {
    await q.add('generate-readiness-report', { userId, sessionCount });
    log.debug('Queued generate-readiness-report', { userId, sessionCount });
  } catch (err) {
    log.error('Failed to queue generate-readiness-report — running inline', { userId, sessionCount, error: err });
    const { generateReadinessReport } =
      await import('../../modules/analytics/readiness-report.service');
    generateReadinessReport(userId, sessionCount).catch(() => {});
  }
}

// Schedule: B2B lead 24h follow-up email
//
// With Redis:    enqueues a delayed job (24h) on vachix:background.
//               jobId is the lead's id — BullMQ dedupes on jobId, so
//               re-submitting the same lead twice won't double-send.
// Without Redis: skipped — there's no safe inline equivalent for a
//               24h delay. Logged so it's visible in ops dashboards.

export async function dispatchLeadFollowUp(leadId: string): Promise<void> {
  const q = getBackgroundQueue();

  if (!q) {
    log.warn('Redis not configured — lead follow-up email NOT scheduled', { leadId });
    return;
  }

  try {
    await q.add(
      'lead-followup-email',
      { leadId },
      {
        delay: 24 * 60 * 60 * 1_000, // 24 hours
        jobId: `lead-followup-${leadId}`, // idempotent — no duplicate sends
      }
    );
    log.debug('Queued lead-followup-email', { leadId, delayHours: 24 });
  } catch (err) {
    log.error('Failed to queue lead-followup-email', { leadId, error: err });
  }
}
//
// With Redis:    registers a BullMQ repeatable job (every 1 hour).
//               The stable jobId prevents duplicate registrations
//               across restarts — BullMQ is idempotent on jobId.
// Without Redis: falls back to plain setInterval (current behaviour).

export async function scheduleSubscriptionExpiry(): Promise<void> {
  const q = getBackgroundQueue();

  if (!q) {
    const { expireOverdueSubscriptions } =
      await import('../../modules/payment/payment.service');

    expireOverdueSubscriptions().catch(err =>
      log.error('Subscription expiry failed on startup', { error: err })
    );
    setInterval(() =>
      expireOverdueSubscriptions().catch(err =>
        log.error('Subscription expiry failed (interval)', { error: err })
      ),
      60 * 60 * 1_000
    );
    log.info('Subscription expiry scheduled (setInterval — no Redis)');
    return;
  }

  try {
    await q.add(
      'expire-subscriptions',
      { triggeredAt: new Date().toISOString() },
      {
        jobId:  'expire-subscriptions-hourly', // stable — prevents duplicates on restart
        repeat: { every: 60 * 60 * 1_000 },
      }
    );
    log.info('Subscription expiry scheduled (BullMQ, every 1h)');
  } catch (err) {
    log.error('Failed to schedule subscription expiry via BullMQ', { error: err });
  }
}

// Schedule: expire stale interview sessions (Issue 7)
//
// sessions.service.ts can leave a row in 'scoring' status forever if
// the client disconnects before saveSession() reaches
// db.completeSession(). This recurring job sweeps those orphaned rows
// and marks them 'abandoned' — the lifecycle enforcement layer noted
// as missing.
//
// With Redis:    registers a BullMQ repeatable job (every 15 minutes).
//               The stable jobId prevents duplicate registrations
//               across restarts — BullMQ is idempotent on jobId.
// Without Redis: falls back to plain setInterval.

export async function scheduleSessionExpiry(): Promise<void> {
  const q = getBackgroundQueue();

  if (!q) {
    const { expireStaleSessions } =
      await import('../../modules/analytics/sessions.service');

    expireStaleSessions().catch(err =>
      log.error('Session expiry failed on startup', { error: err })
    );
    setInterval(() =>
      expireStaleSessions().catch(err =>
        log.error('Session expiry failed (interval)', { error: err })
      ),
      15 * 60 * 1_000
    );
    log.info('Session expiry scheduled (setInterval — no Redis)');
    return;
  }

  try {
    await q.add(
      'expire-stale-sessions',
      { triggeredAt: new Date().toISOString() },
      {
        jobId:  'expire-stale-sessions-15m', // stable — prevents duplicates on restart
        repeat: { every: 15 * 60 * 1_000 },
      }
    );
    log.info('Session expiry scheduled (BullMQ, every 15m)');
  } catch (err) {
    log.error('Failed to schedule session expiry via BullMQ', { error: err });
  }
}

// Token blacklist cleanup
// The token_blacklist table grows unboundedly without pruning.
// Run a nightly DELETE to remove rows whose expires_at has passed.
// This keeps isTokenBlacklisted() fast even under heavy auth load.

export function scheduleBlacklistCleanup(): void {
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  async function runCleanup() {
    try {
      await db.cleanupExpiredBlacklistTokens();
      logger.info('Token blacklist cleanup completed');
    } catch (err) {
      logger.error('Token blacklist cleanup failed', { error: (err as Error).message });
    }
  }

  // Run immediately on startup (catches any backlog), then every 24h
  setTimeout(runCleanup, 60_000); // wait 60s after startup
  setInterval(runCleanup, TWENTY_FOUR_HOURS);
}
