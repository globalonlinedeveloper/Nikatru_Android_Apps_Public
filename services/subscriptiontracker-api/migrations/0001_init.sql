-- ─────────────────────────────────────────────────────────────────────────────
-- 0001_init.sql — per-app data schema. Applies to APP_DB (subly_db).
--   wrangler d1 migrations apply APP_DB --local   (or --remote)
-- SQLite/D1 dialect. All timestamps are ISO-8601 TEXT; dates are 'YYYY-MM-DD'.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  name          TEXT,
  category      TEXT,
  price         REAL,
  cycle         TEXT CHECK (cycle IN ('monthly', 'yearly')),
  next_renewal  TEXT,               -- 'YYYY-MM-DD'
  plan          TEXT,
  glyph         TEXT,
  used_pct      INTEGER DEFAULT 0,
  usage_note    TEXT,
  unused        INTEGER DEFAULT 0,  -- boolean 0/1
  created_at    TEXT,
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user
  ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_renewal
  ON subscriptions (user_id, next_renewal);

CREATE TABLE IF NOT EXISTS budgets (
  user_id        TEXT PRIMARY KEY,
  monthly_budget REAL,
  updated_at     TEXT
);

CREATE TABLE IF NOT EXISTS budget_categories (
  user_id TEXT,
  name    TEXT,
  cap     REAL,
  PRIMARY KEY (user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_budget_categories_user
  ON budget_categories (user_id);

CREATE TABLE IF NOT EXISTS payment_history (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT,
  user_id         TEXT,
  amount          REAL,
  paid_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_payment_history_user
  ON payment_history (user_id);
CREATE INDEX IF NOT EXISTS idx_payment_history_subscription
  ON payment_history (subscription_id);
