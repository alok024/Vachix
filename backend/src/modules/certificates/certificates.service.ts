/**
 * Readiness Certificate Service
 *
 * Extends the existing shareable-report system (reports.service.ts) with a
 * branded, shareable certificate image — something a candidate can post
 * on LinkedIn or send a recruiter, rather than a full report page.
 *
 * Two certificate types, both public/no-auth once a token is issued:
 *
 *   session    — a single completed interview session ("scored 8.5/10 on
 *                a Backend Engineer mock interview").
 *   readiness  — a readiness-report checkpoint (the every-5-sessions trend
 *                rollup from readiness-report.service.ts). Inherits that
 *                feature's Starter+ gate for free: a readiness token can
 *                only be minted for a session_count that already has a
 *                row in readiness_reports, which only Starter+ users ever
 *                generate in the first place.
 *
 * Token format and security model deliberately mirror reports.service.ts's
 * encodeShareToken/decodeShareToken (HMAC-SHA256, truncated 128-bit MAC,
 * constant-time compare) — same reasoning applies: a forgeable token would
 * let anyone mint a certificate for a session/report they don't own. The
 * payload is namespaced ("session:<id>" / "readiness:<userId>:<count>")
 * rather than a bare UUID so a session share-token and a certificate token
 * can never be replayed as each other even though both are HMAC'd with
 * REPORT_SECRET.
 *
 * Output is server-rendered SVG, not a rasterised PNG/PDF:
 *   - No new dependency (no canvas/sharp/puppeteer — this backend has zero
 *     image-rendering libs today, and native-binding libs like node-canvas
 *     are a common source of broken deploys on serverless/edge runtimes).
 *   - SVG is plain text, deterministic, and renders natively in <img>,
 *     social link-preview crawlers, and browsers — sufficient for "shareable
 *     branded image." If a rasterised PNG/PDF download is wanted later,
 *     that's a client-side SVG→canvas conversion, not a backend concern.
 */

import crypto from 'crypto';
import { env } from '../../core/config/env';
import { db } from '../../core/database/client';
import { logger } from '../../infra/logger';

const log = logger.child({ module: 'certificates' });

const MAC_BYTES = 16; // matches reports.service.ts — 128-bit truncated HMAC

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBuffer(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad    = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(pad), 'base64');
}

function signPayload(payload: string): Buffer {
  return crypto
    .createHmac('sha256', env.REPORT_SECRET)
    .update(payload, 'utf8')
    .digest()
    .subarray(0, MAC_BYTES);
}

export type CertificatePayload =
  | { kind: 'session';   sessionId: string }
  | { kind: 'readiness'; userId: string; sessionCount: number };

function encodePayloadString(payload: CertificatePayload): string {
  return payload.kind === 'session'
    ? `session:${payload.sessionId}`
    : `readiness:${payload.userId}:${payload.sessionCount}`;
}

function decodePayloadString(raw: string): CertificatePayload | null {
  if (raw.startsWith('session:')) {
    const sessionId = raw.slice('session:'.length);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
      return null;
    }
    return { kind: 'session', sessionId };
  }

  if (raw.startsWith('readiness:')) {
    const rest = raw.slice('readiness:'.length);
    const lastColon = rest.lastIndexOf(':');
    if (lastColon < 0) return null;

    const userId       = rest.slice(0, lastColon);
    const countStr     = rest.slice(lastColon + 1);
    const sessionCount = Number(countStr);

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return null;
    if (!Number.isInteger(sessionCount) || sessionCount <= 0) return null;

    return { kind: 'readiness', userId, sessionCount };
  }

  return null;
}

export function encodeCertificateToken(payload: CertificatePayload): string {
  const raw     = encodePayloadString(payload);
  const idPart  = b64url(Buffer.from(raw, 'utf8'));
  const macPart = b64url(signPayload(raw));
  return `${idPart}.${macPart}`;
}

export function decodeCertificateToken(token: string): CertificatePayload | null {
  try {
    const dotIndex = token.lastIndexOf('.');
    if (dotIndex < 0) return null;

    const idPart  = token.slice(0, dotIndex);
    const macPart = token.slice(dotIndex + 1);
    if (!idPart || !macPart) return null;

    const raw = b64urlToBuffer(idPart).toString('utf8');

    const expectedMac = signPayload(raw);
    const givenMac     = b64urlToBuffer(macPart);
    if (givenMac.length !== expectedMac.length) return null;
    if (!crypto.timingSafeEqual(givenMac, expectedMac)) return null;

    return decodePayloadString(raw);
  } catch {
    return null;
  }
}

// Certificate content shape — what the SVG renderer needs, independent of
// which payload kind produced it. Keeps renderCertificateSvg() agnostic to
// the session-vs-readiness distinction.

export interface CertificateContent {
  kind:           'session' | 'readiness';
  userName:       string;
  headline:       string;   // e.g. "Backend Engineer Mock Interview" or "5-Session Readiness Checkpoint"
  scoreLabel:     string;   // e.g. "8.5" or "7.2 avg"
  subtext:        string;   // e.g. "Completed Jun 18, 2026" or "Sessions 1–5"
  issuedAtIso:    string;
}

/**
 * Resolves a decoded certificate payload into renderable content,
 * re-fetching from the DB so the certificate always reflects current
 * data (not whatever was true when the token was minted) — same
 * "fetch fresh, don't trust the token for content" approach as
 * reports.service.ts's getPublicReport.
 *
 * Returns null if the underlying session/report no longer exists, or
 * (for readiness certificates) hasn't been generated yet — both treated
 * as "not found" rather than an error, since both are normal states
 * (e.g. a deleted session, or a forged/guessed-but-still-correctly-signed
 * count that just doesn't have a row yet — impossible without the secret,
 * but checked anyway since DB state can change after a token was minted).
 */
export async function resolveCertificateContent(
  payload: CertificatePayload,
): Promise<CertificateContent | null> {
  if (payload.kind === 'session') {
    const session = await fetchSessionByIdUnrestricted(payload.sessionId);
    if (!session) return null;

    const user = await db.getUserById(session.user_id);

    return {
      kind:        'session',
      userName:    user?.name || 'Vachix User',
      headline:    `${session.profession || 'General'} Interview`,
      scoreLabel:  formatScore(session.score),
      subtext:     `${capitalize(session.difficulty || '')} · ${session.interview_type || 'Mock Interview'}`,
      issuedAtIso: session.created_at || new Date().toISOString(),
    };
  }

  // readiness
  const [user, history] = await Promise.all([
    db.getUserById(payload.userId),
    db.getReadinessReportHistory(payload.userId),
  ]);

  const report = history.find(r => r.session_count === payload.sessionCount);
  if (!report) {
    log.warn('resolveCertificateContent: readiness payload decoded but no matching report found', {
      userId: payload.userId, sessionCount: payload.sessionCount,
    });
    return null;
  }

  const rangeStart = payload.sessionCount - 4;

  return {
    kind:        'readiness',
    userName:    user?.name || 'Vachix User',
    headline:    'Interview Readiness Checkpoint',
    scoreLabel:  report.avg_score != null ? formatScore(report.avg_score) : '—',
    subtext:     `Sessions ${rangeStart}–${payload.sessionCount}`,
    issuedAtIso: report.created_at || new Date().toISOString(),
  };
}

function formatScore(score: number | null | undefined): string {
  if (score == null) return '—';
  return Number.isInteger(score) ? `${score}.0` : score.toFixed(1);
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Session fetch without user_id restriction — certificates are public,
// same reasoning as fetchSessionById in reports.service.ts. Duplicated
// rather than imported: reports.service.ts doesn't export its version,
// and pulling in the whole module for one query isn't worth the coupling.
async function fetchSessionByIdUnrestricted(sessionId: string) {
  const url = `${env.SUPABASE_URL}/rest/v1/sessions?id=eq.${sessionId}&select=*`;
  const res = await fetch(url, {
    headers: {
      'apikey':        env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) return null;
  const rows = await res.json() as Array<{
    id?: string; user_id: string; profession: string; difficulty: string;
    interview_type: string; score: number; created_at?: string;
  }>;
  return rows[0] ?? null;
}

// ── SVG rendering ────────────────────────────────────────────

// Brand tokens — match frontend/app/(public)/report/page.tsx exactly, so
// a certificate and the report page it extends look like the same product.
const BG          = '#0A0B10';
const CARD        = '#13151C';
const ACCENT      = '#4F8EF7';
const ACCENT_SOFT = '#6ba3f9';
const TEXT        = '#FFFFFF';
const TEXT_DIM    = 'rgba(255,255,255,0.55)';
const TEXT_FAINT  = 'rgba(255,255,255,0.30)';
const BORDER      = 'rgba(255,255,255,0.07)';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatIssuedDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return '';
  }
}

/**
 * Renders a 1200×630 SVG certificate (matches the standard social
 * link-preview aspect ratio — LinkedIn/Twitter/OG image size — so it
 * drops straight into a share card without cropping).
 */
export function renderCertificateSvg(content: CertificateContent, certUrl: string): string {
  const name      = escapeXml(content.userName);
  const headline  = escapeXml(content.headline);
  const subtext   = escapeXml(content.subtext);
  const score     = escapeXml(content.scoreLabel);
  const issued    = escapeXml(formatIssuedDate(content.issuedAtIso));
  const badge     = content.kind === 'readiness' ? 'READINESS CHECKPOINT' : 'INTERVIEW CERTIFICATE';
  const urlText   = escapeXml(certUrl.replace(/^https?:\/\//, ''));
  const badgeWidth = 36 + badge.length * 9.2;
  const badgeX     = 1112 - badgeWidth;

  // Fit the recipient name to the card width. There's no real text-
  // measurement API server-side (no canvas/font-metrics dependency in
  // this backend — see file header), so this approximates rendered
  // width per character at the default 52px bold weight and scales the
  // font size down if a long name (e.g. a long full name with multiple
  // words) would otherwise overflow past the card's right edge. Floor
  // of 28px keeps even a very long name legible rather than shrinking
  // to nothing.
  //
  // AVG_CHAR_WIDTH_RATIO was calibrated against an actual rendered SVG
  // (measured pixel bounding box of a 33-char name), not guessed —
  // an earlier 0.56 estimate under-shot real rendered width by ~10%,
  // which let exactly this kind of long name overflow the card
  // uncaught. 0.62 plus the reduced NAME_MAX_WIDTH margin below both
  // build in slack so the estimate errs toward shrinking slightly too
  // early rather than not enough.
  const NAME_MAX_WIDTH   = 980;  // card inner width (1104 - 2*40 margin) minus a safety margin
  const NAME_BASE_SIZE   = 52;
  const NAME_MIN_SIZE    = 28;
  const AVG_CHAR_WIDTH_RATIO = 0.62;
  const estimatedWidthAtBase = content.userName.length * NAME_BASE_SIZE * AVG_CHAR_WIDTH_RATIO;
  const nameFontSize = estimatedWidthAtBase > NAME_MAX_WIDTH
    ? Math.max(NAME_MIN_SIZE, Math.floor(NAME_BASE_SIZE * (NAME_MAX_WIDTH / estimatedWidthAtBase)))
    : NAME_BASE_SIZE;
  // Baseline shifts down slightly less for a smaller font so the block
  // doesn't drift too far from the headline below it.
  const nameY = nameFontSize < NAME_BASE_SIZE ? 274 : 282;

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${BG}"/>
      <stop offset="100%" stop-color="#0d0f17"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="${ACCENT_SOFT}"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bgGrad)"/>
  <rect x="0" y="0" width="1200" height="6" fill="url(#accentGrad)"/>

  <!-- outer card -->
  <rect x="48" y="48" width="1104" height="534" rx="24" fill="${CARD}" stroke="${BORDER}" stroke-width="1"/>

  <!-- wordmark -->
  <text x="88" y="124" font-size="28" font-weight="800" fill="${TEXT}" letter-spacing="-0.5">Vachix</text>

  <!-- badge -->
  <rect x="${badgeX}" y="96" width="${badgeWidth}" height="34" rx="17" fill="rgba(79,142,247,0.12)" stroke="rgba(79,142,247,0.3)" stroke-width="1"/>
  <text x="${badgeX + badgeWidth / 2}" y="118" font-size="12" font-weight="700" fill="${ACCENT_SOFT}" letter-spacing="1.5" text-anchor="middle">${badge}</text>

  <!-- recipient -->
  <text x="88" y="230" font-size="20" fill="${TEXT_DIM}" letter-spacing="0.5">This certifies that</text>
  <text x="88" y="${nameY}" font-size="${nameFontSize}" font-weight="800" fill="${TEXT}" letter-spacing="-1">${name}</text>

  <!-- headline / subtext -->
  <text x="88" y="328" font-size="22" fill="${TEXT_DIM}">${headline}</text>
  <text x="88" y="358" font-size="16" fill="${TEXT_FAINT}">${subtext}</text>

  <!-- score block -->
  <text x="88" y="478" font-size="96" font-weight="800" fill="${ACCENT}" letter-spacing="-2">${score}</text>
  ${content.kind === 'session' ? `<text x="${88 + score.length * 56 + 12}" y="478" font-size="28" fill="${TEXT_FAINT}">/10</text>` : ''}

  <!-- issued date -->
  <text x="88" y="538" font-size="14" fill="${TEXT_FAINT}">Issued ${issued}</text>

  <!-- verification footer -->
  <line x1="88" y1="556" x2="1112" y2="556" stroke="${BORDER}" stroke-width="1"/>
  <text x="88" y="578" font-size="12" fill="${TEXT_FAINT}">Verify at ${urlText}</text>
</svg>`;
}
