import { z } from 'zod';

// Auth

export const RegisterSchema = z.object({
  email:    z.string().email('Invalid email format'),
  // M1: raised from 6 → 8. Login schema intentionally stays at min(1) so
  // existing accounts with shorter passwords aren't locked out retroactively.
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name:     z.string().max(100).optional(),
  ref:      z.string().max(20).optional(),
});

export const LoginSchema = z.object({
  email:    z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Invalid email format'),
});

// Onboarding

export const OnboardingSchema = z.object({
  profession: z.string().min(1).max(50),
  goal:       z.string().min(1).max(30),
});

export const ResetPasswordSchema = z.object({
  token:        z.string().min(1, 'Token is required'),
  new_password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const VerifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export const ResendVerificationSchema = z.object({
  email: z.string().email('Invalid email format'),
});

// Payment

export const CreateOrderSchema = z.object({
  plan: z.enum(['starter', 'pro', 'elite']),
});

export const VerifyPaymentSchema = z.object({
  razorpay_order_id:   z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature:  z.string().min(1),
  plan:                z.enum(['starter', 'pro', 'elite']),
});

// AI

const AIMessageSchema = z.object({
  // C1+H1: 'system' role removed — clients must never inject system messages.
  // The backend builds the system prompt server-side only.
  role:    z.enum(['user', 'assistant']),
  // C3: content capped at 2,000 chars per message to prevent context-window
  // exhaustion and runaway API spend from oversized pastes.
  content: z.string().min(1).max(2_000),
});

export const AIRequestSchema = z.object({
  messages:   z.array(AIMessageSchema).min(1).max(100),
  max_tokens: z.number().int().min(1).max(4096).optional(),
  topic:      z.string().max(200).optional(),
  free:       z.boolean().optional(),   // true = helper call (hint/drill/grammar) — does not count against session limit
  /**
   * Fix (S1): Optional session identifier for prompt-context memoization.
   * When provided, buildPromptContext() caches the assembled system prompt
   * in Redis for the session's lifetime and reuses it on every subsequent
   * turn — eliminating 4 DB reads and a full prompt rebuild per message.
   * Generated client-side at session start (or server-side on first call).
   */
  session_id: z.string().max(128).optional(),
});

// AI feedback output schema (C1)
// Validates the JSON structure the LLM is expected to return for per-answer
// feedback. safeParse() this on every AI response before storing or scoring.
// All fields are optional so partial responses degrade gracefully rather than
// throwing — missing fields fall back to safe defaults downstream.

export const AIFeedbackOutputSchema = z.object({
  score:          z.number().min(0).max(10).optional(),
  tips:           z.string().max(2000).optional(),
  feedback:       z.string().max(2000).optional(),   // alias some models use
  english_errors: z.array(z.string().max(300)).max(20).optional(),
  corrections:    z.array(
    z.union([
      z.string().max(300),
      z.object({
        original:    z.string().max(300).optional(),
        corrected:   z.string().max(300).optional(),
        explanation: z.string().max(500).optional(),
      }),
    ])
  ).max(20).optional(),
  structure: z.record(z.string().max(100), z.unknown()).optional(),
  model_answer: z.object({
    good:  z.string().max(1000).optional(),
    great: z.string().max(1000).optional(),
  }).optional(),
});

export type AIFeedbackOutput = z.infer<typeof AIFeedbackOutputSchema>;

export type AIRequestDTO = z.infer<typeof AIRequestSchema>;



export type RegisterDTO = z.infer<typeof RegisterSchema>;
export type LoginDTO    = z.infer<typeof LoginSchema>;

// B2B Lead

export const LeadSchema = z.object({
  name:    z.string().min(1).max(100),
  email:   z.string().email('Invalid email format'),
  org:     z.string().min(1).max(150),
  size:    z.string().min(1).max(20),
  orgType: z.string().max(30).optional(),
  message: z.string().max(2000).optional(),
});

export type LeadDTO = z.infer<typeof LeadSchema>;

// Admin: B2B lead status updates

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'closed'] as const;

export const UpdateLeadStatusSchema = z.object({
  status: z.enum(LEAD_STATUSES),
});

export type UpdateLeadStatusDTO = z.infer<typeof UpdateLeadStatusSchema>;

// Analytics events

// Scalar-only property values — no nested objects, no unbounded strings.
// Max 20 keys, each key ≤ 64 chars, each value ≤ 256 chars (or number/bool/null).
const AnalyticsPropertyValue = z.union([
  z.string().max(256),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const AnalyticsEventSchema = z.object({
  event:      z.string().min(1).max(80),
  session_id: z.string().max(100).optional(),
  path:       z.string().max(300).optional(),
  properties: z.record(z.string().max(64), AnalyticsPropertyValue).superRefine((val, ctx) => {
    if (Object.keys(val).length > 20) {
      ctx.addIssue({ code: 'too_big', maximum: 20, type: 'array', inclusive: true, message: 'Max 20 properties' });
    }
  }).optional(),
});

export const AnalyticsEventBatchSchema = z.object({
  events: z.array(AnalyticsEventSchema).min(1).max(50),
});

export type AnalyticsEventDTO      = z.infer<typeof AnalyticsEventSchema>;
export type AnalyticsEventBatchDTO = z.infer<typeof AnalyticsEventBatchSchema>;

// Admin analytics query params

export const AdminEventQuerySchema = z.object({
  limit:   z.coerce.number().int().min(1).max(500).default(100),
  event:   z.string().max(80).optional(),
  user_id: z.string().uuid('user_id must be a valid UUID').optional(),
});

export type AdminEventQueryDTO = z.infer<typeof AdminEventQuerySchema>;


// Sessions
// Zod handles coercion, defaults, and range-clamping in one place so
// the controller stays free of imperative String()/Number()/Math.min() noise.

const clampedScore       = z.coerce.number().min(0).max(100).default(0);
const clampedExchanges   = z.coerce.number().min(0).max(200).default(0);
const clampedDurationSec = z.coerce.number().min(0).max(7200).default(0);

export const CreateSessionSchema = z.object({
  client_session_id: z.string().uuid('client_session_id must be a UUID'),
  profession:        z.string().min(1).max(100).default('General'),
  mode:              z.string().min(1).max(50).default('classic'),
  difficulty:        z.string().min(1).max(50).default('beginner'),
  interview_type:    z.string().min(1).max(50).default('mixed'),
  personality:       z.string().min(1).max(50).default('friendly'),
  score:             clampedScore,
  exchanges:         clampedExchanges,
  duration_secs:     clampedDurationSec,
  hindi_mode:        z.coerce.boolean().default(false),
  feedbacks:         z.array(z.unknown()).optional(),
});

export type CreateSessionDTO = z.infer<typeof CreateSessionSchema>;

// Pagination & query-param schemas (DRY fix for controllers)
// Controllers should use these instead of manual parseInt/Math.min
// to keep query-param parsing and clamping in one place.

export const PaginationSchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(50).default(10),
});

export const AdminUsersQuerySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().max(200).optional(),
});

export const AdminLeadsQuerySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(LEAD_STATUSES).optional(),
});

export const AdminSubscriptionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ScoreHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export type PaginationDTO              = z.infer<typeof PaginationSchema>;
export type AdminUsersQueryDTO         = z.infer<typeof AdminUsersQuerySchema>;
export type AdminLeadsQueryDTO         = z.infer<typeof AdminLeadsQuerySchema>;
export type AdminSubscriptionsQueryDTO = z.infer<typeof AdminSubscriptionsQuerySchema>;
export type ScoreHistoryQueryDTO       = z.infer<typeof ScoreHistoryQuerySchema>;
