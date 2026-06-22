/**
 * features/certificates/api/index.ts
 *
 * HTTP calls for certificates. getCertificate is public/no-auth (the
 * shared-link landing page); the two token-minting calls require auth
 * and are used from session-summary / readiness-report views where the
 * user can generate a shareable certificate for their own data.
 */
import { apiCall } from '@/lib/api';
import type { CertificateContentResponse, CertificateTokenResponse } from '../types';

export const certificatesApi = {
  /** Public — fetches certificate content for the /certificate?id=<token> page. */
  getCertificate: (token: string) =>
    apiCall<CertificateContentResponse>(`/certificate/${token}`),

  /** Auth required — mints a shareable certificate for a single completed session. */
  getSessionCertificateToken: (sessionId: string) =>
    apiCall<CertificateTokenResponse>(`/sessions/${sessionId}/certificate-token`),

  /** Auth required — mints a shareable certificate for the user's latest
   *  readiness-report checkpoint (Starter+; 404s if none exists yet). */
  getReadinessCertificateToken: () =>
    apiCall<CertificateTokenResponse>('/sessions/readiness-report/certificate-token'),
};
