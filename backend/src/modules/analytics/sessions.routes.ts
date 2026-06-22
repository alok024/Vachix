import { Router } from 'express';
import { authMiddleware, requireVerified, requireOnboarded, requirePro, requireStarterTier, validateUUIDParam } from '../../core/middleware';
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

// requireOnboarded: sessions are meaningless without profession/goal context
router.post('/',               authMiddleware, requireVerified, requireOnboarded, createSession);
// Fix (#22): history/page.tsx presents full session history as a
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
// "readiness-report" isn't swallowed as a session UUID param.
router.get('/readiness-report', authMiddleware, requireVerified, requireStarterTier, getReadinessReport);
// Readiness Certificate — mints a shareable HMAC token for the user's
// latest readiness-report checkpoint. No separate plan gate: a report
// only exists for Starter+ users in the first place (see
// getReadinessCertificateToken's own comment). Must also come before
// /:id for the same reason as readiness-report above.
router.get('/readiness-report/certificate-token', authMiddleware, requireVerified, requireStarterTier, getReadinessCertificateToken);
router.get('/:id/share-token',       authMiddleware, requireVerified, validateUUIDParam('id'), getShareToken);
router.get('/:id/certificate-token', authMiddleware, requireVerified, validateUUIDParam('id'), getSessionCertificateToken);
// Friend score comparison — create a challenge for a specific question.
// POST so it creates a new comparison row; body carries question_index.
router.post('/:id/compare',          authMiddleware, requireVerified, validateUUIDParam('id'), createComparisonToken);
router.get('/:id',                   authMiddleware, requireVerified, validateUUIDParam('id'), getSession);

export default router;
