-- ============================================================
-- Referral bonus hard cap — Supabase migration
-- ============================================================
--
-- Audit finding (HIGH #5): referral bonus calls had no upper cap.
-- A coordinated abuse pattern (create disposable accounts, refer them all
-- to one account, have each complete one session) granted unlimited AI
-- calls to the referrer's free account.
--
-- Fix: increment_referral_bonus now takes a third argument, p_max, and
-- clamps the result with LEAST() inside the same atomic UPDATE that does
-- the increment. This must happen in SQL, not application code — a JS-side
-- "read current value, check against cap, then write" would reintroduce
-- the exact read-then-write race the original RPC was built to avoid
-- (two concurrent reward grants could each pass a pre-cap check and
-- together still exceed the limit).
--
-- Backwards-compatible: p_max defaults to a very high value so any caller
-- still invoking the old two-argument signature doesn't break, though
-- db.addBonusCalls (backend/src/core/database/client.ts) now always passes
-- p_max explicitly (env.MAX_REFERRAL_BONUS_CALLS, default 50).

CREATE OR REPLACE FUNCTION increment_referral_bonus(
  p_user_id bigint,
  p_amount  integer,
  p_max     integer DEFAULT 2147483647
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_row users%ROWTYPE;
BEGIN
  UPDATE users
  SET referral_bonus = LEAST(referral_bonus + p_amount, p_max),
      updated_at     = now()
  WHERE id = p_user_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User % not found', p_user_id;
  END IF;

  RETURN jsonb_build_object('referral_bonus', v_row.referral_bonus);
END;
$$;
