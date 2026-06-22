import { Request, Response } from 'express';
import { asyncHandler } from '../../core/middleware';
import { db } from '../../core/database/client';
import { trackEvent } from '../analytics/events.service';
import { ok, notFound, badRequest } from '../../core/utils/response';
import { env } from '../../core/config/env';
import {
  encodeCertificateToken,
  decodeCertificateToken,
  resolveCertificateContent,
  renderCertificateSvg,
} from './certificates.service';

// Derives the backend's own public origin (scheme + host) from the
// incoming request, rather than a dedicated env var — there isn't one
// today (only FRONTEND_URL exists), and app.ts already sets
// `trust proxy` so req.protocol/req.get('host') are reliable behind
// whatever reverse proxy/load balancer sits in front of this service.
function requestOrigin(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

// GET /api/sessions/:id/certificate-token  (auth required — only session owner)
// Mirrors getShareToken in reports.controller.ts.
export const getSessionCertificateToken = asyncHandler(async (req: Request, res: Response) => {
  const userId    = req.user!.id;
  const sessionId = req.params.id;

  const session = await db.getSessionById(sessionId, userId);
  if (!session) {
    notFound(res, 'Session not found');
    return;
  }

  const token   = encodeCertificateToken({ kind: 'session', sessionId: String(session.id!) });
  const certUrl = `${env.FRONTEND_URL}/certificate?id=${token}`;

  trackEvent({
    event:     'certificate_issued',
    userId,
    sessionId,
    path:      '/api/sessions/:id/certificate-token',
    properties: { kind: 'session', cert_url: certUrl },
  });

  ok(res, {
    certificate_token: token,
    certificate_url:   certUrl,
    image_url:         `${requestOrigin(req)}/api/certificate/${token}.svg`,
  });
});

// GET /api/sessions/readiness-report/certificate-token  (auth required, Starter+
// already enforced by requireStarterTier on the readiness-report route group —
// see sessions.routes.ts. A readiness certificate can only be minted for a
// session_count that already has a generated report, so there is no
// additional plan check needed here: no report exists for Free users.)
export const getReadinessCertificateToken = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const report = await db.getLatestReadinessReport(userId);
  if (!report) {
    notFound(res, 'No readiness report generated yet');
    return;
  }

  const token   = encodeCertificateToken({
    kind: 'readiness', userId, sessionCount: report.session_count,
  });
  const certUrl = `${env.FRONTEND_URL}/certificate?id=${token}`;

  trackEvent({
    event:     'certificate_issued',
    userId,
    sessionId: null,
    path:      '/api/sessions/readiness-report/certificate-token',
    properties: { kind: 'readiness', session_count: report.session_count, cert_url: certUrl },
  });

  ok(res, {
    certificate_token: token,
    certificate_url:   certUrl,
    image_url:         `${requestOrigin(req)}/api/certificate/${token}.svg`,
  });
});

// GET /api/certificate/:token  (public — no auth)
// Returns the certificate content as JSON, same pattern as getReport in
// reports.controller.ts — used by the frontend /certificate page to render
// an interactive view (with a "download/share" action) rather than the raw SVG.
export const getCertificateData = asyncHandler(async (req: Request, res: Response) => {
  const payload = decodeCertificateToken(req.params.token);
  if (!payload) {
    notFound(res, 'Certificate not found or invalid link');
    return;
  }

  const content = await resolveCertificateContent(payload);
  if (!content) {
    notFound(res, 'Certificate not found or invalid link');
    return;
  }

  trackEvent({
    event:     'certificate_viewed',
    userId:    null,
    sessionId: payload.kind === 'session' ? payload.sessionId : null,
    path:      '/api/certificate/:token',
    properties: { kind: payload.kind, viewer_ip: req.ip ?? null },
  });

  ok(res, content);
});

// GET /api/certificate/:token.svg  (public — no auth)
// The actual shareable image — served directly as image/svg+xml so it can
// be used as a social link-preview image, dropped into an <img src>, or
// downloaded. Token validity (not "is this an SVG request") drives the
// 404 here too, so a bad/expired token never leaks whether *some* token
// would have worked.
export const getCertificateSvg = asyncHandler(async (req: Request, res: Response) => {
  // Express route param includes the .svg suffix added in the path pattern
  // below (see certificates.routes.ts) — token itself has no extension.
  const token = req.params.token;
  const payload = decodeCertificateToken(token);
  if (!payload) {
    badRequest(res, 'Invalid certificate link', 'invalid_certificate_token');
    return;
  }

  const content = await resolveCertificateContent(payload);
  if (!content) {
    notFound(res, 'Certificate not found');
    return;
  }

  const certUrl = `${env.FRONTEND_URL}/certificate?id=${token}`;
  const svg = renderCertificateSvg(content, certUrl);

  res.setHeader('Content-Type', 'image/svg+xml');
  // Certificates reflect DB state at resolve time but the underlying data
  // (score, name) rarely changes after the fact — short cache is a
  // reasonable balance between freshness and not re-rendering on every
  // social-crawler hit. Mirrors REPORT_CACHE_TTL_S's reasoning in
  // reports.service.ts, applied at the HTTP layer instead of Redis since
  // SVG string-building is cheap enough not to need a cache store.
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(svg);
});
