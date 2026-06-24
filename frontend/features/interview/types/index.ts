/**
 * features/interview/types/index.ts
 *
 * Types owned by the interview feature.
 * Session, Feedback, ErrorCorrection primitives live in @/types.
 *
 * Note: AI chat payload/response types live in features/ai/types —
 * they're shared with the English-practice feature, not interview-only.
 */
import type { Feedback } from '@/types';

/** POST /api/sessions request body */
export interface CreateSessionPayload {
  client_session_id: string;
  profession:        string;
  mode:              string;
  interview_type:    string;
  difficulty:        string;
  personality:       string;
  score:             number;
  exchanges:         number;
  duration_secs:     number;
  hindi_mode:        boolean;
  feedbacks:         Feedback[];
}

/** POST /api/sessions success body */
export interface CreateSessionResponse {
  session_id:      string;
  streak:          number;
  sessions:        number;
  best_score:      number;
  job_ready_score: number;
  upsell_trigger?: {
    reason:  'post_session' | 'high_score' | 'streak_milestone';
    score?:  number;
    streak?: number;
  };
}

/** GET /api/sessions/:id */
export interface SessionDetailResponse {
  session:   import('@/types').Session;
  feedbacks: Feedback[];
}

/** GET /api/sessions/:id/share-token */
export interface ShareTokenResponse {
  share_token:    string;
  share_url:      string;
  referral_code?: string;
}
