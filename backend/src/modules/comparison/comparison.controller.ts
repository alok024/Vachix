import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { ok, notFound, badRequest } from '../../core/utils/response';
import { trackEvent } from '../analytics/events.service';
import { db } from '../../core/database/client';
import {
  createComparison,
  getPublicComparison,
  submitChallengeResponse,
} from './comparison.service';

// POST /api/sessions/:id/compare  (auth required — session owner only)
// Creates a challenge for a specific question in this session.
// Body: { question_index: number }
export const createComparisonToken = asyncHandler(async (req: Request, res: Response) => {
  const userId    = req.user!.id;
  const sessionId = req.params.id;

  const { question_index } = req.body as { question_index?: number };

  if (typeof question_index !== 'number' || !Number.isInteger(question_index) || question_index < 0) {
    badRequest(res, 'question_index must be a non-negative integer', 'invalid_question_index');
    return;
  }

  // Verify session belongs to this user
  const session = await db.getSessionById(sessionId, userId);
  if (!session) {
    notFound(res, 'Session not found');
    return;
  }

  const result = await createComparison(userId, sessionId, question_index);

  trackEvent({
    event:     'comparison_created',
    userId,
    sessionId,
    path:      '/api/sessions/:id/compare',
    properties: { question_index, share_url: result.share_url },
  });

  ok(res, result);
});

// GET /api/compare/:token  (public — no auth)
// Returns the comparison data (sharer info + all responses so far).
export const getComparison = asyncHandler(async (req: Request, res: Response) => {
  const comparison = await getPublicComparison(req.params.token);

  if (!comparison) {
    notFound(res, 'Comparison not found or link has expired');
    return;
  }

  trackEvent({
    event:     'comparison_viewed',
    userId:    null,
    sessionId: null,
    path:      '/api/compare/:token',
    properties: { token: req.params.token, viewer_ip: req.ip ?? null },
  });

  ok(res, comparison);
});

// POST /api/compare/:token/respond  (public — no auth required)
// Submits a challenger's answer for AI scoring and comparison.
// Body: { answer: string, name?: string }
export const respondToComparison = asyncHandler(async (req: Request, res: Response) => {
  const { answer, name } = req.body as { answer?: string; name?: string };

  if (!answer || !answer.trim()) {
    badRequest(res, 'answer is required', 'answer_required');
    return;
  }
  if (answer.length > 2000) {
    badRequest(res, 'answer must be under 2000 characters', 'answer_too_long');
    return;
  }

  const result = await submitChallengeResponse(req.params.token, answer.trim(), name);

  if (!result) {
    notFound(res, 'Comparison not found or link has expired');
    return;
  }

  trackEvent({
    event:     'comparison_responded',
    userId:    null,
    sessionId: null,
    path:      '/api/compare/:token/respond',
    properties: {
      challenger_score: result.challenger_score,
      sharer_score:     result.sharer_score,
      delta:            result.delta,
    },
  });

  ok(res, result);
});
