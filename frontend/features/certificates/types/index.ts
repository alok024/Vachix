/**
 * features/certificates/types/index.ts
 *
 * Types for the public, unauthenticated certificate page, and for the
 * auth-required "mint a certificate" calls used from the session-summary
 * and dashboard pages. Mirrors features/reports/types/index.ts's shape.
 */

/** GET /api/certificate/:token — public, no auth required.
 *  Field names are camelCase here because they mirror the backend's
 *  CertificateContent interface verbatim (certificates.service.ts) —
 *  ok(res, content) serializes that object as-is, with no case
 *  transformation, unlike most other endpoints in this app that use
 *  snake_case. Keep this in sync with that interface if it changes. */
export interface CertificateContentResponse {
  kind:        'session' | 'readiness';
  userName:    string;
  headline:    string;
  scoreLabel:  string;
  subtext:     string;
  issuedAtIso: string;
}

/**
 * GET /api/sessions/:id/certificate-token  (auth required)
 * GET /api/sessions/readiness-report/certificate-token  (auth required)
 */
export interface CertificateTokenResponse {
  certificate_token: string;
  certificate_url:   string;
  image_url:         string;
}
