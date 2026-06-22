import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getCertificateData, getCertificateSvg } from './certificates.controller';

const router = Router();

// H3-equivalent: defense-in-depth rate limiting on the public certificate
// endpoints, same posture as reports.routes.ts's reportLimiter — HMAC
// signing already prevents forging a token, but this slows down
// enumeration/scraping attempts against valid-looking tokens.
const certificateLimiter = rateLimit({
  windowMs: 60_000,
  max:      60,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' } },
});

// Public: GET /api/certificate/:token       → JSON content (frontend /certificate page)
// Public: GET /api/certificate/:token.svg   → the actual shareable image
//
// Two routes rather than a content-negotiated single route: the .svg
// path needs to be a stable, direct image URL (usable in <img src>,
// link-preview crawlers, downloads) independent of Accept headers, which
// crawlers/social platforms often don't send the way a browser would.
router.get('/:token.svg', certificateLimiter, getCertificateSvg);
router.get('/:token',     certificateLimiter, getCertificateData);

export default router;
