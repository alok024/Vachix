/**
 * BullMQ Job Payload Types
 *
 * All fields must be JSON-serialisable.
 * These are the `data` objects stored in Redis per job.
 */

import type { FeedbackItem } from '../../modules/ai/ai.memory';

// persist-mistakes
export interface PersistMistakesData {
  userId:    string;
  topic:     string;
  feedbacks: FeedbackItem[];
}

// recompute-weak-areas
export interface RecomputeWeakAreasData {
  userId: string;
}

// expire-subscriptions
export interface ExpireSubscriptionsData {
  triggeredAt: string; // ISO — for logging only
}

// generate-readiness-report
export interface GenerateReadinessReportData {
  userId:       string;
  sessionCount: number;
}
