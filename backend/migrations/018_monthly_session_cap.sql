-- ============================================================
-- Migration 018: Monthly Session Cap for Free Tier (P1-A)
-- ============================================================
--
-- Adds two columns to the `usage` table:
--
--   monthly_session_count    — number of sessions completed this calendar
--                              month (IST). Incremented atomically by the
--                              increment_session_count RPC. Resets to 0
--                              at the start of each IST month alongside
--                              call_count via the existing resetUsage() path.
--
--   monthly_session_reset_at — TIMESTAMPTZ of the last reset. The backend
--                              reads this to detect whether the current
--                              month's period has elapsed and auto-resets
--                              before enforcing the cap.
--
-- Why a separate column (not reuse call_count)?
--   call_count is the AI-calls-per-month cap enforced per request in
--   middleware (checkUsageLimit). The session cap is a coarser gate:
--   one session = multiple AI calls, and we want to allow free users
--   exactly N *sessions* per month (not just N AI calls). Keeping them
--   separate lets us tune each limit independently.
--
-- Why on the usage table (not users)?
--   usage already carries the monthly call_count and period_start. It is
--   the canonical monthly-reset table. Piggybacking here avoids a new table
--   and keeps all per-month accounting in one place.
--
-- RPC: increment_session_count(p_user_id, p_cap)
--
--   Atomically checks AND increments in a single PL/pgSQL function.
--   The check-then-increment is inside one SQL statement so concurrent
--   calls from the same user cannot both pass the cap guard and both
--   write — only the first one to acquire the row lock increments;
--   subsequent concurrent calls see the already-incremented value and
--   return blocked = true.
--
--   Returns: TABLE(new_count integer, blocked boolean)
--     blocked = true  → caller should 429 without saving the session
--     blocked = false → increment succeeded, proceed with session save
--
-- ============================================================

-- 1. Add columns to usage table
ALTER TABLE usage
  ADD COLUMN IF NOT EXISTS monthly_session_count    INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_session_reset_at TIMESTAMPTZ;

-- Backfill reset timestamp for existing rows so the first reset check
-- doesn't incorrectly reset a row that was already in the current period.
-- We use the existing period_start if available, otherwise now().
UPDATE usage
SET monthly_session_reset_at = COALESCE(period_start, now())
WHERE monthly_session_reset_at IS NULL;

-- 2. RPC: increment_session_count(p_user_id, p_cap)
--
--    Atomically checks the cap and conditionally increments in one statement.
--    Uses PL/pgSQL so we can return a composite result (new_count + blocked).
--
--    Concurrency safety:
--      The UPDATE is a single atomic SQL command. Under concurrent execution
--      Postgres serialises row-level locks on the usage row, so two requests
--      racing at count = cap-1 cannot both see count < cap and both increment.
--      Only the first acquires the lock and increments; the second sees the
--      new value (= cap) and gets blocked = true.
--
--    Usage from Node.js (via Supabase RPC):
--      const result = await sb('/rpc/increment_session_count', 'POST',
--        { p_user_id: userId, p_cap: SESSION_CAP_FREE });
--      if (result.data?.[0]?.blocked) throw new AppError(429, ...);
--
CREATE OR REPLACE FUNCTION increment_session_count(p_user_id bigint, p_cap integer)
RETURNS TABLE (new_count integer, blocked boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Upsert the usage row (handles first-ever session for the user).
  -- ON CONFLICT ensures we only touch one row and hold a row-level lock
  -- for the duration of this statement, preventing the TOCTOU race.
  -- period_start is included because the column may carry a NOT NULL constraint
  -- from the base usage table; omitting it on a brand-new user's first session
  -- would throw, leave the row uninserted, and cause the subsequent UPDATE to
  -- find no row — returning v_count = NULL so blocked = NULL (falsy), silently
  -- bypassing the cap check.
  INSERT INTO usage (user_id, call_count, monthly_session_count, monthly_session_reset_at, period_start, updated_at)
  VALUES (p_user_id, 0, 0, now(), date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata', now())
  ON CONFLICT (user_id) DO NOTHING;

  -- Now update conditionally — single atomic statement, row-locked.
  UPDATE usage
  SET
    monthly_session_count = CASE
      WHEN monthly_session_count < p_cap THEN monthly_session_count + 1
      ELSE monthly_session_count          -- cap hit: leave as-is, return blocked
    END,
    updated_at = now()
  WHERE user_id = p_user_id
  RETURNING monthly_session_count INTO v_count;

  RETURN QUERY SELECT v_count, (v_count >= p_cap);
END;
$$;
