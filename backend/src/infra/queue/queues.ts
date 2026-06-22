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
