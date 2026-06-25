/**
 * Queue Definitions
 *
 * Single `vachix:background` queue handles:
 *   - persist-mistakes              (AI memory after each session)
 *   - recompute-weak-areas          (topic scoring after each session)
 *   - generate-interviewer-notes    (Aria's narrative summary after each session)
 *   - generate-readiness-report     (every-5-sessions rollup summary, Starter+ only)
 *   - expire-subscriptions          (recurring hourly — replaces setInterval)
 *   - expire-stale-sessions         (recurring every 15 min — session lifecycle sweep)
 *
 * defaultJobOptions:
 *   attempts 3 + exponential backoff = retries at 2s, 4s, 8s.
 *   removeOnComplete 200 keeps the last 200 completed jobs for inspection.
 *   removeOnFail 100 keeps the last 100 failures for debugging.
 */

import { Queue } from 'bullmq';
import { getRedis } from './redis';
import { logger }   from '../logger';

const log = logger.child({ module: 'queue' });

export const QUEUE_NAME = 'vachix:background';

let _queue: Queue | null = null;

export function getBackgroundQueue(): Queue | null {
  const conn = getRedis();
  if (!conn) return null;

  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, {
      connection: conn,
      defaultJobOptions: {
        attempts:         3,
        backoff:          { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 200 },
        removeOnFail:     { count: 100 },
      },
    });

    _queue.on('error', (err: Error) => {
      // Queue-level errors (connection drop, auth failure) — worker errors are logged separately.
      log.error('BullMQ queue error', { queue: QUEUE_NAME, error: err.message });
    });
  }

  return _queue;
}

export async function closeQueue(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
}

/**
 * Returns a snapshot of queue depth counters for the /health/metrics endpoint.
 * Returns null when Redis is unavailable (no-Redis dev mode).
 *
 * Alert thresholds (set in your monitoring tool):
 *   waiting > 500  — backlog building faster than workers can drain
 *   failed  > 50   — systematic job failure, likely a code or infra regression
 */
export async function getQueueDepth(): Promise<Record<string, number> | null> {
  const queue = getBackgroundQueue();
  if (!queue) return null;

  const [waiting, active, delayed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getDelayedCount(),
    queue.getFailedCount(),
  ]);

  return { waiting, active, delayed, failed };
}
