/**
 * Background Worker
 *
 * Processes every job on `vachix:background`.
 * Runs as a separate process in production (see src/worker.ts entry point).
 * Can also run in the same process during development.
 *
 * IMPORTANT — all handlers must be IDEMPOTENT.
 * BullMQ retries failed jobs. A job that partially completes
 * and is retried must not create duplicate data.
 * The underlying services (persistMistakesFromFeedback, recomputeWeakAreas)
 * already use upsert semantics — they are safe to retry.
 *
 * Concurrency = 5:
 *   At most 5 jobs run in parallel per worker process.
 *   Scale by running more worker processes, not by raising this number.
 */

import { Worker, Job } from 'bullmq';
import { getRedis } from './redis';
import { QUEUE_NAME } from './queues';
import { logger } from '../logger';
import { captureException } from '../observability';

const log = logger.child({ module: 'worker' });

export function startBackgroundWorker(): Worker | null {
  const conn = getRedis();

  if (!conn) {
    log.warn('Redis not configured — background worker NOT started (jobs run inline)');
    return null;
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      log.debug('Processing job', { name: job.name, id: job.id, attempt: job.attemptsMade + 1 });

      switch (job.name) {

        // ── Persist AI memory mistakes ──────────────────────────────
        case 'persist-mistakes': {
          const { persistMistakesFromFeedback } =
            await import('../../modules/ai/ai.memory');
          await persistMistakesFromFeedback(
            job.data.userId,
            job.data.topic,
            job.data.feedbacks
          );
          break;
        }

        // ── Recompute weak areas ────────────────────────────────────
        case 'recompute-weak-areas': {
          const { recomputeWeakAreas } =
            await import('../../modules/analytics/weak_areas.service');
          await recomputeWeakAreas(job.data.userId);
          break;
        }

        // ── Retry-persist a batch of analytics events ───────────────
        case 'persist-analytics-events': {
          const { db } = await import('../../core/database/client');
          await db.createAnalyticsEvents(job.data.events);
          break;
        }

        // ── Expire overdue subscriptions (hourly cron) ──────────────
        case 'expire-subscriptions': {
          const { expireOverdueSubscriptions } =
            await import('../../modules/payment/payment.service');
          await expireOverdueSubscriptions();
          break;
        }

        // ── Expire stale 'scoring' sessions (every 15 min) ──────────
        case 'expire-stale-sessions': {
          const { expireStaleSessions } =
            await import('../../modules/analytics/sessions.service');
          await expireStaleSessions();
          break;
        }

        // ── B2B lead 24h follow-up email ────────────────────────────
        // Skips if a human has already moved the lead past "new"
        // (e.g. team marked it "contacted"/"qualified"/"closed").
        case 'lead-followup-email': {
          const { db }              = await import('../../core/database/client');
          const { sendLeadFollowUpEmail } = await import('../../modules/auth/email.service');

          const lead = await db.getLeadById(job.data.leadId);
          if (!lead) {
            log.warn('lead-followup-email: lead not found — skipping', { leadId: job.data.leadId });
            break;
          }
          if (lead.status !== 'new') {
            log.debug('lead-followup-email: lead already actioned — skipping', {
              leadId: lead.id, status: lead.status,
            });
            break;
          }

          await sendLeadFollowUpEmail({
            name:    lead.name,
            email:   lead.email,
            org:     lead.org,
            size:    lead.size,
            orgType: lead.org_type ?? undefined,
            message: lead.message ?? undefined,
          });

          // Mark as contacted — only if still "new" (avoids racing a
          // manual status change made between the read above and now).
          await db.updateLeadStatus(lead.id, 'contacted', 'new');
          break;
        }

        default:
          log.warn('Unknown job name — skipped', { name: job.name, id: job.id });
      }
    },
    {
      connection:  conn,
      concurrency: 5,
    }
  );

  // ── Event listeners ─────────────────────────────────────────────

  worker.on('completed', (job: Job) =>
    log.info('Job completed', {
      name:     job.name,
      id:       job.id,
      attempts: job.attemptsMade,
    })
  );

  // H5: Distinguish between a transient failure (will be retried) and
  // exhaustion (all attempts used up — data is silently lost without action).
  // BullMQ defaultJobOptions sets attempts = 3, so job.attemptsMade === 3
  // means this is the final failure. We capture to Sentry so ops is paged
  // rather than silently losing AI memory or weak-area recomputation.
  worker.on('failed', (job: Job | undefined, err: Error) => {
    const attempts    = job?.attemptsMade ?? 0;
    const maxAttempts = 3; // mirrors defaultJobOptions.attempts in queues.ts
    const exhausted   = attempts >= maxAttempts;

    log.error('Job failed', {
      name:      job?.name,
      id:        job?.id,
      attempts,
      exhausted,
      error:     err.message,
    });

    // Alert only on final failure — not on intermediate retries.
    if (exhausted) {
      captureException(err, {
        extra: {
          job_name:  job?.name,
          job_id:    job?.id,
          attempts,
          job_data:  JSON.stringify(job?.data ?? {}),
          note:      'Background job exhausted all retries — manual replay may be needed.',
        },
      });
    }
  });

  worker.on('error', (err: Error) =>
    log.error('Worker-level error', { error: err.message })
  );

  log.info('Background worker started', { queue: QUEUE_NAME, concurrency: 5 });
  return worker;
}
