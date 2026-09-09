-- ─────────────────────────────────────────────────────────────────────────────
-- 0001_entitlements.sql — SHARED entitlements schema (platform_db).
--
-- Owned + applied by services/platform (the SOLE platform_db migrations applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- Relocated from services/subscriptiontracker-api/migrations/0002_entitlements.sql to fix the
-- footgun where a platform_db migration lived in an APP_DB migrations dir.
-- Idempotent (IF NOT EXISTS) so applying against the already-live platform_db is
-- a safe no-op. One row per (user, app, entitlement); RevenueCat webhook upserts,
-- each app's /entitlements route reads. Shared across all portfolio apps.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS entitlements (
  user_id     TEXT,
  app_id      TEXT,
  entitlement TEXT,
  product_id  TEXT,
  store       TEXT,
  is_active   INTEGER DEFAULT 0,  -- boolean 0/1
  expires_at  TEXT,               -- ISO-8601, nullable
  updated_at  TEXT,
  PRIMARY KEY (user_id, app_id, entitlement)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_user
  ON entitlements (user_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_user_app
  ON entitlements (user_id, app_id);
