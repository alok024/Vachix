/**
 * Weekly Progress Card Service
 *
 * Generates a 1200×630 SVG progress card for each active user and
 * optionally pushes a Web Push notification linking to it.
 *
 * Called exclusively from the BullMQ 'weekly-progress-cards' job,
 * which fires every Sunday at 08:00 IST (02:30 UTC).
 *
 * Card content:
 *   - User name + plan badge
 *   - Sessions completed in the past 7 days
 *   - Average score this week vs last week (delta arrow)
 *   - Current streak
 *   - Top weak area (if any)
 *
 * The card SVG is stored on the user record (weekly_card_url). Since
 * this backend serves the SVG directly from a public route (same
 * pattern as /api/certificate/:token.svg), no object storage is needed.
 * The URL is: <BACKEND_ORIGIN>/api/weekly-card/<userId>
 *
 * Push notification:
 *   Delivered only if the user has at least one push_subscription row.
 *   Uses web-push (RFC 8030 / VAPID). On any send failure the error is
 *   logged but does not abort the card generation for that user.
 *   A 410 Gone response from the push service (subscription expired)
 *   causes the subscription row to be deleted rather than retried.
 */

import webpush from 'web-push';
import { db } from '../../core/database/client';
import { env } from '../../core/config/env';
import { logger } from '../../infra/logger';

const log = logger.child({ module: 'weekly-card' });

// ── VAPID init ─────────────────────────────────────────────────────────────
// Called once at process start (from app.ts). Safe to call multiple times
// (web-push silently overwrites the keys).
export function initVapid(): void {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    log.warn('VAPID keys not configured — web push notifications disabled');
    return;
  }
  webpush.setVapidDetails(
    `mailto:${env.VAPID_CONTACT_EMAIL}`,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
  log.info('VAPID keys configured');
}

// ── Weekly stats helpers ───────────────────────────────────────────────────

interface WeeklyStats {
  sessionsThisWeek:  number;
  avgScoreThisWeek:  number | null;
  avgScoreLastWeek:  number | null;
  streak:            number;
  topWeakArea:       string | null;
}

async function getWeeklyStats(userId: string): Promise<WeeklyStats> {
  // IST = UTC+5:30
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const MS_PER_DAY    = 24 * 60 * 60 * 1000;

  // Shift now into IST by adding the offset. The resulting ms value can be
  // treated as "UTC midnight of the IST date" once we floor it to a day
  // boundary — no Date object needed, no setHours(), no server-timezone
  // dependency. setHours(0,0,0,0) used to do this, but it uses the server's
  // local timezone, which would silently produce wrong results on any server
  // not in UTC.
  const nowIST_ms            = Date.now() + IST_OFFSET_MS;
  const todayMidnightIST_ms  = nowIST_ms - (nowIST_ms % MS_PER_DAY);
  const thisWeekStartIST_ms  = todayMidnightIST_ms - 7 * MS_PER_DAY;
  const lastWeekStartIST_ms  = thisWeekStartIST_ms  - 7 * MS_PER_DAY;

  // Shift back to UTC for DB comparisons (sessions.created_at is stored in UTC).
  const thisWeekStartUTC = new Date(thisWeekStartIST_ms - IST_OFFSET_MS).toISOString();
  const lastWeekStartUTC = new Date(lastWeekStartIST_ms - IST_OFFSET_MS).toISOString();

  const [allSessions, weakAreas, stats] = await Promise.all([
    db.getRecentCompletedSessions(userId, 30),  // enough for 2 weeks
    db.getWeakAreas(userId),
    db.getStats(userId),
  ]);

  const thisWeek = allSessions.filter(
    s => s.created_at && s.created_at >= thisWeekStartUTC
  );
  const lastWeek = allSessions.filter(
    s => s.created_at && s.created_at >= lastWeekStartUTC && s.created_at < thisWeekStartUTC
  );

  const avgOf = (rows: typeof allSessions): number | null => {
    const scored = rows.filter(s => s.score != null);
    if (!scored.length) return null;
    return scored.reduce((sum, s) => sum + (s.score ?? 0), 0) / scored.length;
  };

  return {
    sessionsThisWeek: thisWeek.length,
    avgScoreThisWeek: avgOf(thisWeek),
    avgScoreLastWeek: avgOf(lastWeek),
    streak:           stats?.streak ?? 0,
    topWeakArea:      weakAreas[0]?.topic ?? null,
  };
}

// ── SVG renderer ──────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmtScore(n: number | null): string {
  if (n == null) return '—';
  return n.toFixed(1);
}

function deltaArrow(curr: number | null, prev: number | null): { symbol: string; color: string } {
  if (curr == null || prev == null) return { symbol: '', color: 'rgba(255,255,255,0.4)' };
  const diff = curr - prev;
  if (Math.abs(diff) < 0.1)       return { symbol: '→', color: 'rgba(255,255,255,0.4)' };
  if (diff > 0)                    return { symbol: '↑', color: '#4ade80' };
  return                                  { symbol: '↓', color: '#f87171' };
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function renderWeeklyCardSvg(
  userName:  string,
  plan:      string,
  stats:     WeeklyStats,
  weekLabel: string,
): string {
  const BG          = '#0A0B10';
  const CARD        = '#13151C';
  const ACCENT      = '#4F8EF7';
  const ACCENT_SOFT = '#6ba3f9';
  const TEXT        = '#FFFFFF';
  const TEXT_DIM    = 'rgba(255,255,255,0.55)';
  const TEXT_FAINT  = 'rgba(255,255,255,0.30)';
  const BORDER      = 'rgba(255,255,255,0.07)';

  const name   = escapeXml(userName);
  const week   = escapeXml(weekLabel);
  const plan_  = escapeXml(plan.charAt(0).toUpperCase() + plan.slice(1));
  const delta  = deltaArrow(stats.avgScoreThisWeek, stats.avgScoreLastWeek);
  const thisScore = fmtScore(stats.avgScoreThisWeek);
  const lastScore = fmtScore(stats.avgScoreLastWeek);
  const weakArea  = stats.topWeakArea ? escapeXml(stats.topWeakArea) : null;

  // Name font-size scaling (same approach as certificates.service.ts)
  const NAME_MAX_WIDTH = 860;
  const NAME_BASE_SIZE = 48;
  const NAME_MIN_SIZE  = 26;
  const AVG_CHAR_RATIO = 0.62;
  const estimatedW     = userName.length * NAME_BASE_SIZE * AVG_CHAR_RATIO;
  const nameFontSize   = estimatedW > NAME_MAX_WIDTH
    ? Math.max(NAME_MIN_SIZE, Math.floor(NAME_BASE_SIZE * (NAME_MAX_WIDTH / estimatedW)))
    : NAME_BASE_SIZE;

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${BG}"/>
      <stop offset="100%" stop-color="#0d0f17"/>
    </linearGradient>
    <linearGradient id="acc" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="${ACCENT_SOFT}"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="6" fill="url(#acc)"/>

  <!-- card -->
  <rect x="48" y="48" width="1104" height="534" rx="24" fill="${CARD}" stroke="${BORDER}" stroke-width="1"/>

  <!-- wordmark -->
  <text x="88" y="118" font-size="26" font-weight="800" fill="${TEXT}" letter-spacing="-0.5">Vachix</text>

  <!-- plan badge -->
  <rect x="152" y="96" width="${24 + plan_.length * 8.5}" height="28" rx="14" fill="rgba(79,142,247,0.12)" stroke="rgba(79,142,247,0.3)" stroke-width="1"/>
  <text x="${152 + (24 + plan_.length * 8.5) / 2}" y="115" font-size="11" font-weight="700" fill="${ACCENT_SOFT}" letter-spacing="1.2" text-anchor="middle">${plan_}</text>

  <!-- week label -->
  <text x="1112" y="118" font-size="13" fill="${TEXT_FAINT}" text-anchor="end">${week}</text>

  <!-- name -->
  <text x="88" y="196" font-size="18" fill="${TEXT_DIM}" letter-spacing="0.5">Weekly summary for</text>
  <text x="88" y="${196 + nameFontSize + 8}" font-size="${nameFontSize}" font-weight="800" fill="${TEXT}" letter-spacing="-1">${name}</text>

  <!-- divider -->
  <line x1="88" y1="268" x2="1112" y2="268" stroke="${BORDER}" stroke-width="1"/>

  <!-- stat: sessions -->
  <text x="88" y="312" font-size="13" fill="${TEXT_FAINT}" letter-spacing="0.5">SESSIONS THIS WEEK</text>
  <text x="88" y="370" font-size="72" font-weight="800" fill="${ACCENT}" letter-spacing="-2">${stats.sessionsThisWeek}</text>

  <!-- stat: avg score -->
  <text x="360" y="312" font-size="13" fill="${TEXT_FAINT}" letter-spacing="0.5">AVG SCORE</text>
  <text x="360" y="362" font-size="64" font-weight="800" fill="${TEXT}" letter-spacing="-2">${thisScore}</text>
  <text x="${360 + 64 * thisScore.length * 0.56 + 8}" y="362" font-size="28" fill="${delta.color}" font-weight="700">${delta.symbol}</text>
  <text x="360" y="390" font-size="14" fill="${TEXT_FAINT}">vs ${lastScore} last week</text>

  <!-- stat: streak -->
  <text x="700" y="312" font-size="13" fill="${TEXT_FAINT}" letter-spacing="0.5">STREAK</text>
  <text x="700" y="362" font-size="64" font-weight="800" fill="${TEXT}" letter-spacing="-2">${stats.streak}</text>
  <text x="700" y="390" font-size="14" fill="${TEXT_FAINT}">day${stats.streak !== 1 ? 's' : ''}</text>

  <!-- weak area -->
  ${weakArea
    ? `<text x="88" y="448" font-size="13" fill="${TEXT_FAINT}" letter-spacing="0.5">FOCUS AREA</text>
  <text x="88" y="490" font-size="28" font-weight="700" fill="${TEXT}">${weakArea}</text>`
    : `<text x="88" y="490" font-size="20" fill="${TEXT_FAINT}">Keep practising to unlock your focus area</text>`
  }

  <!-- footer -->
  <line x1="88" y1="542" x2="1112" y2="542" stroke="${BORDER}" stroke-width="1"/>
  <text x="88" y="566" font-size="13" fill="${TEXT_FAINT}">vachix.in · Keep going 🚀</text>
</svg>`;
}

// ── Push notification sender ───────────────────────────────────────────────

async function sendPushToUser(
  userId:  string,
  payload: { title: string; body: string; url: string },
): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;

  const subs = await db.getPushSubscriptions(userId);
  if (!subs.length) return;

  const json = JSON.stringify(payload);

  await Promise.allSettled(
    subs.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          json,
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          // Subscription expired/unregistered — clean it up
          await db.deletePushSubscription(sub.endpoint).catch(() => {});
          log.info('Removed expired push subscription', { userId, endpoint: sub.endpoint });
        } else {
          log.warn('Push send failed', { userId, endpoint: sub.endpoint, status, error: String(err) });
        }
      }
    })
  );
}

// ── Main entry point (called by BullMQ worker) ────────────────────────────

/**
 * Generates and stores a weekly card for all users who have completed
 * at least one session. Sends push notifications to subscribed users.
 *
 * Designed to be idempotent — re-running overwrites weekly_card_url with
 * a freshly generated SVG. No side-effects from duplicate runs.
 */
export async function generateWeeklyProgressCards(): Promise<void> {
  log.info('Weekly progress card generation started');

  const now      = new Date();
  const weekEnd  = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const weekLabel = `${weekStart} – ${weekEnd}`;

  // Paginate through all users who have any sessions
  const PAGE = 50;
  let offset  = 0;
  let total   = Infinity;
  let generated = 0;
  let pushed    = 0;

  while (offset < total) {
    const { users, total: t } = await db.getUsersPage(PAGE, offset);
    total  = t;
    offset += PAGE;

    await Promise.allSettled(
      users.map(async user => {
        try {
          const stats = await getWeeklyStats(user.id);

          // Skip users with zero activity ever
          if (stats.sessionsThisWeek === 0 && stats.streak === 0 && !stats.avgScoreThisWeek) {
            return;
          }

          const svg = renderWeeklyCardSvg(
            user.name || 'Vachix User',
            user.plan || 'free',
            stats,
            weekLabel,
          );

          // Store raw SVG on user row. The route /api/weekly-card/:userId
          // serves this directly — no object storage needed.
          await db.updateUser(user.id, { weekly_card_url: svg });
          generated++;

          // Push notification
          const hasSessions = stats.sessionsThisWeek > 0;
          const body = hasSessions
            ? `You did ${stats.sessionsThisWeek} session${stats.sessionsThisWeek !== 1 ? 's' : ''} this week. Avg score: ${fmtScore(stats.avgScoreThisWeek)}/10`
            : `Your streak is ${stats.streak} day${stats.streak !== 1 ? 's' : ''}. Keep it going!`;

          await sendPushToUser(user.id, {
            title: '📊 Your weekly Vachix summary is ready',
            body,
            url:   `${env.FRONTEND_URL}/progress`,
          });
          pushed++;
        } catch (err) {
          log.error('Weekly card generation failed for user', { userId: user.id, error: String(err) });
        }
      })
    );
  }

  log.info('Weekly progress card generation complete', { generated, pushed });
}
