/**
 * modules/user/results-board.service.ts
 *
 * Business logic for the Job Landed flow and public Results Board.
 *
 * Two responsibilities:
 *   1. recordJobLanded   — mark the user as job-landed in `users`,
 *                          optionally insert/update their results_board row.
 *   2. getResultsBoard   — paginated public read of results_board.
 */

import crypto from 'crypto';
import { db } from '../../core/database/client';
import { env } from '../../core/config/env';
import { logger } from '../../infra/logger';

const log = logger.child({ module: 'results-board' });

// ─── OG token ───────────────────────────────────────────────────────────────
// HMAC-SHA256 of user_id with JWT_SECRET as key.
// Used by /api/og/job-landed?token=... to verify the request without a DB
// lookup, identical pattern to the report share token in reports.service.ts.

export function buildOgToken(userId: string): string {
  return crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`og:job-landed:${userId}`)
    .digest('hex')
    .slice(0, 40); // 40 hex chars = 160 bits, sufficient
}

export function verifyOgToken(userId: string, token: string): boolean {
  const expected = buildOgToken(userId);
  // Constant-time comparison — avoids timing oracle on the token
  if (expected.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

// ─── Job-Landed recording ────────────────────────────────────────────────────

export interface JobLandedInput {
  userId:        string;
  role:          string;
  company?:      string;
  /** User's chosen public display name — may differ from account name */
  displayName:   string;
  /** Whether to opt into the public Results Board */
  showOnBoard:   boolean;
}

export interface JobLandedResult {
  /** URL of the generated OG share image */
  og_image_url:    string;
  /** Direct link to the user's Results Board entry (null if opted out) */
  results_board_url: string | null;
}

export async function recordJobLanded(input: JobLandedInput): Promise<JobLandedResult> {
  const { userId, role, company, displayName, showOnBoard } = input;

  // 1. Stamp the users row — idempotent (updateUser patches only these columns)
  await db.updateUser(userId, {
    job_landed_at:     new Date().toISOString(),
    job_landed_role:   role,
    job_landed_company: company ?? null,
  } as Parameters<typeof db.updateUser>[1]);

  log.info('job_landed recorded', { userId, role, company: company ?? null, showOnBoard });

  const ogToken = buildOgToken(userId);
  const ogImageUrl = `${env.FRONTEND_URL}/api/og/job-landed?uid=${userId}&token=${ogToken}`;

  // 2. Upsert results board entry if user opted in
  if (showOnBoard) {
    const stats = await db.getStats(userId);
    const avgScore = stats?.avg_job_ready_score ?? null;
    const sessionsCount = stats?.sessions ?? 0;

    await upsertResultsBoardEntry({
      userId,
      displayName,
      role,
      company:        company ?? null,
      sessionsCount,
      avgScore:       avgScore !== null ? Number(avgScore.toFixed(2)) : null,
      ogToken,
    });
  } else {
    // Remove from board if they previously opted in but now opted out
    await removeFromResultsBoard(userId);
  }

  return {
    og_image_url:      ogImageUrl,
    results_board_url: showOnBoard ? `${env.FRONTEND_URL}/results` : null,
  };
}

// ─── Results Board CRUD ──────────────────────────────────────────────────────

interface ResultsBoardEntry {
  userId:        string;
  displayName:   string;
  role:          string;
  company:       string | null;
  sessionsCount: number;
  avgScore:      number | null;
  ogToken:       string;
}

async function upsertResultsBoardEntry(entry: ResultsBoardEntry): Promise<void> {
  const body = {
    user_id:        entry.userId,
    display_name:   entry.displayName,
    role:           entry.role,
    company:        entry.company,
    sessions_count: entry.sessionsCount,
    avg_score:      entry.avgScore,
    og_token:       entry.ogToken,
  };

  // Supabase REST upsert: POST with Prefer: resolution=merge-duplicates
  // The UNIQUE(user_id) constraint handles dedup.
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_KEY;

  const res = await fetch(`${supabaseUrl}/rest/v1/results_board`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':         supabaseKey,
      'Authorization':  `Bearer ${supabaseKey}`,
      'Prefer':         'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`results_board upsert failed: ${res.status} ${text}`);
  }
}

async function removeFromResultsBoard(userId: string): Promise<void> {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_KEY;

  await fetch(
    `${supabaseUrl}/rest/v1/results_board?user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      headers: {
        'apikey':        supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    }
  );
  // DELETE of a non-existent row returns 200 with empty body — not an error
}

// ─── Public board read ───────────────────────────────────────────────────────

export interface ResultsBoardEntry_Public {
  id:             string;
  display_name:   string;
  role:           string;
  company:        string | null;
  sessions_count: number;
  avg_score:      number | null;
  og_image_url:   string;
  created_at:     string;
}

export interface ResultsBoardPage {
  entries:   ResultsBoardEntry_Public[];
  total:     number;
  page:      number;
  page_size: number;
}

export async function getResultsBoard(page = 1, pageSize = 20): Promise<ResultsBoardPage> {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_KEY;

  const offset = (page - 1) * pageSize;

  // Fetch the page + total count in parallel
  const [rowsRes, countRes] = await Promise.all([
    fetch(
      `${supabaseUrl}/rest/v1/results_board?select=id,display_name,role,company,sessions_count,avg_score,og_token,user_id,created_at&order=created_at.desc&limit=${pageSize}&offset=${offset}`,
      {
        headers: {
          'apikey':        supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Accept':        'application/json',
        },
      }
    ),
    fetch(
      `${supabaseUrl}/rest/v1/results_board?select=id`,
      {
        headers: {
          'apikey':         supabaseKey,
          'Authorization':  `Bearer ${supabaseKey}`,
          'Prefer':         'count=exact',
          'Range-Unit':     'items',
          'Range':          '0-0',
        },
      }
    ),
  ]);

  if (!rowsRes.ok) {
    throw new Error(`results_board fetch failed: ${rowsRes.status}`);
  }

  const rows = (await rowsRes.json()) as Array<{
    id: string;
    display_name: string;
    role: string;
    company: string | null;
    sessions_count: number;
    avg_score: number | null;
    og_token: string;
    user_id: string;
    created_at: string;
  }>;

  // Content-Range: items 0-19/43 → parse total
  const contentRange = countRes.headers.get('content-range') ?? '';
  const total = parseInt(contentRange.split('/')[1] ?? '0', 10) || rows.length;

  const entries: ResultsBoardEntry_Public[] = rows.map(r => ({
    id:             r.id,
    display_name:   r.display_name,
    role:           r.role,
    company:        r.company,
    sessions_count: r.sessions_count,
    avg_score:      r.avg_score,
    og_image_url:   `${env.FRONTEND_URL}/api/og/job-landed?uid=${r.user_id}&token=${r.og_token}`,
    created_at:     r.created_at,
  }));

  return { entries, total, page, page_size: pageSize };
}

// ─── Single user board entry (for OG image generation) ───────────────────────

/**
 * Fetches a single results_board row by user_id.
 * Used by the OG image route so it can do a direct indexed lookup instead of
 * scanning all board entries and hoping the target user is on page 1.
 * Returns null when the user has no board entry (opted out or not yet submitted).
 */
export async function getResultsBoardEntryByUserId(
  userId: string,
): Promise<ResultsBoardEntry_Public | null> {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_KEY;

  const res = await fetch(
    `${supabaseUrl}/rest/v1/results_board?user_id=eq.${encodeURIComponent(userId)}&select=id,display_name,role,company,sessions_count,avg_score,og_token,user_id,created_at&limit=1`,
    {
      headers: {
        'apikey':        supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Accept':        'application/json',
      },
    },
  );

  if (!res.ok) return null;

  const rows = (await res.json()) as Array<{
    id: string;
    display_name: string;
    role: string;
    company: string | null;
    sessions_count: number;
    avg_score: number | null;
    og_token: string;
    user_id: string;
    created_at: string;
  }>;

  if (!rows.length) return null;
  const r = rows[0];

  return {
    id:             r.id,
    display_name:   r.display_name,
    role:           r.role,
    company:        r.company,
    sessions_count: r.sessions_count,
    avg_score:      r.avg_score,
    og_image_url:   `${env.FRONTEND_URL}/api/og/job-landed?uid=${r.user_id}&token=${r.og_token}`,
    created_at:     r.created_at,
  };
}
