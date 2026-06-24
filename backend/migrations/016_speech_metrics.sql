-- Migration 016: Speech Metrics (P5)
--
-- Adds the speech_metrics table to store per-session filler-word counts
-- and estimated WPM. Used to populate the "Speech Trends" dashboard card
-- (recharts line chart, labelled "Beta", visible after 3+ sessions with metrics).
--
-- Design notes:
--   One row per completed session. client_session_id is the idempotency key
--   (same UUID the frontend uses for the sessions table) so a client retry
--   of the fire-and-forget POST never writes duplicate metric rows.
--
--   wpm is stored as SMALLINT (0–32767) — no realistic typing/speaking WPM
--   exceeds a few hundred. filler_count uses INTEGER for safety.
--
--   Both columns are nullable: if the frontend's fire-and-forget POST was
--   dropped (network loss at session end), the row simply isn't there —
--   the dashboard guard (3+ rows required) handles sparse data gracefully.
--
--   RLS: deny-by-default (matches 008_rls_default_deny.sql pattern).
--   Row-level security keeps one user from reading another's metrics via
--   a direct Supabase client call.

CREATE TABLE IF NOT EXISTS speech_metrics (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id        UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  client_session_id UUID        NOT NULL,
  filler_count      INTEGER     NOT NULL DEFAULT 0,
  wpm               SMALLINT    NOT NULL DEFAULT 0,
  answer_count      SMALLINT    NOT NULL DEFAULT 0,   -- how many answers were analysed
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Idempotency: one row per client session, regardless of retries
  UNIQUE (client_session_id)
);

-- Look up a user's trend data (dashboard card) — user_id + created_at DESC
CREATE INDEX IF NOT EXISTS speech_metrics_user_created_idx
  ON speech_metrics (user_id, created_at DESC);

-- Join from sessions by server-side session id
CREATE INDEX IF NOT EXISTS speech_metrics_session_id_idx
  ON speech_metrics (session_id);

-- RLS: deny-by-default
ALTER TABLE speech_metrics ENABLE ROW LEVEL SECURITY;

-- Service role (backend) can do anything; no user-facing policies needed
-- because all reads/writes go through the Express API with JWT auth,
-- never via a direct Supabase client from the browser.
