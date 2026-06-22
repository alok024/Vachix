-- ============================================================
-- Voice / Avatar Usage Ledger — Supabase migration
-- ============================================================
--
-- Tracks voice (TTS) and avatar minutes consumed per user per
-- billing cycle, enabling:
--   1. Per-plan monthly caps enforced by gate-checking middleware
--      before any voice/avatar upstream call goes out.
--   2. Streak-milestone top-ups (day 7 / 14 / 21 / etc.) that
--      add bonus voice minutes to the ledger — same "bonus pool"
--      shape as referral_bonus in the users table.
--
-- Design choices:
--   • One row per (user_id, billing_month). billing_month is the
--     first calendar day of the IST month so comparisons always
--     land in the same timezone as streak tracking (009 migration).
--   • voice_seconds_used / avatar_seconds_used stored as integers
--     (whole seconds) — TTS calls are typically < 30 s each, so
--     sub-second precision offers no practical benefit and complicates
--     atomicity.
--   • bonus_voice_seconds accumulates streak rewards and never resets
--     with the monthly counter — it carries forward. This mirrors
--     referral_bonus on users.
--   • All arithmetic is done inside Postgres RPCs (see below) to
--     avoid the read-then-write race condition, same approach as
--     increment_referral_bonus (007_referral_bonus_cap.sql).
--
-- Safe to run multiple times — CREATE TABLE IF NOT EXISTS +
-- CREATE OR REPLACE FUNCTION are idempotent.

BEGIN;

-- ── Table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS voice_usage_ledger (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  billing_month         date        NOT NULL,   -- first day of IST month, e.g. '2026-06-01'
  voice_seconds_used    integer     NOT NULL DEFAULT 0 CHECK (voice_seconds_used    >= 0),
  avatar_seconds_used   integer     NOT NULL DEFAULT 0 CHECK (avatar_seconds_used   >= 0),
  -- Streak-milestone bonus pool — never resets, carries into the next month.
  -- Consumed first before counting against the plan cap.
  bonus_voice_seconds   integer     NOT NULL DEFAULT 0 CHECK (bonus_voice_seconds   >= 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, billing_month)
);

-- Default-deny RLS (matches 008_rls_default_deny.sql pattern):
-- only the service-role key (used by database/client.ts) can read or write.
ALTER TABLE IF EXISTS voice_usage_ledger ENABLE ROW LEVEL SECURITY;

-- Fast lookup by user + month (the primary access pattern)
CREATE INDEX IF NOT EXISTS voice_usage_ledger_user_month
  ON voice_usage_ledger (user_id, billing_month);

-- ── Helper: current IST billing month ────────────────────────
--
-- Reused by both RPCs below. Returns the first calendar day of the
-- current month in Asia/Kolkata — the natural boundary for monthly
-- subscription caps.
CREATE OR REPLACE FUNCTION voice_current_ist_month() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::date;
$$;

-- ── RPC 1: increment_voice_usage ─────────────────────────────
--
-- Called by gate-checking middleware after a successful TTS or avatar
-- call to debit seconds from the ledger. Inserts the row for this
-- billing month if it doesn't exist yet (upsert on conflict).
--
-- Parameters:
--   p_user_id        — the user
--   p_voice_seconds  — TTS seconds to debit (0 if avatar-only call)
--   p_avatar_seconds — Avatar seconds to debit (0 if TTS-only call)
--
-- Returns the updated row as JSONB so the caller can return remaining
-- quota to the frontend in the same response without an extra round-trip.
CREATE OR REPLACE FUNCTION increment_voice_usage(
  p_user_id        bigint,
  p_voice_seconds  integer DEFAULT 0,
  p_avatar_seconds integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_month date := voice_current_ist_month();
  v_row   voice_usage_ledger%ROWTYPE;
BEGIN
  -- Upsert: create the month's row if missing, then lock and update.
  INSERT INTO voice_usage_ledger (user_id, billing_month)
  VALUES (p_user_id, v_month)
  ON CONFLICT (user_id, billing_month) DO NOTHING;

  UPDATE voice_usage_ledger
  SET
    voice_seconds_used  = voice_seconds_used  + p_voice_seconds,
    avatar_seconds_used = avatar_seconds_used + p_avatar_seconds,
    updated_at          = now()
  WHERE user_id      = p_user_id
    AND billing_month = v_month
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'voice_seconds_used',  v_row.voice_seconds_used,
    'avatar_seconds_used', v_row.avatar_seconds_used,
    'bonus_voice_seconds', v_row.bonus_voice_seconds,
    'billing_month',       v_row.billing_month
  );
END;
$$;

-- ── RPC 2: top_up_bonus_voice_seconds ────────────────────────
--
-- Called by streak-milestone reward logic after day 7 / 14 / 21 / etc.
-- Adds bonus seconds to the current month's row (creating it first if
-- needed). A hard ceiling (p_max_bonus) prevents abuse via fabricated
-- milestone triggers — same LEAST() pattern as increment_referral_bonus
-- (007_referral_bonus_cap.sql).
--
-- Parameters:
--   p_user_id    — the user
--   p_seconds    — bonus seconds to credit
--   p_max_bonus  — hard ceiling on total bonus_voice_seconds
--                  (env.MAX_BONUS_VOICE_SECONDS, default 3600 = 60 min)
CREATE OR REPLACE FUNCTION top_up_bonus_voice_seconds(
  p_user_id   bigint,
  p_seconds   integer,
  p_max_bonus integer DEFAULT 3600
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_month date := voice_current_ist_month();
  v_row   voice_usage_ledger%ROWTYPE;
BEGIN
  INSERT INTO voice_usage_ledger (user_id, billing_month, bonus_voice_seconds)
  VALUES (p_user_id, v_month, LEAST(p_seconds, p_max_bonus))
  ON CONFLICT (user_id, billing_month) DO UPDATE
    SET bonus_voice_seconds = LEAST(
          voice_usage_ledger.bonus_voice_seconds + p_seconds,
          p_max_bonus
        ),
        updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'bonus_voice_seconds', v_row.bonus_voice_seconds,
    'billing_month',       v_row.billing_month
  );
END;
$$;

COMMIT;
