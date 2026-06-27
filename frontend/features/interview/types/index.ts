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
  // XP system (migration 023)
  xp_earned:               number;
  xp_lifetime:             number;
  xp_monthly:              number;
  // Streak freeze (migration 024) — only present when a freeze was consumed
  streak_freeze_used?:       boolean;
  streak_freezes_remaining?: number;
  upsell_trigger?: {
    reason:  'post_session' | 'high_score' | 'streak_milestone';
    score?:  number;
    streak?: number;
  };
  // Milestone reward — present when a 7/30/60/90 day milestone fires
  milestone_reward?: {
    milestone:   number;
    reward_type: string;
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