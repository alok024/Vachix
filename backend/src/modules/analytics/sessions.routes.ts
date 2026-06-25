import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authMiddleware, requireVerified, requireOnboarded, requirePro, requireStarterTier, validateIntParam, validate } from '../../core/middleware';
import {
  createSession,
  getSessions,
  getSession,
  scoreHistory,
  getReadinessReport,
} from './sessions.controller';
import { getShareToken } from '../reports/reports.routes';
import { getSessionCertificateToken, getReadinessCertificateToken } from '../certificates/certificates.controller';
import { createComparisonToken } from '../comparison/comparison.controller';

const router = Router();

// H-2: Per-user rate limit on comparison creation — each POST triggers AI
// scoring on every public submission, so an unbounded create rate is an
// uncapped cost multiplier. 5 challenges/min per authenticated user is
// generous for normal use and tight enough to blunt abuse.
const compareLimiter = rateLimit({
  windowMs: 60_000,
  max:      5,
  keyGenerator: (req) => (req as any).user?.id ?? req.ip ?? 'anon',
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, error: { code: 'rate_limited', message: 'Too many comparison requests. Please wait a moment.' } },
});

const CompareBodySchema = z.object({
  question_index: z.number().int().nonnegative(),
});

// requireOnboarded: sessions are meaningless without profession/goal context
router.post('/',               authMiddleware, requireVerified, requireOnboarded, createSession);
// history/page.tsx presents full session history as a
// Pro-only paywalled feature, but GET / had no requirePro check — any
// free user could bypass the paywall with a direct API call.
//
// score-history is intentionally left open: dashboard/page.tsx's "Recent
// Sessions" widget calls it unconditionally for all users (not gated by
// isFree), so adding requirePro here would break that for free users —
// confirmed by checking how each endpoint is actually consumed before
// changing behavior, per the bug note to "decide policy first."
router.get('/',                authMiddleware, requireVerified, requirePro, getSessions);
router.get('/score-history',   authMiddleware, requireVerified, scoreHistory);
// Interview Readiness Report — Starter+ (every-5-sessions rollup, builds
// on the per-session Interviewer's Notes). Must come before /:id so
// "readiness-report" isn't swallowed as a session id param.
router.get('/readiness-report', authMiddleware, requireVerified, requireStarterTier, getReadinessReport);
// Readiness Certificate — mints a shareable HMAC token for the user's
// latest readiness-report checkpoint. No separate plan gate: a report
// only exists for Starter+ users in the first place (see
// getReadinessCertificateToken's own comment). Must also come before
// /:id for the same reason as readiness-report above.
router.get('/readiness-report/certificate-token', authMiddleware, requireVerified, requireStarterTier, getReadinessCertificateToken);
router.get('/:id/share-token',       authMiddleware, requireVerified, validateIntParam('id'), getShareToken);
router.get('/:id/certificate-token', authMiddleware, requireVerified, validateIntParam('id'), getSessionCertificateToken);
// Friend score comparison — create a challenge for a specific question.
// POST so it creates a new comparison row; body carries question_index.
router.post('/:id/compare',          authMiddleware, requireVerified, compareLimiter, validateIntParam('id'), validate(CompareBodySchema), createComparisonToken);
router.get('/:id',                   authMiddleware, requireVerified, validateIntParam('id'), getSession);

export default router;
