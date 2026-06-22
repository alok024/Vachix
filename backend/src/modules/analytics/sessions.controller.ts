import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { ok, notFound, badRequest } from '../../core/utils/response';
import {
  saveSession,
  listSessions,
  getSessionDetail,
  getScoreHistory,
} from './sessions.service';
import { trackEvent } from './events.service';
import { getOrCreateReferralCode } from '../growth/referral.service';
import { CreateSessionSchema, PaginationSchema, ScoreHistoryQuerySchema } from '../../core/utils/schemas';
import { db } from '../../core/database/client';

// POST /api/sessions
export const createSession = asyncHandler(async (req: Request, res: Response) => {
  // Schema parse handles coercion, defaults, and range-clamping in one
  // place. client_session_id must be a UUID — it is the idempotency key.
  const parsed = CreateSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, parsed.error.errors[0]?.message ?? 'Invalid request body', 'validation_error');
    return;
  }
  const {
    client_session_id, profession, mode, difficulty, interview_type,
    personality, score, exchanges, duration_secs, hindi_mode, feedbacks,
  } = parsed.data;

  const sessionResult = await saveSession({
    userId: req.user!.id,
    client_session_id,
    profession,
    mode,
    difficulty,
    interview_type,
    personality,
    score,
    exchanges,
    duration_secs,
    hindi_mode,
    feedbacks: feedbacks as Parameters<typeof saveSession>[0]['feedbacks'],
  });

  // Monetization trigger
  // post_session is the free-user fallback: every completed session is a
  // high-intent moment. If a stronger signal (high_score, streak_milestone)
  // already fired from the service, we keep that and don't downgrade it.
  const userPlan      = req.user!.plan;
  let upsellTrigger   = sessionResult.upsell_trigger;
  if (userPlan === 'free' && !upsellTrigger) {
    upsellTrigger = { reason: 'post_session' };
  }

  trackEvent({
    event:  'session_complete',
    userId: req.user!.id,
    plan:   userPlan,
    properties: { profession, mode, difficulty, interview_type, score, exchanges, duration_secs },
  });

  if (upsellTrigger) {
    trackEvent({
      event:  'upsell_shown',
      userId: req.user!.id,
      plan:   userPlan,
      properties: { trigger: upsellTrigger.reason, score, streak: sessionResult.streak },
    });
  }

  // Referral invite nudge
  // Session 1: user just proved the product works → prime invite moment.
  // Session 3: habit is forming → second best invite moment.
  // Non-fatal: if referral fetch fails, session response still sends.
  let inviteNudge: {
    show:         boolean;
    headline:     string;
    reward_line:  string;
    referral_url: string;
    whatsapp_url: string;
    copy_text:    string;
  } | null = null;

  const completedSessionCount = sessionResult.sessions;
  if (completedSessionCount === 1 || completedSessionCount === 3) {
    try {
      const referralInfo = await getOrCreateReferralCode(req.user!.id);
      inviteNudge = {
        show:         true,
        headline:     referralInfo.share_context.invite_headline,
        reward_line:  referralInfo.share_context.reward_line,
        referral_url: referralInfo.url,
        whatsapp_url: referralInfo.share_context.whatsapp_url,
        copy_text:    referralInfo.share_context.copy_text,
      };
      trackEvent({
        event:  'referral_invite_shown',
        userId: req.user!.id,
        plan:   userPlan,
        properties: { session_count: completedSessionCount, referral_code: referralInfo.code },
      });
    } catch {
      // non-fatal — session response always succeeds
    }
  }

  ok(res, { ...sessionResult, upsell_trigger: upsellTrigger, invite_nudge: inviteNudge });
});

// GET /api/sessions
export const getSessions = asyncHandler(async (req: Request, res: Response) => {
  const parsed = PaginationSchema.safeParse(req.query);
  if (!parsed.success) {
    badRequest(res, 'Invalid pagination parameters', 'validation_failed', parsed.error.flatten().fieldErrors);
    return;
  }

  const { page, per_page: perPage } = parsed.data;
  const sessionList = await listSessions(req.user!.id, page, perPage);
  ok(res, sessionList);
});

// GET /api/sessions/score-history  (must be before /:id)
export const scoreHistory = asyncHandler(async (req: Request, res: Response) => {
  const parsed = ScoreHistoryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    badRequest(res, 'Invalid query parameters', 'validation_failed', parsed.error.flatten().fieldErrors);
    return;
  }

  const scoreHistoryData = await getScoreHistory(req.user!.id, parsed.data.limit);
  ok(res, { history: scoreHistoryData });
});

// GET /api/sessions/readiness-report  (Starter+ gated — see requireStarterTier)
// Returns the most recent Interview Readiness Report checkpoint, plus
// how many more sessions until the next one. report: null is a normal
// state — e.g. a brand-new Starter subscriber with < 5 sessions so far.
export const getReadinessReport = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const [report, stats] = await Promise.all([
    db.getLatestReadinessReport(userId),
    db.getStats(userId),
  ]);

  const totalSessions = stats?.sessions ?? 0;
  // Sessions remaining until the next checkpoint (5, 10, 15, ...).
  // e.g. totalSessions=7  → 3 more until 10.  totalSessions=10 → 5 more until 15.
  const remainder = totalSessions % 5;
  const sessionsUntilNext = remainder === 0 ? 5 : 5 - remainder;

  ok(res, {
    report:                     report ?? null,
    total_sessions:             totalSessions,
    sessions_until_next_report: sessionsUntilNext,
  });
});

// GET /api/sessions/:id
export const getSession = asyncHandler(async (req: Request, res: Response) => {
  const interviewSession = await getSessionDetail(req.params.id, req.user!.id);

  if (!interviewSession) {
    notFound(res, 'Session not found');
    return;
  }
  ok(res, interviewSession);
});
