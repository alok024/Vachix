-- ============================================================
-- Referral / Growth loop — Supabase migration (v1)
-- ============================================================
--
-- Backs `backend/src/modules/growth/referral.service.ts`, which already
-- reads/writes `users.referral_code`, `users.referred_by`,
-- `users.referral_bonus`, the `referral_events` table, and calls the
-- `increment_referral_bonus` RPC — none of which existed in any prior
-- migration. Without this, GET /api/referral 500s (getOrCreateReferralCode
-- throws on the missing column) and attribution/reward calls silently
-- no-op forever.

-- 1. Referral fields on users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_code  text,
  ADD COLUMN IF NOT EXISTS referred_by    text,
  ADD COLUMN IF NOT EXISTS referral_bonus integer NOT NULL DEFAULT 0;

-- Each user's shareable code must be unique (db.setReferralCode relies on
-- a unique-violation to detect collisions and retry with a new candidate).
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_referral_code_unique;
ALTER TABLE users
  ADD CONSTRAINT users_referral_code_unique UNIQUE (referral_code);

-- Fast lookup for db.getUserByReferralCode (?ref=CODE on signup)
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);

-- 2. Referral events — one row per (referrer, referred) pair.
-- rewarded_at is null until the referred user's first session completes
-- (db.getPendingReferralEvent / db.markReferralRewarded).
CREATE TABLE IF NOT EXISTS referral_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rewarded_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_events_referrer_id ON referral_events(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referral_events_referred_id ON referral_events(referred_id);

-- A referred user can only ever be the "referred" party once.
ALTER TABLE referral_events
  DROP CONSTRAINT IF EXISTS referral_events_referred_id_unique;
ALTER TABLE referral_events
  ADD CONSTRAINT referral_events_referred_id_unique UNIQUE (referred_id);

-- 3. Atomic bonus-call increment (avoids read-then-write races when two
-- referral rewards land for the same referrer around the same time).
-- Called as: POST /rest/v1/rpc/increment_referral_bonus
--   body: { p_user_id: <referrer uuid>, p_amount: <REFERRAL_BONUS_CALLS> }
CREATE OR REPLACE FUNCTION increment_referral_bonus(
  p_user_id bigint,
  p_amount  integer
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_row users%ROWTYPE;
BEGIN
  UPDATE users
  SET referral_bonus = referral_bonus + p_amount,
      updated_at     = now()
  WHERE id = p_user_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User % not found', p_user_id;
  END IF;

  RETURN jsonb_build_object('referral_bonus', v_row.referral_bonus);
END;
$$;
