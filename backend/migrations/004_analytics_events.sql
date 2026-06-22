-- ============================================================
-- Analytics / Event Tracking — Supabase migration (v1)
-- ============================================================
--
-- Stores product + funnel events (page views, signups, session
-- starts/completes, upgrade clicks, etc.) for drop-off and
-- conversion analysis.
--
-- user_id and session_id are both nullable: anonymous (pre-signup)
-- events use session_id only; authenticated events carry user_id.

CREATE TABLE IF NOT EXISTS analytics_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  session_id  text,
  event       text NOT NULL,
  path        text,
  plan        text,
  properties  jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event      ON analytics_events(event);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id    ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session_id ON analytics_events(session_id);

-- Optional: prune raw events older than 180 days via a scheduled job/cron
-- to keep the table small. Aggregate rollups (if needed) should be
-- computed before pruning.
