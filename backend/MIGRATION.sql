-- ============================================================
-- Vachix — v2 Bug-fix migrations
-- Apply in a single transaction.
-- ============================================================

BEGIN;

-- 1. Feedback idempotency
-- Stable position column + unique constraint so (session_id, question_index)
-- is the deduplication key.  ON CONFLICT DO NOTHING via Prefer header.

ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS question_index integer NOT NULL DEFAULT 0;

ALTER TABLE feedback
  DROP CONSTRAINT IF EXISTS feedback_session_question_unique;
ALTER TABLE feedback
  ADD CONSTRAINT feedback_session_question_unique
    UNIQUE (session_id, question_index);

-- 2. Session idempotency + state machine
-- client_session_id: stable UUID from the frontend, used as idempotency key.
-- status: DB-enforced state column with a CHECK constraint.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS client_session_id uuid;

ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS sessions_client_session_id_unique;
ALTER TABLE sessions
  ADD CONSTRAINT sessions_client_session_id_unique
    UNIQUE (client_session_id);

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed';

ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS sessions_status_check;
ALTER TABLE sessions
  ADD CONSTRAINT sessions_status_check
    CHECK (status IN ('scoring', 'completed', 'abandoned'));

-- 3. Fully atomic stats increment (arithmetic in SQL)
-- Eliminates the JS read → compute → write race entirely.
-- Receives only per-session deltas; Postgres applies them under a row lock.

CREATE OR REPLACE FUNCTION increment_user_stats(
  p_user_id     bigint,
  p_score       numeric,
  p_job_ready   numeric,
  p_total_score numeric
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_today     date := now()::date;
  v_yesterday date := v_today - 1;
  v_last      date;
  v_streak    int;
  v_row       stats%ROWTYPE;
BEGIN
  -- Ensure the row exists before locking
  INSERT INTO stats (user_id, sessions, best_score, total_score,
                     avg_job_ready_score, total_sessions_with_score,
                     streak, last_session, updated_at)
  VALUES (p_user_id, 0, 0, 0, 0, 0, 0, null, now())
  ON CONFLICT (user_id) DO NOTHING;

  -- Lock the row for the duration of this transaction
  SELECT * INTO v_row FROM stats WHERE user_id = p_user_id FOR UPDATE;

  v_last   := v_row.last_session::date;
  v_streak := CASE
    WHEN v_last = v_today     THEN v_row.streak          -- same day, keep
    WHEN v_last = v_yesterday THEN v_row.streak + 1      -- consecutive day
    ELSE 1                                               -- gap, reset
  END;

  UPDATE stats SET
    sessions                  = v_row.sessions + 1,
    best_score                = GREATEST(v_row.best_score, p_score),
    total_score               = v_row.total_score + p_total_score,
    avg_job_ready_score       = ROUND(
                                  ((v_row.avg_job_ready_score * v_row.total_sessions_with_score)
                                    + p_job_ready)
                                  / (v_row.total_sessions_with_score + 1),
                                  2),
    total_sessions_with_score = v_row.total_sessions_with_score + 1,
    streak                    = v_streak,
    last_session              = now(),
    updated_at                = now()
  WHERE user_id = p_user_id;

  SELECT * INTO v_row FROM stats WHERE user_id = p_user_id;
  RETURN jsonb_build_object(
    'sessions',            v_row.sessions,
    'best_score',          v_row.best_score,
    'streak',              v_row.streak,
    'avg_job_ready_score', v_row.avg_job_ready_score
  );
END;
$$;

-- 4. Drop old upsert RPC (no longer called by app code)
DROP FUNCTION IF EXISTS upsert_user_stats(uuid,int,int,numeric,numeric,timestamptz,numeric,int);

COMMIT;

-- 5. Weak areas unique constraint (enables merge-duplicates upsert)
ALTER TABLE weak_areas
  DROP CONSTRAINT IF EXISTS weak_areas_user_topic_unique;
ALTER TABLE weak_areas
  ADD CONSTRAINT weak_areas_user_topic_unique
    UNIQUE (user_id, topic);

-- 6. Subscriptions unique constraint on razorpay_order_id (idempotent upsert)
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_razorpay_order_id_unique;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_razorpay_order_id_unique
    UNIQUE (razorpay_order_id);

-- 7. Password reset tokens — already hashed (app change only, no schema change needed)
-- The token column now stores SHA-256(raw_token) instead of the raw token.
-- Existing rows are stale (raw tokens in email links are now invalid).
-- Run this to invalidate them:
UPDATE password_resets SET used = true WHERE used = false;

-- ============================================================
-- CRITICAL FIX A: usage table UNIQUE constraint + increment_usage RPC
-- ============================================================
-- Without UNIQUE (user_id) on the usage table, the ON CONFLICT clause
-- in the RPC is silently ignored — Postgres has nothing to conflict on.
-- This means every AI call inserts a brand-new row instead of updating
-- the existing one, call_count never increments past 1, and free users
-- get unlimited sessions forever.
--
-- The RPC itself was only documented in a code comment in client.ts
-- and never created in any migration, so every call to /rpc/increment_usage
-- 404-faults on the Supabase REST layer. db.incrementUsage() swallows
-- the error as non-fatal (user.service.ts:incrementAIUsage), so the
-- failure was invisible in logs — the AI response still succeeded, but
-- usage was never counted.

-- Step 1: Ensure only one usage row per user exists before adding the
-- constraint. If duplicate rows already exist, keep the one with the
-- highest call_count so we don't lose counted calls.
DELETE FROM usage
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id) id
  FROM usage
  ORDER BY user_id, call_count DESC, updated_at DESC
);

-- Step 2: Add the UNIQUE constraint so ON CONFLICT (user_id) works.
ALTER TABLE usage
  DROP CONSTRAINT IF EXISTS usage_user_id_unique;
ALTER TABLE usage
  ADD CONSTRAINT usage_user_id_unique UNIQUE (user_id);

-- Step 3: Create the RPC that db.incrementUsage() calls.
-- Atomic INSERT … ON CONFLICT eliminates the read-then-write race where
-- two concurrent AI requests both see the same call_count and each write
-- call_count + 1, effectively losing one count.
CREATE OR REPLACE FUNCTION increment_usage(p_user_id bigint)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO usage (user_id, call_count, updated_at)
  VALUES (p_user_id, 1, now())
  ON CONFLICT (user_id)
  DO UPDATE SET
    call_count = usage.call_count + 1,
    updated_at = now();
$$;

-- ============================================================
-- CRITICAL FIX B: Backfill email_verified for pre-existing users
-- ============================================================
-- Migration 001_email_verification.sql added the column with DEFAULT false.
-- That means every account that existed before the migration was applied
-- now has email_verified = false. auth.service.ts loginUser() hard-blocks
-- login with a 403 email_not_verified error, so ALL pre-existing users
-- are permanently locked out with no error message explaining why.
--
-- Fix: mark every account that was created before this migration as
-- already verified. New accounts go through the email flow correctly
-- (DEFAULT false + verification email sent on register).
--
-- Safe to re-run: WHERE email_verified = false only touches unverified rows;
-- newly registered unverified users will have a pending token in
-- email_verification_tokens and should NOT be backfilled — exclude them.

UPDATE users
SET    email_verified = true,
       updated_at     = now()
WHERE  email_verified = false
  AND  id NOT IN (
         -- Keep unverified if they have a PENDING (unused, unexpired) token.
         -- These are genuinely new accounts mid-verification-flow.
         SELECT DISTINCT user_id
         FROM   email_verification_tokens
         WHERE  used       = false
           AND  expires_at > now()
       );
