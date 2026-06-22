-- ============================================================
-- Email Verification — Supabase migration (v2, production-ready)
-- ============================================================

-- 1. Add email_verified flag to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2. Verification tokens table
-- ============================================================
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  used        boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- FIX 1 ✅ — Unique constraint on token_hash (collision safety)
-- Prevents two tokens from ever sharing the same hash, even under
-- race conditions or hash-space exhaustion edge cases.
CREATE UNIQUE INDEX IF NOT EXISTS idx_evt_token_hash_unique
  ON email_verification_tokens(token_hash);

-- FIX 6 ✅ — Explicit FK index (Postgres does NOT auto-create these)
-- Needed for CASCADE deletes and per-user token lookups.
CREATE INDEX IF NOT EXISTS idx_evt_user_id
  ON email_verification_tokens(user_id);

-- FIX 5 ✅ — Index on expires_at to speed up cleanup queries
CREATE INDEX IF NOT EXISTS idx_evt_expires_at
  ON email_verification_tokens(expires_at);

-- ============================================================
-- 3. Rate-limiting table for resend-verification (3 / hour / user)
-- ============================================================
CREATE TABLE IF NOT EXISTS email_verification_sends (
  id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evs_user_sent
  ON email_verification_sends(user_id, sent_at);

-- ============================================================
-- 4. RLS — service role bypasses RLS; lock down anon/authed access
-- ============================================================
ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verification_sends  ENABLE ROW LEVEL SECURITY;
-- No policies → only service_role (backend) can read/write.

-- ============================================================
-- FIX 2 ✅ — Automatic cleanup of expired / used tokens
-- A pg_cron job (or equivalent Supabase cron) should call this
-- function every few hours to prevent unbounded table growth.
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_email_verification_tokens()
RETURNS void
LANGUAGE sql
SECURITY DEFINER   -- runs as owner, not caller
AS $$
  DELETE FROM email_verification_tokens
  WHERE used = true
     OR expires_at < now();
$$;

-- FIX L1: Schedule the cleanup function via pg_cron if it is available.
-- The previous migration left this commented out, meaning the
-- email_verification_tokens table would grow unboundedly — every
-- register attempt (successful or not) inserts a token row, and
-- without periodic cleanup the table bloats indefinitely.
--
-- We use a DO block with an exception handler so the migration
-- does not fail on Supabase projects that do not have the pg_cron
-- extension enabled. If pg_cron is absent the cron.schedule() call
-- raises an "undefined_function" exception (SQLSTATE 42883), which
-- we catch and silently ignore — the cleanup function still exists
-- and can be called manually or wired up later via the dashboard.
--
-- To enable pg_cron: Supabase Dashboard → Database → Extensions → pg_cron.
DO $$
BEGIN
  -- Upsert the job: if a job with this name already exists (from a
  -- previous migration run) cron.schedule() replaces its schedule
  -- and command, making this block idempotent.
  PERFORM cron.schedule(
    'cleanup-email-verification-tokens',  -- job name (unique key)
    '0 */4 * * *',                        -- every 4 hours
    'SELECT cleanup_email_verification_tokens()'
  );
EXCEPTION
  WHEN undefined_function THEN
    -- pg_cron is not installed — skip silently.
    -- Enable it in the Supabase Dashboard under Database → Extensions.
    RAISE NOTICE 'pg_cron not available — email verification token cleanup will not run automatically.';
  WHEN OTHERS THEN
    -- Any other error scheduling the job is non-fatal for the migration
    -- but should be investigated.
    RAISE WARNING 'Could not schedule cleanup-email-verification-tokens: %', SQLERRM;
END;
$$;

-- ============================================================
-- FIX 3 ✅ — One active token per user (invalidation helper)
-- Call this from your backend BEFORE inserting a new token so
-- that old verification links are immediately invalidated.
--
-- Usage (from Node/Python/etc.):
--   CALL invalidate_previous_tokens($1)   -- $1 = user_id
-- ============================================================
CREATE OR REPLACE PROCEDURE invalidate_previous_tokens(p_user_id bigint)
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE email_verification_tokens
  SET    used = true
  WHERE  user_id = p_user_id
    AND  used    = false;
$$;

-- ============================================================
-- FIX 4 ✅ — Rate-limit check helper
-- Returns TRUE when the user has hit the 3-sends-per-hour cap.
-- Call this from your backend before sending a verification email.
--
-- Usage:
--   SELECT check_resend_rate_limit($1)   -- $1 = user_id
--   → true  → block; respond 429
--   → false → allow; insert row + send email
-- ============================================================
CREATE OR REPLACE FUNCTION check_resend_rate_limit(p_user_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COUNT(*) >= 3
  FROM   email_verification_sends
  WHERE  user_id = p_user_id
    AND  sent_at > now() - interval '1 hour';
$$;

-- ============================================================
-- Summary of what each fix addresses
-- ============================================================
-- idx_evt_token_hash_unique  → FIX 1  duplicate / collision safety
-- cleanup_email_verification_tokens() → FIX 2  table growth
-- invalidate_previous_tokens()        → FIX 3  one active token/user
-- check_resend_rate_limit()           → FIX 4  enforce 3/hr cap
-- idx_evt_expires_at                  → FIX 5  fast cleanup queries
-- idx_evt_user_id                     → FIX 6  FK + lookup perf
-- ============================================================
