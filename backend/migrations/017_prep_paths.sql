-- Migration 017: Guided Prep Paths (P6-A)
--
-- Adds:
--   prep_paths             — catalog of structured multi-day prep programs
--                             (e.g. "Bank PO 7-day", "UPSC 14-day"). Each row
--                             carries its full day-by-day plan as JSONB so the
--                             frontend can render/Continue without a join.
--   user_prep_enrollments  — one row per user enrollment in a prep path.
--                             current_day is derived at read-time from
--                             enrolled_at (IST calendar days elapsed), not
--                             stored, so a user who skips a day doesn't get
--                             silently advanced or stuck — see
--                             prep-paths.service.ts.
--
-- Design notes:
--   `days` JSONB shape (array, 1-indexed by day_number):
--     [{
--       "day_number": 1,
--       "title": "Quant Fundamentals",
--       "session_config": {
--         "profession": "Bank PO",
--         "mode": "chat",
--         "difficulty": "beginner",
--         "interview_type": "Technical"
--       }
--     }, ...]
--   session_config maps directly onto the ?profession=&mode=&difficulty=
--   &interview_type= query params already read by
--   app/(app)/interview/setup/page.tsx — so "Continue" just needs to build
--   a URL from the current day's session_config, no new param-parsing logic
--   on the frontend.
--
--   A user may enroll in a path more than once over time (e.g. retake UPSC
--   14-day after finishing it), so user_id is NOT unique on its own. Instead,
--   getActiveEnrollment() (db client) filters to completed_at IS NULL and
--   takes the most recent — enforced in application code rather than a DB
--   constraint because PostgREST/Supabase partial unique indexes would need
--   a raw SQL function this client doesn't use elsewhere (see client.ts's
--   comment on why this client stays REST-only, not raw SQL).

-- prep_paths table
CREATE TABLE IF NOT EXISTS prep_paths (
  id            TEXT PRIMARY KEY,        -- slug, e.g. 'bank-po-7day'
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  profession    TEXT NOT NULL,           -- broad category, e.g. 'Bank PO'
  days          JSONB NOT NULL,          -- day-by-day plan, see header comment
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user_prep_enrollments table
CREATE TABLE IF NOT EXISTS user_prep_enrollments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prep_path_id  TEXT NOT NULL REFERENCES prep_paths(id) ON DELETE CASCADE,
  enrolled_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_prep_enrollments_user_id_idx
  ON user_prep_enrollments (user_id);

-- Speeds up getActiveEnrollment's "latest open enrollment for this user" query.
CREATE INDEX IF NOT EXISTS user_prep_enrollments_user_active_idx
  ON user_prep_enrollments (user_id, enrolled_at DESC)
  WHERE completed_at IS NULL;

-- RLS: deny-by-default (matches 008_rls_default_deny.sql pattern — only the
-- service_role key this app's db client uses can read/write these tables).
ALTER TABLE prep_paths ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_prep_enrollments ENABLE ROW LEVEL SECURITY;

-- Seed data: Bank PO 7-day path
INSERT INTO prep_paths (id, title, description, duration_days, profession, days)
VALUES (
  'bank-po-7day',
  'Bank PO 7-Day Prep',
  'A focused one-week sprint covering quant, reasoning, English, and banking-awareness interview rounds for Bank PO aspirants.',
  7,
  'Bank PO',
  '[
    {"day_number": 1, "title": "Quant Fundamentals",        "session_config": {"profession": "Bank PO", "mode": "chat",    "difficulty": "beginner",     "interview_type": "Technical"}},
    {"day_number": 2, "title": "Reasoning Ability",          "session_config": {"profession": "Bank PO", "mode": "chat",    "difficulty": "beginner",     "interview_type": "Technical"}},
    {"day_number": 3, "title": "English Comprehension",      "session_config": {"profession": "Bank PO", "mode": "chat",    "difficulty": "intermediate", "interview_type": "Technical"}},
    {"day_number": 4, "title": "Banking Awareness",          "session_config": {"profession": "Bank PO", "mode": "chat",    "difficulty": "intermediate", "interview_type": "Technical"}},
    {"day_number": 5, "title": "HR Round Basics",            "session_config": {"profession": "Bank PO", "mode": "chat",    "difficulty": "intermediate", "interview_type": "Behavioral"}},
    {"day_number": 6, "title": "Mixed Mock — Full Length",   "session_config": {"profession": "Bank PO", "mode": "classic", "difficulty": "expert",       "interview_type": "Mixed"}},
    {"day_number": 7, "title": "Final Review & Mock",        "session_config": {"profession": "Bank PO", "mode": "classic", "difficulty": "expert",       "interview_type": "Mixed"}}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Seed data: UPSC 14-day path
INSERT INTO prep_paths (id, title, description, duration_days, profession, days)
VALUES (
  'upsc-14day',
  'UPSC 14-Day Prep',
  'A two-week guided track moving from current affairs and ethics fundamentals through full-length mock interviews for UPSC/Civil Services aspirants.',
  14,
  'Government Job (SSC/UPSC)',
  '[
    {"day_number": 1,  "title": "Current Affairs Warm-up",        "session_config": {"profession": "Government Job (SSC/UPSC)", "mode": "chat",    "difficulty": "beginner",     "interview_type": "Behavioral"}},
    {"day_number": 2,  "title": "Polity Basics",                  "session_config": {"profession": "Government Job (SSC/UPSC)", "mode": "chat",    "difficulty": "beginner",     "interview_type": "Technical"}},
    {"day_number": 3,  "title": "Ethics & Integrity",              "session_config": {"profession": "Government Job (SSC/UPSC)", "mode": "chat",    "difficulty": "intermediate", "interview_type": "Behavioral"}},
    {"day_number": 4,  "title": "Economy Fundamentals",            "session_config": {"profession": "Government Job (SSC/UPSC)", "mode": "chat",    "difficulty": "intermediate", "interview_type": "Technical"}},
    {"day_number": 5,  "title": "Geography & Environment",         "session_config": {"profession": "Government Job (SSC/UPSC)", "mode": "chat",    "difficulty": "intermediate", "interview_type": "Technical"}},
    {"day_number": 6,  "title": "Optional Subject Drill",          "session_config": {"profession": "Government Job (SSC/UPSC)", "mode": "chat",    "difficulty": "intermediate", "interview_type": "Technical"}},
    {"day_number": 7,  "title": "Mid-Point Mock",                  "session_config": {"profession": "Government Job (SSC/UPSC)", "mode": "classic", "difficulty": "expert",       "interview_type": "Mixed"}},
    {"day_number": 8,  "title": "International Relations",         "session_config": {"profession": "Government Job (SSC/UPSC)", "mode": "chat",    "difficulty": "intermediate", "interview_type": "Technical"}},
    {"day_number": 9,  "title": "Social Issues & Welfare Schemes",  "session_config": {"profession": "Government Job (SSC/UPSC)", "mode": "chat",    "difficulty": "intermediate", "interview_type": "Behavioral"}},
    {"day_number": 10, "title": "DAF-Based Personal Questions",     "session_config": {"profession": "Government Job (SSC/UPSC)", "mode": "chat",    "difficulty": "intermediate", "interview_type": "Behavioral"}},
    {"day_number": 11, "title": "Current Affairs Deep-Dive",        "session_config": {"profession": "Government Job (SSC/UPSC)", "mode": "chat",    "difficulty": "expert",       "interview_type": "Mixed"}},
    {"day_number": 12, "title": "Situational & Integrity Questions","session_config": {"profession": "Government Job (SSC/UPSC)", "mode": "chat",    "difficulty": "expert",       "interview_type": "Behavioral"}},
    {"day_number": 13, "title": "Stress Interview Simulation",      "session_config": {"profession": "Government Job (SSC/UPSC)", "mode": "classic", "difficulty": "expert",       "interview_type": "Mixed"}},
    {"day_number": 14, "title": "Final Full-Length Mock",           "session_config": {"profession": "Government Job (SSC/UPSC)", "mode": "classic", "difficulty": "expert",       "interview_type": "Mixed"}}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;
