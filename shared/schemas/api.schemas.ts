/**
 * shared/schemas/api.schemas.ts
 *
 * Single source of truth for all API request/response shapes.
 * Imported by both frontend (validation + type inference) and
 * backend (validation middleware). No drift is possible.
 *
 * Usage:
 *   import { LoginResponseSchema, type LoginResponse } from '@shared/schemas/api.schemas';
 */

import { z } from 'zod';

// Shared enums / literals

export const PlanSchema       = z.enum(['free', 'starter', 'pro', 'elite']);
export const SessionModeSchema = z.enum(['classic', 'chat']);
// this schema previously drifted from what the rest of the
// codebase actually uses. Verified against frontend/types/index.ts,
// the interview setup page's difficulty selector, and
// features/interview/schemas/index.ts — all consistently use 'expert',
// not 'advanced'. NOTE: this shared schemas file is not currently
// imported by either the frontend or backend (each maintains its own
// local schemas/types), so this fix does not change runtime behavior
// anywhere yet — it just stops this file from documenting a value that
// doesn't match the real one if/when it's wired up.
export const DifficultySchema  = z.enum(['beginner', 'intermediate', 'expert']);
export const InterviewTypeSchema = z.enum(['Technical', 'Behavioral', 'Mixed']);
export const PersonaSchema    = z.enum(['friendly', 'strict', 'encouraging']);

// Domain object schemas

export const UserSchema = z.object({
  id:                       z.string().uuid(),
  email:                    z.string().email(),
  name:                     z.string(),
  plan:                     PlanSchema,
  email_verified:           z.boolean(),
  referral_code:            z.string().optional(),
  referral_bonus:           z.number().optional(),
  ai_calls:                 z.number().optional(),
  onboarding_profession:    z.string().nullable().optional(),
  onboarding_goal:          z.string().nullable().optional(),
  onboarding_completed_at:  z.string().nullable().optional(),
  is_admin:                 z.boolean().optional(),
  created_at:               z.string().optional(),
  // Job-landed fields — present on the /me response once the user has
  // submitted the \"I got the job\" form; null/undefined before that.
  job_landed_at:            z.string().nullable().optional(),
  job_landed_role:          z.string().nullable().optional(),
  job_landed_company:       z.string().nullable().optional(),
});

export const UsageSchema = z.object({
  ai_calls:      z.number(),
  call_count:    z.number().optional(),
  limit:         z.number().nullable().optional(),
  remaining:     z.number().nullable().optional(),
  resets_at:     z.string().nullable().optional(),
  // P1-A session cap fields
  session_count: z.number(),
  session_limit: z.number().nullable(),
});

export const UserStatsSchema = z.object({
  streak:            z.number(),
  sessions:          z.number(),
  best_score:        z.number(),
  last_session:      z.string().optional(),
  avg_job_ready_score: z.number().optional(),
});

export const ErrorCorrectionSchema = z.object({
  mistake:     z.string().optional(),
  wrong:       z.string().optional(),
  correction:  z.string().optional(),
  correct:     z.string().optional(),
  explanation: z.string().optional(),
  rule:        z.string().optional(),
});

export const StructureFeedbackSchema = z.object({
  type:          z.string(),
  score:         z.number(),
  present_parts: z.array(z.string()),
  missing_parts: z.array(z.string()),
  fix:           z.string(),
});

export const ModelAnswerSchema = z.object({
  good:  z.string(),
  great: z.string(),
});

export const FeedbackSchema = z.object({
  id:                  z.string(),
  session_id:          z.string(),
  question:            z.string(),
  answer:              z.string().optional(),
  score:               z.number(),
  tips:                z.string().optional(),
  corrections:         z.array(ErrorCorrectionSchema).optional(),
  interview_feedback:  z.string().optional(),
  english_errors:      z.array(ErrorCorrectionSchema).optional(),
  corrected_answer:    z.string().nullable().optional(),
  structure:           StructureFeedbackSchema.optional(),
  model_answer:        ModelAnswerSchema.optional(),
  tip:                 z.string().optional(),
});

export const SessionSchema = z.object({
  id:              z.string(),
  user_id:         z.string(),
  profession:      z.string(),
  mode:            SessionModeSchema,
  difficulty:      DifficultySchema,
  interview_type:  InterviewTypeSchema,
  personality:     PersonaSchema,
  score:           z.number(),
  exchanges:       z.number(),
  duration_secs:   z.number(),
  hindi_mode:      z.boolean(),
  job_ready_score: z.number().optional(),
  clarity_score:   z.number().optional(),
  structure_score: z.number().optional(),
  relevance_score: z.number().optional(),
  grammar_score:   z.number().optional(),
  created_at:      z.string(),
});

export const WeakAreaSchema = z.object({
  topic:        z.string(),
  avg_score:    z.number(),
  drill_prompt: z.string().optional(),
});

export const JobReadinessSchema = z.object({
  score:   z.number(),
  label:   z.string(),
  color:   z.string(),
  message: z.string(),
});

export const ReferralDataSchema = z.object({
  code:        z.string(),
  uses:        z.number(),
  rewarded:    z.number(),
  bonus_calls: z.number(),
});

// API Response schemas — what the backend must return

export const AuthResponseSchema = z.object({
  token:      z.string(),
  user:       UserSchema,
  email_sent: z.boolean().optional(),
});

export const MeResponseSchema = z.object({
  user:         UserSchema,
  usage:        UsageSchema,
  stats:        UserStatsSchema,
  onboarding:   z.object({
    completed:  z.boolean(),
    profession: z.string().optional(),
    goal:       z.string().optional(),
  }),
  job_readiness: JobReadinessSchema.optional(),
  weak_areas:    z.array(WeakAreaSchema).optional(),
  session_defaults: z.object({
    profession:     z.string(),
    difficulty:     z.enum(['beginner', 'intermediate', 'expert']),
    interview_type: z.string(),
  }).optional(),
  recommendations: z.array(z.object({
    type:   z.enum(['session', 'focus', 'milestone']),
    title:  z.string(),
    reason: z.string(),
    action: z.string().optional(),
  })).optional(),
  referral: z.object({
    code:        z.string(),
    uses:        z.number(),
    rewarded:    z.number(),
    bonus_calls: z.number(),
  }).nullable().optional(),
});

export const SessionsResponseSchema = z.object({
  sessions: z.array(SessionSchema),
});

export const SessionDetailResponseSchema = z.object({
  session:   SessionSchema,
  feedbacks: z.array(FeedbackSchema),
});

export const ScoreHistoryResponseSchema = z.object({
  history: z.array(SessionSchema.extend({ topic: z.string().optional() })),
});

export const CreateSessionResponseSchema = z.object({
  session_id:      z.string(),
  streak:          z.number(),
  sessions:        z.number(),
  best_score:      z.number(),
  job_ready_score: z.number(),
  upsell_trigger:  z.object({
    reason:  z.enum(['post_session', 'high_score', 'streak_milestone']),
    score:   z.number().optional(),
    streak:  z.number().optional(),
  }).optional(),
});

export const AIResponseSchema = z.object({
  text: z.string(),
});

export const CreateOrderResponseSchema = z.object({
  order_id: z.string(),
  amount:   z.number(),
  currency: z.string(),
  key:      z.string(),
  plan:     z.string(),
});

export const ShareTokenResponseSchema = z.object({
  share_token:   z.string(),
  share_url:     z.string(),
  referral_code: z.string().optional(),
});

// Inferred TypeScript types — import these instead of writing
// manual interface definitions

export type Plan            = z.infer<typeof PlanSchema>;
export type SessionMode     = z.infer<typeof SessionModeSchema>;
export type Difficulty      = z.infer<typeof DifficultySchema>;
export type InterviewType   = z.infer<typeof InterviewTypeSchema>;
export type Persona         = z.infer<typeof PersonaSchema>;
export type User            = z.infer<typeof UserSchema>;
export type Usage           = z.infer<typeof UsageSchema>;
export type UserStats       = z.infer<typeof UserStatsSchema>;
export type ErrorCorrection = z.infer<typeof ErrorCorrectionSchema>;
export type StructureFeedback = z.infer<typeof StructureFeedbackSchema>;
export type ModelAnswer     = z.infer<typeof ModelAnswerSchema>;
export type Feedback        = z.infer<typeof FeedbackSchema>;
export type Session         = z.infer<typeof SessionSchema>;
export type WeakArea        = z.infer<typeof WeakAreaSchema>;
export type JobReadiness    = z.infer<typeof JobReadinessSchema>;
export type ReferralData    = z.infer<typeof ReferralDataSchema>;
export type AuthResponse    = z.infer<typeof AuthResponseSchema>;
export type MeResponse      = z.infer<typeof MeResponseSchema>;
