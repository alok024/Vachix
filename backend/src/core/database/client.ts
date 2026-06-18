/**
 * Supabase Database Client
 *
 * A typed wrapper around the Supabase REST API.
 * Every db.* method used anywhere in the codebase is implemented here.
 * Uses the service role key → bypasses RLS.
 */

import { AppError } from '../utils/errors';
import { env } from '../config/env';

// ── DB Row types ──────────────────────────────────────────────────

export interface UserRow {
  id:             string;
  email:          string;
  password_hash:  string;
  plan:           string;
  name:           string;
  email_verified?: boolean;
  referral_code?: string;
  referred_by?:   string;
  referral_bonus?: number;
  onboarding_profession?:   string | null;
  onboarding_goal?:         string | null;
  onboarding_completed_at?: string | null;
  is_admin?:      boolean;
  created_at?:    string;
  updated_at?:    string;
}

export interface EmailVerificationTokenRow {
  id?:         string;
  user_id:     string;
  token_hash:  string;
  expires_at:  string;
  used:        boolean;
  created_at?: string;
}

export interface EmailVerificationSendRow {
  id?:      string;
  user_id:  string;
  sent_at?: string;
}

export interface UsageRow {
  user_id:    string;
  call_count: number;
  updated_at?: string;
}

export interface StatsRow {
  user_id:                   string;
  streak:                    number;
  sessions:                  number;
  best_score:                number;
  total_score:               number;
  last_session?:             string;
  avg_job_ready_score?:      number;
  total_sessions_with_score?: number;
  clarity_avg?:              number;
  structure_avg?:            number;
  relevance_avg?:            number;
  grammar_avg?:              number;
  updated_at?:               string;
}

export interface SessionRow {
  id?:              string;
  client_session_id?: string;   // ← stable UUID from client; UNIQUE constraint prevents duplicate session rows on retry
  user_id:          string;
  status?:          'scoring' | 'completed' | 'abandoned';  // ← DB-enforced state machine column
  profession:       string;
  mode:             string;
  difficulty:       string;
  interview_type:   string;
  personality:      string;
  score:            number;
  exchanges:        number;
  duration_secs:    number;
  hindi_mode:       boolean;
  clarity_score?:   number;
  structure_score?: number;
  relevance_score?: number;
  grammar_score?:   number;
  job_ready_score?: number;
  created_at?:      string;
}

export interface FeedbackRow {
  id?:             string;
  session_id:      string;
  question_index:  number;   // ← position in the session; forms the idempotency key with session_id
  question:        string;
  answer:          string;
  score:           number;
  corrections:     string;
  tips:            string;
  structure:       string;
  model_answer:    string;
  created_at?:     string;
}

export interface SubscriptionRow {
  id?:                  string;
  user_id:              string;
  plan:                 string;
  status:               string;
  razorpay_order_id:    string;
  razorpay_payment_id:  string;
  started_at:           string;
  expires_at:           string;
  created_at?:          string;
}

export interface TokenBlacklistRow {
  token_jti:  string;
  user_id:    string;
  expires_at: string;
}

export interface PasswordResetRow {
  id?:        string;
  user_id:    string;
  token:      string;
  expires_at: string;
  used:       boolean;
}

export interface UserMistakeRow {
  id?:          string;
  user_id:      string;
  topic:        string;
  mistake_type: string;
  description:  string;
  occurrences:  number;
}

export interface WeakAreaRow {
  user_id:        string;
  topic:          string;
  avg_score:      number;
  session_count:  number;
  last_practiced: string | null;
  updated_at?:    string;
}

export interface ScoreHistoryRow {
  id?:             string;
  user_id:         string;
  session_id:      string;
  score:           number;
  job_ready_score: number;
  topic:           string;
  created_at?:     string;
}

export interface ReferralEventRow {
  id?:          string;
  referrer_id:  string;
  referred_id:  string;
  rewarded_at?: string | null;
  created_at?:  string;
}

export interface AnalyticsEventRow {
  id?:         string;
  user_id?:    string | null;
  session_id?: string | null;   // anonymous client session id (for pre-signup funnels)
  event:       string;          // e.g. 'page_view', 'signup', 'session_start', 'upgrade_click'
  properties?: Record<string, unknown> | null;
  path?:       string | null;
  plan?:       string | null;
  created_at?: string;
}

export interface B2BLeadRow {
  id:         string;
  name:       string;
  email:      string;
  org:        string;
  size:       string;
  org_type:   string | null;
  message:    string | null;
  status:     string;   // new | contacted | qualified | closed
  created_at: string;
}

// ── Raw Supabase REST helper ──────────────────────────────────────

async function sb<T = unknown>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body: unknown = null
): Promise<{ ok: boolean; status: number; data: T }> {
  const opts: RequestInit = {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Prefer':        'return=representation',
    },
  };
  if (body !== null) opts.body = JSON.stringify(body);

  const res  = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, opts);
  const raw  = await res.text();
  const data = (raw ? JSON.parse(raw) : null) as T;
  return { ok: res.ok, status: res.status, data };
}

// ── Database client ───────────────────────────────────────────────

export const db = {

  // ── Users ───────────────────────────────────────────────────────

  async getUserByEmail(email: string): Promise<UserRow | null> {
    const { data } = await sb<UserRow[]>(`/users?email=eq.${encodeURIComponent(email)}&select=*`);
    return data?.[0] ?? null;
  },

  async getUserById(id: string): Promise<UserRow | null> {
    const { data } = await sb<UserRow[]>(`/users?id=eq.${id}&select=*`);
    return data?.[0] ?? null;
  },

  async getUserByReferralCode(code: string): Promise<UserRow | null> {
    const { data } = await sb<UserRow[]>(`/users?referral_code=eq.${encodeURIComponent(code)}&select=*`);
    return data?.[0] ?? null;
  },

  async createUser(input: Omit<UserRow, 'id' | 'created_at' | 'updated_at'>): Promise<UserRow> {
    const { data, ok } = await sb<UserRow[]>('/users', 'POST', input);
    if (!ok || !data?.[0]) throw new AppError(500, 'db_user_creation_failed', 'Failed to create user');
    return data[0];
  },

  async updateUser(id: string, updates: Partial<UserRow>): Promise<void> {
    await sb(`/users?id=eq.${id}`, 'PATCH', updates);
  },

  async setReferralCode(userId: string, code: string): Promise<void> {
    const { ok } = await sb(`/users?id=eq.${userId}`, 'PATCH', { referral_code: code });
    if (!ok) throw new AppError(500, 'db_referral_code_failed', 'Failed to set referral code (may be duplicate)');
  },

  async setReferredBy(userId: string, code: string): Promise<void> {
    await sb(`/users?id=eq.${userId}`, 'PATCH', { referred_by: code });
  },

  async addBonusCalls(userId: string, amount: number): Promise<void> {
    // Use RPC for atomic increment — avoids the read-then-write race condition
    // where two concurrent referral rewards both read 0 and both write 10 instead of 20.
    await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/increment_referral_bonus`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_user_id: userId, p_amount: amount }),
    });
  },

  // ── Usage ───────────────────────────────────────────────────────

  async getUsage(userId: string): Promise<UsageRow | null> {
    const { data } = await sb<UsageRow[]>(`/usage?user_id=eq.${userId}&select=*`);
    return data?.[0] ?? null;
  },

  async upsertUsage(userId: string, callCount: number): Promise<void> {
    const existing = await db.getUsage(userId);
    if (existing) {
      await sb(`/usage?user_id=eq.${userId}`, 'PATCH', { call_count: callCount, updated_at: new Date().toISOString() });
    } else {
      await sb('/usage', 'POST', { user_id: userId, call_count: callCount });
    }
  },

  /**
   * Atomically increments usage via a Supabase RPC to avoid the
   * read-then-write race condition where two concurrent requests
   * both read the same call_count and both write callCount+1.
   *
   * Requires this function in Supabase SQL:
   *   CREATE OR REPLACE FUNCTION increment_usage(p_user_id uuid)
   *   RETURNS void LANGUAGE sql AS $$
   *     INSERT INTO usage (user_id, call_count, updated_at)
   *     VALUES (p_user_id, 1, now())
   *     ON CONFLICT (user_id)
   *     DO UPDATE SET call_count = usage.call_count + 1, updated_at = now();
   *   $$;
   */
  async incrementUsage(userId: string): Promise<void> {
    await sb('/rpc/increment_usage', 'POST', { p_user_id: userId });
  },

  async resetUsage(userId: string): Promise<void> {
    await sb(`/usage?user_id=eq.${userId}`, 'PATCH', {
      call_count: 0,
      updated_at: new Date().toISOString(),
    });
  },

  // ── Stats ───────────────────────────────────────────────────────

  async getStats(userId: string): Promise<StatsRow | null> {
    const { data } = await sb<StatsRow[]>(`/stats?user_id=eq.${userId}&select=*`);
    return data?.[0] ?? null;
  },

  /**
   * Atomically increments user stats with ALL arithmetic inside Postgres.
   *
   * Previous version still did read → compute → write in JS, meaning two
   * concurrent saves could race on the read and produce the same base values
   * before either write landed.  This version eliminates the JS read entirely:
   * the SQL function receives only the *delta* for this session and Postgres
   * applies it with a row-level lock held for the duration of the upsert.
   *
   * Streak logic lives in SQL too: if last_session was today → keep current
   * streak; if yesterday → +1; otherwise → reset to 1.
   *
   * Requires this function in Supabase SQL (see MIGRATION.sql):
   *   CREATE OR REPLACE FUNCTION increment_user_stats(
   *     p_user_id        uuid,
   *     p_score          numeric,
   *     p_job_ready      numeric,
   *     p_total_score    numeric
   *   ) RETURNS jsonb LANGUAGE plpgsql AS $$
   *   DECLARE
   *     v_today     date := now()::date;
   *     v_yesterday date := v_today - 1;
   *     v_last      date;
   *     v_streak    int;
   *     v_row       stats%ROWTYPE;
   *   BEGIN
   *     -- Lock the row for this user (or create it) before reading
   *     INSERT INTO stats (user_id, sessions, best_score, total_score,
   *                        avg_job_ready_score, total_sessions_with_score,
   *                        streak, last_session, updated_at)
   *     VALUES (p_user_id, 0, 0, 0, 0, 0, 0, null, now())
   *     ON CONFLICT (user_id) DO NOTHING;
   *
   *     SELECT * INTO v_row FROM stats WHERE user_id = p_user_id FOR UPDATE;
   *
   *     v_last   := v_row.last_session::date;
   *     v_streak := CASE
   *       WHEN v_last = v_today     THEN v_row.streak
   *       WHEN v_last = v_yesterday THEN v_row.streak + 1
   *       ELSE 1
   *     END;
   *
   *     UPDATE stats SET
   *       sessions                  = v_row.sessions + 1,
   *       best_score                = GREATEST(v_row.best_score, p_score),
   *       total_score               = v_row.total_score + p_total_score,
   *       avg_job_ready_score       = ROUND(
   *                                     ((v_row.avg_job_ready_score * v_row.total_sessions_with_score)
   *                                      + p_job_ready)
   *                                     / (v_row.total_sessions_with_score + 1), 2),
   *       total_sessions_with_score = v_row.total_sessions_with_score + 1,
   *       streak                    = v_streak,
   *       last_session              = now(),
   *       updated_at                = now()
   *     WHERE user_id = p_user_id;
   *
   *     SELECT * INTO v_row FROM stats WHERE user_id = p_user_id;
   *     RETURN jsonb_build_object(
   *       'sessions',   v_row.sessions,
   *       'best_score', v_row.best_score,
   *       'streak',     v_row.streak,
   *       'avg_job_ready_score', v_row.avg_job_ready_score
   *     );
   *   END;
   *   $$;
   */
  async incrementStats(
    userId:     string,
    score:      number,
    jobReady:   number,
    totalScore: number,
  ): Promise<{ sessions: number; best_score: number; streak: number; avg_job_ready_score: number }> {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/increment_user_stats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        p_user_id:     userId,
        p_score:       score,
        p_job_ready:   jobReady,
        p_total_score: totalScore,
      }),
    });
    return res.json() as Promise<{ sessions: number; best_score: number; streak: number; avg_job_ready_score: number }>;
  },

  /** @deprecated — use incrementStats. Kept for admin/backfill paths only. */
  async upsertStats(userId: string, updates: Partial<StatsRow>): Promise<void> {
    const existing = await db.getStats(userId);
    if (existing) {
      await sb(`/stats?user_id=eq.${userId}`, 'PATCH', { ...updates, updated_at: new Date().toISOString() });
    } else {
      await sb('/stats', 'POST', { user_id: userId, ...updates });
    }
  },

  // ── Sessions ────────────────────────────────────────────────────

  /**
   * Creates a session row in 'scoring' status.
   * client_session_id is the stable UUID sent by the frontend at the start of
   * the interview; the UNIQUE constraint on that column means a client retry
   * of POST /sessions returns the existing row (via ON CONFLICT DO NOTHING +
   * a follow-up SELECT) rather than inserting a duplicate.
   * See MIGRATION.sql for the constraint + column.
   */
  async createSession(input: Omit<SessionRow, 'id' | 'created_at'>): Promise<SessionRow> {
    // Attempt insert; ignore conflict on client_session_id
    await fetch(`${env.SUPABASE_URL}/rest/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify({ ...input, status: 'scoring' }),
    });
    // Always re-fetch by client_session_id so retries return the canonical row
    const { data } = await sb<SessionRow[]>(
      `/sessions?client_session_id=eq.${input.client_session_id}&select=*`
    );
    if (!data?.[0]) throw new AppError(500, 'db_session_creation_failed', 'Failed to create session record');
    return data[0];
  },

  /**
   * Transitions a session from 'scoring' → 'completed'.
   * The WHERE clause includes status='scoring' so a duplicate call (state machine
   * enforcement) is a no-op rather than an error — the row stays 'completed'
   * and the caller can read the result back.
   */
  async completeSession(sessionId: string): Promise<void> {
    await sb(
      `/sessions?id=eq.${sessionId}&status=eq.scoring`,
      'PATCH',
      { status: 'completed', updated_at: new Date().toISOString() }
    );
  },

  /**
   * Lifecycle enforcement (Issue 7) — sweeps sessions stuck in 'scoring'
   * status for longer than `olderThanMs` and marks them 'abandoned'.
   *
   * createSession() inserts a row in 'scoring' status; saveSession()
   * transitions it to 'completed' via completeSession() once scoring +
   * stats updates finish. If the client disconnects or the process
   * crashes mid-save, the row is orphaned in 'scoring' forever — no
   * other code path ever revisits it.
   *
   * WHERE status=eq.scoring makes this idempotent — re-running the
   * sweep only ever touches rows still stuck in 'scoring'.
   */
  async expireStaleSessions(olderThanMs: number): Promise<SessionRow[]> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const { data } = await sb<SessionRow[]>(
      `/sessions?status=eq.scoring&created_at=lt.${cutoff}`,
      'PATCH',
      { status: 'abandoned', updated_at: new Date().toISOString() }
    );
    return data ?? [];
  },

  async getUserSessions(userId: string, limit: number, offset: number): Promise<SessionRow[]> {
    const { data } = await sb<SessionRow[]>(
      `/sessions?user_id=eq.${userId}&order=created_at.desc&limit=${limit}&offset=${offset}&select=*`
    );
    return data ?? [];
  },

  async getSessionById(sessionId: string, userId: string): Promise<SessionRow | null> {
    const { data } = await sb<SessionRow[]>(
      `/sessions?id=eq.${sessionId}&user_id=eq.${userId}&select=*`
    );
    return data?.[0] ?? null;
  },

  /** Used by weak_areas.service — no user_id restriction, returns score + topic */
  async getUserSessionsForWeakAreas(userId: string): Promise<Array<Pick<SessionRow, 'score' | 'interview_type' | 'profession' | 'created_at'>>> {
    const { data } = await sb<SessionRow[]>(
      `/sessions?user_id=eq.${userId}&order=created_at.desc&limit=100&select=score,interview_type,profession,created_at`
    );
    return (data ?? []) as Array<Pick<SessionRow, 'score' | 'interview_type' | 'profession' | 'created_at'>>;
  },

  // ── Feedback ────────────────────────────────────────────────────

  /**
   * Insert a feedback row, ignoring duplicates keyed by (session_id, question_index).
   * Requires this unique constraint in Supabase:
   *   ALTER TABLE feedback ADD CONSTRAINT feedback_session_question_unique
   *     UNIQUE (session_id, question_index);
   *
   * The `prefer: resolution=ignore-duplicates` header maps to ON CONFLICT DO NOTHING
   * so client retries of POST /sessions are fully idempotent on feedback rows.
   */
  async createFeedback(input: Omit<FeedbackRow, 'id' | 'created_at'>): Promise<void> {
    await fetch(`${env.SUPABASE_URL}/rest/v1/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'resolution=ignore-duplicates',
      },
      body: JSON.stringify(input),
    });
  },

  async getSessionFeedback(sessionId: string): Promise<FeedbackRow[]> {
    const { data } = await sb<FeedbackRow[]>(
      `/feedback?session_id=eq.${sessionId}&select=*&order=created_at.asc`
    );
    return data ?? [];
  },

  // ── Subscriptions ───────────────────────────────────────────────

  async createSubscription(input: Omit<SubscriptionRow, 'id' | 'created_at'>): Promise<void> {
    await sb('/subscriptions', 'POST', input);
  },

  async getActiveSubscription(userId: string): Promise<SubscriptionRow | null> {
    const { data } = await sb<SubscriptionRow[]>(
      `/subscriptions?user_id=eq.${userId}&status=eq.active&order=created_at.desc&limit=1&select=*`
    );
    return data?.[0] ?? null;
  },

  async getSubscriptionByPaymentId(paymentId: string): Promise<SubscriptionRow | null> {
    const { data } = await sb<SubscriptionRow[]>(
      `/subscriptions?razorpay_payment_id=eq.${paymentId}&select=*`
    );
    return data?.[0] ?? null;
  },

  async updateSubscription(id: string, updates: Partial<SubscriptionRow>): Promise<void> {
    await sb(`/subscriptions?id=eq.${id}`, 'PATCH', updates);
  },

  async getExpiredActiveSubscriptions(): Promise<SubscriptionRow[]> {
    const now = new Date().toISOString();
    const { data } = await sb<SubscriptionRow[]>(
      `/subscriptions?status=eq.active&expires_at=lt.${now}&select=*`
    );
    return data ?? [];
  },

  // ── Token blacklist ─────────────────────────────────────────────

  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const { data } = await sb<TokenBlacklistRow[]>(
      `/token_blacklist?token_jti=eq.${jti}&select=token_jti`
    );
    return !!(data && data.length > 0);
  },

  async blacklistToken(input: TokenBlacklistRow): Promise<void> {
    await sb('/token_blacklist', 'POST', input);
  },

  // ── Prune expired blacklist tokens (run nightly) ──────────────
  // Without this, the table grows forever and isTokenBlacklisted()
  // gets slower with every logout/refresh.
  async cleanupExpiredBlacklistTokens(): Promise<void> {
    const now = new Date().toISOString();
    await sb(`/token_blacklist?expires_at=lt.${now}`, 'DELETE');
  },

  // ── Password resets ─────────────────────────────────────────────

  async createPasswordReset(input: Omit<PasswordResetRow, 'id' | 'used'>): Promise<void> {
    await sb('/password_resets', 'POST', { ...input, used: false });
  },

  async getPasswordReset(token: string): Promise<PasswordResetRow | null> {
    const { data } = await sb<PasswordResetRow[]>(
      `/password_resets?token=eq.${token}&used=eq.false&select=*`
    );
    return data?.[0] ?? null;
  },

  async markPasswordResetUsed(id: string): Promise<void> {
    await sb(`/password_resets?id=eq.${id}`, 'PATCH', { used: true });
  },

  async invalidatePasswordResets(userId: string): Promise<void> {
    // Mark all existing unused resets as used before issuing a new one
    // Prevents token accumulation and multiple valid reset links floating around
    await sb(`/password_resets?user_id=eq.${userId}&used=eq.false`, 'PATCH', { used: true });
  },

  // ── User mistakes (AI memory) ───────────────────────────────────

  async getUserMistakes(userId: string, topic: string): Promise<UserMistakeRow[]> {
    const { data } = await sb<UserMistakeRow[]>(
      `/user_mistakes?user_id=eq.${userId}&topic=eq.${encodeURIComponent(topic)}&order=occurrences.desc&limit=10&select=*`
    );
    return data ?? [];
  },

  /**
   * Upsert a mistake — increment occurrences if the exact same
   * (user_id, topic, mistake_type, description) already exists.
   * Uses a Postgres RPC so it's atomic.
   */
  async rpc_upsert_mistake(params: {
    p_user_id:      string;
    p_topic:        string;
    p_mistake_type: string;
    p_description:  string;
  }): Promise<void> {
    // Call the Supabase RPC function we create in migration.sql
    await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/upsert_user_mistake`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify(params),
    });
  },

  // ── Weak areas ──────────────────────────────────────────────────

  async getWeakAreas(userId: string): Promise<WeakAreaRow[]> {
    const { data } = await sb<WeakAreaRow[]>(
      `/weak_areas?user_id=eq.${userId}&order=avg_score.asc&select=*`
    );
    return data ?? [];
  },

  /**
   * Upsert weak areas per-row using ON CONFLICT DO UPDATE.
   * The previous implementation did DELETE then INSERT in two separate
   * requests — any concurrent read between them returned an empty array,
   * and a server crash between the two left the user with no weak area data.
   *
   * Requires this unique constraint:
   *   ALTER TABLE weak_areas ADD CONSTRAINT weak_areas_user_topic_unique
   *     UNIQUE (user_id, topic);
   *
   * PostgREST maps `Prefer: resolution=merge-duplicates` to
   * ON CONFLICT (user_id, topic) DO UPDATE SET ... which is atomic per-row.
   */
  async upsertWeakAreas(userId: string, entries: WeakAreaRow[]): Promise<void> {
    if (entries.length === 0) return;
    await fetch(`${env.SUPABASE_URL}/rest/v1/weak_areas?on_conflict=user_id,topic`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:         env.SUPABASE_SERVICE_KEY,
        Authorization:  `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        Prefer:         'resolution=merge-duplicates',
      },
      body: JSON.stringify(entries),
    });
  },

  // ── Score history ───────────────────────────────────────────────

  async addScoreHistory(input: Omit<ScoreHistoryRow, 'id' | 'created_at'>): Promise<void> {
    await sb('/score_history', 'POST', input);
  },

  async getScoreHistory(userId: string, limit: number): Promise<ScoreHistoryRow[]> {
    const { data } = await sb<ScoreHistoryRow[]>(
      `/score_history?user_id=eq.${userId}&order=created_at.desc&limit=${limit}&select=*`
    );
    return data ?? [];
  },

  // ── Referral events ─────────────────────────────────────────────

  async createReferralEvent(referrerId: string, referredId: string): Promise<void> {
    await sb('/referral_events', 'POST', { referrer_id: referrerId, referred_id: referredId });
  },

  /**
   * Returns a referral event for `referredId` that has NOT yet been rewarded.
   * Used in maybeRewardReferrer — returns null if user was not referred or
   * already rewarded.
   */
  async getPendingReferralEvent(referredId: string): Promise<ReferralEventRow | null> {
    const { data } = await sb<ReferralEventRow[]>(
      `/referral_events?referred_id=eq.${referredId}&rewarded_at=is.null&select=*&limit=1`
    );
    return data?.[0] ?? null;
  },

  async markReferralRewarded(eventId: string): Promise<void> {
    await sb(`/referral_events?id=eq.${eventId}`, 'PATCH', { rewarded_at: new Date().toISOString() });
  },

  async getReferralStats(referrerId: string): Promise<{ uses: number; rewarded: number; bonus_calls: number }> {
    const { data } = await sb<ReferralEventRow[]>(
      `/referral_events?referrer_id=eq.${referrerId}&select=*`
    );
    const events = data ?? [];
    const user   = await db.getUserById(referrerId);
    return {
      uses:        events.length,
      rewarded:    events.filter(e => e.rewarded_at != null).length,
      bonus_calls: (user as unknown as Record<string, number>)?.referral_bonus ?? 0,
    };
  },

  // ── Email verification tokens ───────────────────────────────────

  /**
   * Invalidate all currently-unused verification tokens for a user.
   * Called before issuing a new token so only one link is ever valid.
   */
  async invalidateEmailVerificationTokens(userId: string): Promise<void> {
    await sb(`/email_verification_tokens?user_id=eq.${userId}&used=eq.false`, 'PATCH', { used: true });
  },

  async createEmailVerificationToken(
    input: Omit<EmailVerificationTokenRow, 'id' | 'used' | 'created_at'>
  ): Promise<void> {
    const { ok, data } = await sb('/email_verification_tokens', 'POST', { ...input, used: false });
    if (!ok) throw new AppError(500, 'db_token_insert_failed', `Failed to insert verification token: ${JSON.stringify(data)}`);
  },

  async getEmailVerificationTokenByHash(tokenHash: string): Promise<EmailVerificationTokenRow | null> {
    const { data } = await sb<EmailVerificationTokenRow[]>(
      `/email_verification_tokens?token_hash=eq.${tokenHash}&select=*`
    );
    return data?.[0] ?? null;
  },

  /**
   * Atomically mark a token as used. The `used=eq.false` filter guards
   * against a race where two requests redeem the same token concurrently —
   * only the first one will affect a row.
   */
  async markEmailVerificationTokenUsed(id: string): Promise<boolean> {
    const { ok, data } = await sb<EmailVerificationTokenRow[]>(
      `/email_verification_tokens?id=eq.${id}&used=eq.false`, 'PATCH', { used: true }
    );
    return ok && !!data?.length;
  },

  // ── Email verification send log (rate limiting) ─────────────────

  async recordEmailVerificationSend(userId: string): Promise<void> {
    await sb('/email_verification_sends', 'POST', { user_id: userId });
  },

  async countRecentEmailVerificationSends(userId: string, sinceIso: string): Promise<number> {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/email_verification_sends?user_id=eq.${userId}&sent_at=gte.${sinceIso}&select=id`,
      {
        method:  'GET',
        headers: {
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Prefer':        'count=exact',
        },
      }
    );
    const range = res.headers.get('content-range'); // e.g. "0-2/5"
    const total = range?.split('/')[1];
    return total ? parseInt(total, 10) : 0;
  },

  // ── Onboarding ───────────────────────────────────────────────────

  async saveOnboarding(
    userId: string,
    profession: string,
    goal: string
  ): Promise<void> {
    await sb(`/users?id=eq.${userId}`, 'PATCH', {
      onboarding_profession:   profession,
      onboarding_goal:         goal,
      onboarding_completed_at: new Date().toISOString(),
    });
  },

  // ── Admin: users ─────────────────────────────────────────────────

  async getUserCount(): Promise<number> {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/users?select=id`, {
      method:  'HEAD',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Prefer':        'count=exact',
      },
    });
    const range = res.headers.get('content-range');
    const total = range?.split('/')[1];
    return total ? parseInt(total, 10) : 0;
  },

  async getUsersPage(
    limit: number,
    offset: number,
    search?: string
  ): Promise<{ users: UserRow[]; total: number }> {
    let path = `/users?select=id,email,name,plan,email_verified,onboarding_profession,onboarding_goal,onboarding_completed_at,referral_bonus,created_at&order=created_at.desc&limit=${limit}&offset=${offset}`;
    if (search) {
      path += `&email=ilike.*${encodeURIComponent(search)}*`;
    }

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
      method:  'GET',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Prefer':        'count=exact',
      },
    });
    const raw   = await res.text();
    const data  = (raw ? JSON.parse(raw) : []) as UserRow[];
    const range = res.headers.get('content-range');
    const total = range?.split('/')[1];

    return { users: data, total: total ? parseInt(total, 10) : data.length };
  },

  async getPlanCounts(): Promise<Record<string, number>> {
    const plans = ['free', 'pro', 'elite'];
    const counts: Record<string, number> = {};

    await Promise.all(plans.map(async (plan) => {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/users?plan=eq.${plan}&select=id`, {
        method:  'HEAD',
        headers: {
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Prefer':        'count=exact',
        },
      });
      const range = res.headers.get('content-range');
      const total = range?.split('/')[1];
      counts[plan] = total ? parseInt(total, 10) : 0;
    }));

    return counts;
  },

  async getOnboardingStats(): Promise<{ total: number; completed: number }> {
    const [total, completedRes] = await Promise.all([
      db.getUserCount(),
      fetch(`${env.SUPABASE_URL}/rest/v1/users?onboarding_completed_at=not.is.null&select=id`, {
        method:  'HEAD',
        headers: {
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Prefer':        'count=exact',
        },
      }),
    ]);
    const range = completedRes.headers.get('content-range');
    const completedTotal = range?.split('/')[1];
    return { total, completed: completedTotal ? parseInt(completedTotal, 10) : 0 };
  },

  // ── Admin: revenue & subscriptions ──────────────────────────────

  async getActiveSubscriptionCounts(): Promise<Record<string, number>> {
    const plans = ['pro', 'elite'];
    const counts: Record<string, number> = {};

    await Promise.all(plans.map(async (plan) => {
      const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/subscriptions?plan=eq.${plan}&status=eq.active&select=id`,
        {
          method:  'HEAD',
          headers: {
            'apikey':        env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            'Prefer':        'count=exact',
          },
        }
      );
      const range = res.headers.get('content-range');
      const total = range?.split('/')[1];
      counts[plan] = total ? parseInt(total, 10) : 0;
    }));

    return counts;
  },

  async getRecentSubscriptions(limit: number): Promise<SubscriptionRow[]> {
    const { data } = await sb<SubscriptionRow[]>(
      `/subscriptions?order=created_at.desc&limit=${limit}&select=*`
    );
    return data ?? [];
  },

  // ── Admin: sessions ──────────────────────────────────────────────

  async getSessionCount(): Promise<number> {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/sessions?select=id`, {
      method:  'HEAD',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Prefer':        'count=exact',
      },
    });
    const range = res.headers.get('content-range');
    const total = range?.split('/')[1];
    return total ? parseInt(total, 10) : 0;
  },

  async getSessionCountSince(sinceIso: string): Promise<number> {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/sessions?created_at=gte.${sinceIso}&select=id`,
      {
        method:  'HEAD',
        headers: {
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Prefer':        'count=exact',
        },
      }
    );
    const range = res.headers.get('content-range');
    const total = range?.split('/')[1];
    return total ? parseInt(total, 10) : 0;
  },

  async getNewUserCountSince(sinceIso: string): Promise<number> {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/users?created_at=gte.${sinceIso}&select=id`,
      {
        method:  'HEAD',
        headers: {
          'apikey':        env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Prefer':        'count=exact',
        },
      }
    );
    const range = res.headers.get('content-range');
    const total = range?.split('/')[1];
    return total ? parseInt(total, 10) : 0;
  },

  // ── B2B Leads ──────────────────────────────────────────────────

  async createLead(lead: {
    name: string;
    email: string;
    org: string;
    size: string;
    orgType?: string;
    message?: string;
  }): Promise<B2BLeadRow> {
    const { data } = await sb<B2BLeadRow[]>(`/b2b_leads`, 'POST', {
      name:     lead.name,
      email:    lead.email,
      org:      lead.org,
      size:     lead.size,
      org_type: lead.orgType || null,
      message:  lead.message || null,
    });
    const row = data?.[0];
    if (!row) throw new AppError(500, 'db_lead_creation_failed', 'Failed to create lead');
    return row;
  },

  async getLeadById(id: string): Promise<B2BLeadRow | null> {
    const { data } = await sb<B2BLeadRow[]>(`/b2b_leads?id=eq.${id}&select=*`);
    return data?.[0] ?? null;
  },

  /**
   * Paginated, optionally status-filtered list of B2B leads for the
   * admin leads table. Mirrors getUsersPage's count=exact pattern.
   */
  async getLeadsPage(
    limit: number,
    offset: number,
    status?: string
  ): Promise<{ leads: B2BLeadRow[]; total: number }> {
    let path = `/b2b_leads?select=*&order=created_at.desc&limit=${limit}&offset=${offset}`;
    if (status) {
      path += `&status=eq.${encodeURIComponent(status)}`;
    }

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
      method:  'GET',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Prefer':        'count=exact',
      },
    });
    const raw   = await res.text();
    const data  = (raw ? JSON.parse(raw) : []) as B2BLeadRow[];
    const range = res.headers.get('content-range');
    const total = range?.split('/')[1];

    return { leads: data, total: total ? parseInt(total, 10) : data.length };
  },

  /**
   * Updates a lead's status, but only if it's still in `fromStatus`.
   * Used by the 24h follow-up job so a lead the team has already
   * contacted/qualified/closed isn't silently reset back to "contacted".
   * Returns true if the row was updated.
   */
  async updateLeadStatus(id: string, toStatus: string, fromStatus?: string): Promise<boolean> {
    const filter = fromStatus
      ? `/b2b_leads?id=eq.${id}&status=eq.${fromStatus}`
      : `/b2b_leads?id=eq.${id}`;
    const { data } = await sb<B2BLeadRow[]>(filter, 'PATCH', { status: toStatus });
    return (data?.length ?? 0) > 0;
  },

  // ── Analytics events ──────────────────────────────────────────

  async createAnalyticsEvents(events: AnalyticsEventRow[]): Promise<void> {
    if (!events.length) return;
    await sb(`/analytics_events`, 'POST', events);
  },

  async createAnalyticsEvent(event: AnalyticsEventRow): Promise<void> {
    await sb(`/analytics_events`, 'POST', event);
  },

  /**
   * Funnel summary: counts of each event name in [sinceIso, now],
   * plus distinct user count per event (drop-off analysis).
   */
  async getEventCounts(sinceIso: string, eventNames?: string[]): Promise<Array<{ event: string; count: number }>> {
    const filter = eventNames?.length
      ? `&event=in.(${eventNames.map(e => encodeURIComponent(e)).join(',')})`
      : '';
    const { data } = await sb<AnalyticsEventRow[]>(
      `/analytics_events?created_at=gte.${sinceIso}&select=event${filter}`
    );
    const counts = new Map<string, number>();
    for (const row of data || []) {
      counts.set(row.event, (counts.get(row.event) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([event, count]) => ({ event, count }));
  },

  async getRecentEvents(limit = 100, eventName?: string, userId?: string): Promise<AnalyticsEventRow[]> {
    let query = `/analytics_events?select=*&order=created_at.desc&limit=${limit}`;
    if (eventName) query += `&event=eq.${encodeURIComponent(eventName)}`;
    // H3: encodeURIComponent prevents URL injection if userId ever comes
    // from an unvalidated source (e.g. a future query-param path).
    if (userId)    query += `&user_id=eq.${encodeURIComponent(userId)}`;
    const { data } = await sb<AnalyticsEventRow[]>(query);
    return data || [];
  },
};
