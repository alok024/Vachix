-- ============================================================
-- Interview Readiness Report — Supabase migration
-- ============================================================
--
-- Feature: "Interview Readiness Report (full)" — auto-summary every
-- 5 sessions, gated Starter+. Builds on top of the per-session
-- Interviewer's Notes (010_interviewer_notes_daily_question.sql):
-- where a single note covers one session, a readiness report rolls
-- up the last 5 sessions' notes + scores into one longer narrative —
-- "here's how you're trending," not "here's how that one session went."
--
-- Design choices:
--   • One row per checkpoint (every 5th completed session), not one
--     row per user. This gives a visible trend line over time —
--     "Report #1 said X, Report #3 says Y" — rather than overwriting
--     in place. Mirrors the append-only shape of score_history.
--   • session_count is the user's total completed-session count at
--     generation time (5, 10, 15, ...) — both a natural display label
--     and the idempotency anchor: ON CONFLICT (user_id, session_count)
--     DO NOTHING means a retried/duplicated trigger (e.g. a queue retry
--     racing the original inline call) can never produce two reports
--     for the same checkpoint.
--   • Generation itself is gated to Starter+ users at the call site
--     (sessions.service.ts checks plan before dispatching) rather than
--     in SQL, so the table has no plan-related columns — the gate is a
--     pure cost-control decision (skip the AI call for Free), not a
--     permanent data classification, and is cheaper to keep in
--     application code already maintaining PLAN_LIMITS.
--   • report_text is a single field, not structured JSON — same
--     reasoning as sessions.interviewer_notes: it's prose to render
--     in a panel, not data Claude/SQL needs to query field-by-field.
--
-- Safe to run multiple times — CREATE TABLE IF NOT EXISTS is idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS readiness_reports (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_count  integer     NOT NULL CHECK (session_count > 0 AND session_count % 5 = 0),
  report_text    text        NOT NULL,
  avg_score      numeric(4,2),         -- average score across the 5 sessions this report covers
  created_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, session_count)
);

CREATE INDEX IF NOT EXISTS idx_readiness_reports_user_latest
  ON readiness_reports (user_id, session_count DESC);

ALTER TABLE IF EXISTS readiness_reports ENABLE ROW LEVEL SECURITY;

COMMIT;
