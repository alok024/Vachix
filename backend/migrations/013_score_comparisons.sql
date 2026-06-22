-- ============================================================
-- Friend Score Comparison — Supabase migration
-- ============================================================
--
-- Feature: Async shareable link comparing two users' scores on the
-- same interview question. No live pairing required — the sharer
-- answers first and gets a link; anyone who opens it sees the
-- sharer's score and can submit their own answer to compare.
--
-- Design choices:
--   • One `score_comparisons` row per challenge, identified by a
--     public share token (HMAC-signed, same pattern as report
--     share tokens). The row stores the sharer's session + question
--     snapshot; challenger answers are separate rows in
--     `comparison_responses`.
--   • challenger_answers is stored as JSONB rather than a relational
--     FK to the feedback table — challengers are not required to
--     have a Vachix account (they get a temporary AI-scored result),
--     so there is no session row to FK to. Future iteration could add
--     an optional user_id FK when the challenger is authenticated.
--   • expires_at: 7-day TTL — links expire so old comparisons don't
--     create indefinite storage accumulation or confusion when a
--     sharer's scores change significantly.
--   • No RLS on comparison_responses intentionally: the comparison
--     page is public/unauthenticated (read-only via service key).
--     Row-level write protection is enforced at the application layer
--     (the controller checks the comparison exists and isn't expired
--     before inserting a response row).
--
-- Safe to run multiple times — CREATE TABLE IF NOT EXISTS is idempotent.

BEGIN;

-- ── Guard: ensure sessions.id has a PRIMARY KEY ──────────────────────────────
-- The score_comparisons table FKs to sessions(id). Postgres requires the
-- referenced column to have a UNIQUE or PRIMARY KEY constraint — without it
-- the CREATE TABLE below fails with:
--   ERROR 42830: there is no unique constraint matching given keys for
--   referenced table "sessions"
--
-- This block is safe to run even when the PK already exists (the DO NOTHING
-- branch is taken). It only fires the ALTER TABLE when the PK is genuinely
-- missing — e.g. after a column-type migration that accidentally dropped it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint c
    JOIN   pg_class      t ON t.oid = c.conrelid
    WHERE  t.relname  = 'sessions'
      AND  c.contype  = 'p'  -- 'p' = PRIMARY KEY
  ) THEN
    ALTER TABLE sessions ADD PRIMARY KEY (id);
    RAISE NOTICE 'sessions: PRIMARY KEY on id was missing — added.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS score_comparisons (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The sharer's completed session this comparison is based on
  session_id      int8        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id         bigint      NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  -- The specific question being challenged (index into feedback rows)
  question_index  integer     NOT NULL CHECK (question_index >= 0),
  -- Snapshot of the question text and the sharer's answer, so the
  -- comparison page renders even if the feedback row changes.
  question_text   text        NOT NULL,
  sharer_answer   text        NOT NULL DEFAULT '',
  sharer_score    numeric(4,2) NOT NULL CHECK (sharer_score >= 0 AND sharer_score <= 10),
  -- Token is the publicly visible identifier (HMAC-signed in app code)
  -- stored here for fast lookup by token — avoids decoding on every hit.
  share_token     text        NOT NULL UNIQUE,
  expires_at      timestamptz NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_score_comparisons_user_id
  ON score_comparisons (user_id);
CREATE INDEX IF NOT EXISTS idx_score_comparisons_share_token
  ON score_comparisons (share_token);
CREATE INDEX IF NOT EXISTS idx_score_comparisons_expires_at
  ON score_comparisons (expires_at);

-- One challenger response per comparison. Challengers can be
-- anonymous (no Vachix account) — challenger_name is optional display name.
CREATE TABLE IF NOT EXISTS comparison_responses (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  comparison_id   uuid        NOT NULL REFERENCES score_comparisons(id) ON DELETE CASCADE,
  challenger_name text,                                -- optional display name
  challenger_answer text      NOT NULL,
  challenger_score  numeric(4,2) NOT NULL CHECK (challenger_score >= 0 AND challenger_score <= 10),
  ai_feedback     text,                               -- brief AI tip for the challenger
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comparison_responses_comparison_id
  ON comparison_responses (comparison_id);

ALTER TABLE IF EXISTS score_comparisons   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS comparison_responses ENABLE ROW LEVEL SECURITY;

COMMIT;
