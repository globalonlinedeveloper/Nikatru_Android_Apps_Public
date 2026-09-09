-- ─────────────────────────────────────────────────────────────────────────────
-- 0008_app_id_slug_rename.sql — THE ROWS FOLLOW THE SLUG, OR THE DATASET SPLITS.
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- 🔴 WHAT THIS IS FOR. The app slug moved from `subly` to `subscriptiontracker`
-- (owner decision 2026-09-09: one identifier family, no special cases). `app_id`
-- in this database IS that slug — `services/platform/src/routes/events.ts:230`
-- refuses any write whose `app_id` is not a key of `DEFAULT_CONFIGS`, and
-- `src/config.ts:225-228` builds `DEFAULT_CONFIGS` from `catalog/apps.json` at
-- module load. So the moment the catalogue says `subscriptiontracker`, every new
-- row is written under the new slug and every existing row keeps the old one.
--
-- Nothing would go red. `GET /config/subly` would 404, the app would ask for
-- `subscriptiontracker` and get a clean answer, and the history would simply
-- stop at the rename — two datasets for one app, with no marker saying so. That
-- is the silent split this migration exists to prevent.
--
-- ── THE MEASUREMENT THIS IS SIZED AGAINST ────────────────────────────────────
-- Read from the production census that `tooling/ops/check-prod-provenance.mjs`
-- already runs against live D1 and prints — ops-watch run 34319151705, step
-- timestamp 2026-09-09T06:28:59Z, 502 rows in platform_db:
--
--   events                111 row(s), 0 unattributable
--   events_daily           33 row(s), 0 unattributable   [app_id · app-catalogue]
--   consent_artifacts      20 row(s), 0 unattributable
--   entitlements            0 row(s)
--   provider_accounts       0 row(s)
--   cancellation_requests   0 row(s)
--   unclaimed_payments      1 row(s)   (app_id NULLABLE; value not read)
--
-- 164 rows carry a slug, and every one of them is `subly`: the write gate above
-- has admitted no other value since 2026-08-03, and `events_daily` is proved
-- directly — its provenance resolver fails any row whose `app_id` is not a
-- catalogue slug, and it reported ZERO unattributable on that run.
--
-- ⚠️ THE COUNTS ARE EVIDENCE, NOT A CONDITION. This migration does not assert
-- them. `WHERE app_id = 'subly'` is exactly right whether the true count is 164
-- or 164,000, and a row inserted between that census and this apply is caught by
-- the same predicate. Nothing here depends on the number being still true.
--
-- ── WHY `UPDATE`, AND WHY THAT IS ADDITIVE-ONLY ──────────────────────────────
-- tooling/ci/check-migrations.mjs bans `UPDATE … SET` with NO `WHERE` (that is
-- how a column gets nulled out wholesale) and permits a `WHERE`-scoped backfill;
-- 0004 already carries two that were applied --remote. Every statement below is
-- scoped to the one departing value and touches no other app's rows — so on a
-- database where the rename already happened, or where the slug never existed,
-- each statement matches nothing and the migration is a no-op.
--
-- ── THE TWO KEY COLUMNS, AND WHY NO CONFLICT IS POSSIBLE ─────────────────────
-- `app_id` is inside two constraints, so these are key rewrites, not plain
-- value edits:
--   · entitlements   PRIMARY KEY (user_id, app_id, entitlement)   [0001:23]
--   · events_daily   UNIQUE (day, app_id, anon_id, event, feature) [0007:112]
-- A key rewrite can only fail on collision, and a collision needs a row already
-- sitting at the destination. `subscriptiontracker` has never been a served slug
-- — the write gate could not have admitted it — so the destination is empty in
-- both tables and the update is total. `entitlements` is empty outright (0 rows,
-- nobody has ever paid), which leaves `events_daily` as the only key column with
-- rows in it at all.
--
-- ⛔ WHAT THIS DELIBERATELY DOES NOT TOUCH. `subly_db` — the OTHER database,
-- the app's own — keeps its NAME. A D1 database is bound by `database_id`, not
-- by name (services/subscriptiontracker-api/wrangler.jsonc), so its name is
-- display only and renaming it is a create-and-migrate, not a declaration edit.
-- Its rows carry no `app_id` column: it is single-tenant by construction.
-- ─────────────────────────────────────────────────────────────────────────────

-- Analytics: the event stream and its daily rollup. The rollup's grain includes
-- app_id (0007:112-113), so this is a key rewrite into an empty destination.
UPDATE events           SET app_id = 'subscriptiontracker' WHERE app_id = 'subly';
UPDATE events_daily     SET app_id = 'subscriptiontracker' WHERE app_id = 'subly';

-- Consent artifacts are the LEGAL record that a given user agreed to analytics
-- on a given app. An orphaned consent row is worse than an orphaned event: it is
-- the evidence produced when someone exercises a right, and it has to be
-- findable under the id the app now reports.
UPDATE consent_artifacts SET app_id = 'subscriptiontracker' WHERE app_id = 'subly';

-- The money rail. Empty today (entitlements 0, provider_accounts 0,
-- cancellation_requests 0, and unclaimed_payments' app_id is nullable), so these
-- four match nothing on this apply. They are here because a migration that
-- covers only the tables that happen to be populated on the day it is written is
-- a migration that silently misses rows the first time money lands.
UPDATE entitlements           SET app_id = 'subscriptiontracker' WHERE app_id = 'subly';
UPDATE provider_accounts      SET app_id = 'subscriptiontracker' WHERE app_id = 'subly';
UPDATE cancellation_requests  SET app_id = 'subscriptiontracker' WHERE app_id = 'subly';
UPDATE unclaimed_payments     SET app_id = 'subscriptiontracker' WHERE app_id = 'subly';
