-- ============================================================
-- Streak calendar-day fix — use IST, not server UTC (audit #17)
-- ============================================================
--
-- Audit finding (LOW #17): increment_user_stats() computed v_today and
-- v_last via now()::date / last_session::date, which takes the date in
-- the database server's UTC timezone. Vachix is an India-focused product,
-- so a user practicing late at night IST could have their session land on
-- the "wrong" UTC calendar day relative to their previous session:
--
--   Session 1: 11:30 PM IST on June 18  → 6:00 PM UTC June 18  (v_today = Jun 18)
--   Session 2: 12:30 AM IST on June 19  → 7:00 PM UTC June 18  (v_today = Jun 18)
--
-- That example still works by accident, but the reverse direction breaks:
-- a session at 12:30 AM IST is only 30 minutes after the user's "yesterday"
-- by their own clock, yet if their *previous* session was earlier the same
-- IST evening, the UTC date can disagree with the IST date by a full day
-- depending on time of day, intermittently resetting streaks that should
-- have counted as consecutive days from the user's point of view.
--
-- Fix: convert to Asia/Kolkata (UTC+5:30, fixed offset — India does not
-- observe DST) before taking ::date, for both "today" and the stored
-- last_session timestamp, so both sides of the comparison use the same
-- calendar. This is a behavior-only change inside the function body —
-- no schema/table changes, so it's safe to run standalone.
--
-- NOTE: this hardcodes IST for all users rather than adding a per-user
-- timezone column, which is out of scope for this fix. If Vachix expands
-- outside India, replace 'Asia/Kolkata' with a stored user timezone
-- (defaulting to 'Asia/Kolkata' for existing users).
--
-- Safe to run multiple times — CREATE OR REPLACE FUNCTION is idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION increment_user_stats(
  p_user_id     bigint,
  p_score       numeric,
  p_job_ready   numeric,
  p_total_score numeric
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_today     date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
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

  -- last_session is stored as a UTC timestamptz; convert to IST before
  -- taking the date, same as v_today above, so both sides compare in
  -- the user's calendar, not the server's.
  v_last   := (v_row.last_session AT TIME ZONE 'Asia/Kolkata')::date;
  v_streak := CASE
    WHEN v_last = v_today     THEN v_row.streak          -- same IST day, keep
    WHEN v_last = v_yesterday THEN v_row.streak + 1      -- consecutive IST day
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

COMMIT;
