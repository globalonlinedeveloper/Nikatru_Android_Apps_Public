-- ─────────────────────────────────────────────────────────────────────────────
-- 0009_bundle_grants.sql — THE BUNDLE PURCHASE, recorded before the first one.
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- [ADR 057] (DECIDED 2026-08-31) rules the mechanism and this migration is its
-- implementation, not a re-litigation of it:
--   §1  `entitlements` IS NOT TOUCHED. No new key, no nullable-`app_id` row, no
--       new meaning on an existing column. Nothing below alters that table.
--   §2  A BUNDLE PURCHASE IS A ROW THAT RECORDS THE PURCHASE. "A row that
--       records only the grant has thrown away the purchase, and that is
--       unrecoverable. A row that records the purchase can always derive the
--       grant." Fanning out to per-app rows stays available forever; un-fanning
--       does not.
--   §3  `source` IS AN ENUM DECIDED IN THIS MIGRATION OR NEVER. Rows written
--       before a value exists are unclassifiable forever. Section B seeds it.
--   §4  `feature_set` IS A NAME PLUS A PINNED VERSION. Resolving members against
--       whatever the config says today means editing a file silently changes a
--       stranger's purchased rights, with no audit trail and no migration.
--   §5  ONE WRITER PER TABLE; the read is a UNION. Nothing here materialises a
--       bundle grant back into `entitlements`.
--
-- 🔴 THE NULL TRAP THIS TABLE IS SHAPED TO REFUSE. [ADR 057] measured it against
-- the real 0001 DDL under node:sqlite 3.53.1:
--
--     3 identical inserts with app_id NULL   ->  rows after: 3
--     the same insert with a non-null app_id ->  UNIQUE constraint failed
--
-- A rowid table's PRIMARY KEY does not imply NOT NULL in SQLite and NULLs
-- compare as distinct, so a NULL key column turns an UPSERT into an APPEND and a
-- retried webhook multiplies a paying customer's rows forever while every
-- response stays 200. `entitlements` cannot be fixed — schema-evolution.md makes
-- migrations ADDITIVE-ONLY and SQLite has no `ALTER TABLE … ALTER PRIMARY KEY`.
-- THIS TABLE IS NEW, so the constraint is expressible here and is spelled out:
-- every identity column below is `NOT NULL`, and the uniqueness the upsert
-- targets is a UNIQUE INDEX over columns that cannot be NULL.
-- tooling/ci/assert-no-null-entitlement-key.mjs replays the DDL and proves it.
--
-- ⚠️ REPLAY. Every statement below is `CREATE TABLE IF NOT EXISTS`,
-- `CREATE [UNIQUE] INDEX IF NOT EXISTS` or `INSERT … ON CONFLICT DO NOTHING`.
-- There is no `ALTER TABLE … ADD COLUMN` anywhere in this file, so unlike 0004
-- and 0006 it is fully replay-safe and is listed in REPLAY_SAFE_MIGRATIONS in
-- services/platform/test/harness.ts. test/migrations-replay.test.ts classifies
-- every statement in the set and proves the claim rather than trusting it.
--
-- ⚠️ ZERO ROWS EXIST TODAY, and that is why the shape is decided now. The slug
-- rename (0008) carries the production census as of run 34319151705,
-- 2026-09-09T06:28:59Z: `entitlements` 0 rows, `provider_accounts` 0 rows. There
-- is nothing to migrate and nothing to back-fill, so every column that is
-- missing here is free to add today and missing FOREVER for the first paying
-- customer's row.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A · THE PURCHASE [ADR 057] §2 ────────────────────────────────────────────
-- ONE ROW PER PURCHASE, NEVER PER APP. The subscription identity is the thing
-- the provider states once; the set of products it unlocks is a computation over
-- facts already kept (§B, §C, §D) and can be redone.
CREATE TABLE IF NOT EXISTS bundle_grants (
  -- 🔴 A SURROGATE KEY, unlike `entitlements`, and the difference is deliberate.
  -- `entitlements`' identity IS the (user, app, entitlement) triple and every
  -- read is "this user, this app". A bundle grant's natural key is the PROVIDER
  -- SUBSCRIPTION — and two rails may mint the same opaque id, so the natural key
  -- is (provider, provider_subscription_id), a pair, not a single column. The
  -- surrogate is minted as sha256(provider ‖ '\0' ‖ provider_subscription_id) so
  -- it is REPRODUCIBLE from the notification alone: a retried delivery derives
  -- the same id and the upsert stays an upsert instead of becoming an append.
  -- `superseded_by` also needs a single column to point at.
  grant_id                 TEXT PRIMARY KEY NOT NULL,

  -- THE SUBJECT. One human = one user_id = the Supabase `sub`. NOT NULL is
  -- expressible because this table is new; see the header's NULL trap. A grant
  -- with no subject is not a grant, it is an append that nothing can revoke.
  --
  -- ⚠️ NAMED `user_id`, AND THAT IS LOAD-BEARING. The shared erasure route
  -- (services/platform/src/routes/account.ts) DERIVES the tables it empties from
  -- the schema: every table carrying a column literally called `user_id` is
  -- user-owned by definition, so this table joins the erasure set with no edit
  -- to the route. That is correct — a bundle grant is a link between a person
  -- and a purchase. tooling/ci/assert-erasure-reach.mjs grades the reach.
  user_id                  TEXT NOT NULL,

  -- WHICH KIND OF THING BOUGHT THIS. [ADR 057] §3: four different provenances
  -- have four different revocation rules, and provenance that was not written at
  -- insert time cannot be inferred afterwards from any column. References
  -- `bundle_sources` (section B) BY VALUE, the same way `entitlements`'
  -- `revocation_reason` references `revocation_reasons`.
  source                   TEXT NOT NULL,

  -- THE PINNED FEATURE SET. [ADR 057] §4. NAME PLUS VERSION, both NOT NULL,
  -- captured at insert. Adding a product to the bundle mints a NEW version and
  -- is forward-only; upgrading existing grants to it is then an explicit, dated,
  -- auditable act that somebody makes, rather than a side effect of editing
  -- catalog/bundles.json. A read that resolved members from the register at read
  -- time would be the money-rail equivalent of a guard that stopped scanning.
  feature_set_name         TEXT NOT NULL,
  feature_set_version      INTEGER NOT NULL,

  -- ── The money columns. IDENTICAL SEMANTICS TO `entitlements`, deliberately:
  -- one vocabulary, one set of readers, one fail-closed policy. A second
  -- spelling here would mean the union read in
  -- services/platform/src/routes/entitlements.ts had two policies to keep in
  -- step, which is the drift limb 5 of assert-entitlement-contract.mjs exists
  -- for.
  provider                 TEXT,
  -- [5]M-12 CARRIED INTO THE BUNDLE UNCHANGED. A row whose environment is not
  -- the reader's grants nothing, and a row with NO environment is UNDECIDABLE
  -- and therefore also grants nothing. Sandbox money never unlocks production,
  -- on this branch of the union exactly as on the other.
  provider_environment     TEXT,
  provider_subscription_id TEXT,
  provider_transaction_id  TEXT,
  provider_status          TEXT,

  -- THE [5]M-2 ORDERING PAIR. The upsert reuses 0004's tail clause VERBATIM
  -- against these two columns:
  --   WHERE bundle_grants.occurred_at IS NULL
  --      OR excluded.occurred_at > bundle_grants.occurred_at
  -- so a delayed retry of an older event cannot re-grant a refunded bundle.
  last_event_id            TEXT,
  occurred_at              TEXT,

  -- PAID THROUGH, TRIAL THROUGH, and ACCESS ENDS. The same three-way split
  -- `entitlements` carries: `current_period_end` is the billing fact,
  -- `trial_end` is the free part (the path regulators scrutinise hardest), and
  -- `expires_at` is the RESOLVED access end the read compares against — which is
  -- not always either of the other two once `credit_days_applied` is added.
  current_period_end       TEXT,
  trial_end                TEXT,
  expires_at               TEXT,

  -- SERVER-SIDE DUNNING GRACE, EXPLICIT AND BOUNDED. NULL = none. This is not
  -- the client's 3-day offline grace (packages/core/lib/src/entitlement_cache.dart)
  -- and must not be confused with it: that one bounds an UNVERIFIED answer, this
  -- one is a verified server fact with a date on it. A grace with no column is a
  -- grace nobody can audit or end.
  grace_until              TEXT,

  -- WHEN ACCESS WAS TAKEN AWAY, AND WHY. 🔴 THE REASON SET IS THE ONE SEEDED IN
  -- 0004 SECTION E — `revocation_reasons` — AND NOT A SECOND SET. A bundle
  -- refund, chargeback, expiry, pause or final dunning failure is the same event
  -- with the same consequence; a parallel vocabulary would mean two answers to
  -- "why did this person lose access" and a client that renders one of them
  -- would be reading a table the other half of the rail never writes.
  -- assert-entitlement-contract.mjs limb 9 holds them equal in BOTH directions.
  revoked_at               TEXT,
  revocation_reason        TEXT,

  -- THE PRORATION ANSWER, RECORDED RATHER THAN RECOMPUTED. On an upgrade from a
  -- single-app subscription mid-term the bundle starts IMMEDIATELY and the
  -- unused remainder of the single-app term is credited as extra BUNDLE DAYS:
  --   credit_days = ceil(days between now and the single-app current_period_end)
  -- added to this row's `expires_at`. It is written here because a value derived
  -- at read time from a `superseded_by` chain would change whenever either side
  -- of that chain was corrected, and a support conversation could never
  -- reconstruct what the customer was actually given.
  --
  -- MONEY-SIDE PRORATION IS THE RAIL'S AND IS NOT THIS COLUMN. Paddle, Razorpay,
  -- Apple and Google each compute their own credit; Microsoft Store and the
  -- extension stores compute none. Both outcomes are recorded — the rail's in the
  -- verbatim notification, ours here — because they are independent and a
  -- support conversation needs either one.
  credit_days_applied      INTEGER,

  -- THE UPGRADE LINK. NULL for a live grant. Points at the `grant_id` that
  -- replaced this one: single-app → bundle, or bundle v1 → v2. It is also how a
  -- duplicate-grant RACE is recorded: when two devices buy on two rails the
  -- server records BOTH rows, serves the UNION (the user is never under-served),
  -- sets this column on the older, and raises an operator alert. Cross-rail
  -- cancellation is impossible by construction on every store rail, so pretending
  -- to cancel the loser would be the failure mode; recording it is not.
  superseded_by            TEXT,

  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

-- THE UPSERT TARGET. `ON CONFLICT` must name a REAL uniqueness constraint, and
-- the identity a provider restates on every renewal / cancellation / refund is
-- (provider, provider_subscription_id) — not `grant_id`, which is derived FROM
-- it. Both columns are nullable on the table (a promo/comp grant has no
-- subscription), so this index is PARTIAL: NULLs compare as distinct in SQLite
-- and an unpartitioned unique index over a nullable pair would silently admit
-- unlimited (NULL, NULL) rows — the exact append-instead-of-upsert failure the
-- header measures. Operator grants are keyed by `grant_id` alone and never
-- reach this index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bundle_grants_provider_sub
  ON bundle_grants (provider, provider_subscription_id)
  WHERE provider IS NOT NULL AND provider_subscription_id IS NOT NULL;

-- "everything this person owns" — the union read's bundle branch, and the
-- /v1/entitlements/subject route.
CREATE INDEX IF NOT EXISTS idx_bundle_grants_user
  ON bundle_grants (user_id);
-- "everything this person still holds" — the live-grant scan the checkout
-- pre-check (409 already_entitled) runs before it will mint a transaction.
CREATE INDEX IF NOT EXISTS idx_bundle_grants_user_live
  ON bundle_grants (user_id, revoked_at);

-- ── B · THE SOURCE ENUM [ADR 057] §3 ─────────────────────────────────────────
-- 🔴 THIS SET IS DECIDED IN THIS MIGRATION OR NEVER, for the same reason
-- 0004 section E gives for the revocation reasons: a grant whose provenance was
-- not written at insert time is unclassifiable forever, and there is no
-- back-fill for a fact the provider only ever sent once.
--
-- IT IS A TABLE, NOT A CHECK CONSTRAINT AND NOT A COMMENT. A CHECK would freeze
-- the set permanently (adding a member needs a table rebuild, which
-- schema-evolution.md bans); a comment would be prose, and this repo asserts on
-- parsed structure rather than grepping prose.
--
-- 🔴 `requires_receipt` IS THE MACHINE-READABLE HALF OF "NO ENTITLEMENT WITHOUT
-- A VERIFIED RECEIPT". Without it that invariant is a rule a reviewer has to
-- remember, and the two legitimate exemptions (a promo code, an owner comp) look
-- exactly like the bug. With it, tooling/ci/assert-bundle-provenance.mjs can
-- READ which sources are exempt instead of hard-coding a list that drifts.
--
-- THE MEMBERS ARE FIVE RAILS AND TWO OPERATOR ACTS, and every one of the five is
-- seeded even though only Paddle has an adapter today. A rail that appears later
-- is then a price-id row and a verifier, not a migration — which is exactly the
-- property [ADR 057] §3 says cannot be added afterwards.
CREATE TABLE IF NOT EXISTS bundle_sources (
  source           TEXT PRIMARY KEY,
  -- 1 when a grant from this source is only legitimate if a VERIFIED provider
  -- receipt or notification stands behind it. 0 when the authority is an
  -- operator record instead — which is a different kind of evidence, not an
  -- absence of one.
  requires_receipt INTEGER NOT NULL DEFAULT 1,
  description      TEXT
);

INSERT INTO bundle_sources (source, requires_receipt, description) VALUES
  ('paddle_subscription',   1, 'A Paddle subscription. The MoR rail: Paddle is the merchant of record, the notification is HMAC-SHA256-signed over the raw bytes, and GET /subscriptions/{id} is the independent server-side pull.'),
  ('razorpay_subscription', 1, 'A Razorpay subscription — the INDIA rail, owner-locked. Signature is X-Razorpay-Signature, HMAC-SHA256 over the raw body; GET /v1/subscriptions/{id} is the pull. SEEDED BEFORE THE ADAPTER EXISTS ON PURPOSE: there is no Razorpay code under services/ as of 2026-09-09, and a source that is not in this set on the day the first Indian customer pays is unclassifiable forever.'),
  ('apple_iap',             1, 'An App Store in-app purchase. App Store Server Notifications V2 are a signed JWS, verifiable offline against Apple''s cert chain, and the App Store Server API is the pull. A grant is NEVER written on the client''s word.'),
  ('google_play_billing',   1, 'A Google Play subscription. 🔴 THE RTDN IS A CACHE-INVALIDATION PING, NOT A RECEIPT — its body carries no proof by itself, so purchases.subscriptionsv2.get is MANDATORY before anything is written. A source recorded from an RTDN alone would be a grant with no evidence.'),
  ('microsoft_store',       1, 'A Microsoft Store purchase. This rail has NO PUSH in the general case: the client obtains a Store ID key and the server queries the Collections/Purchase API. Poll-based, and therefore the clearest case that a receipt is a server-side pull rather than a message we were sent.'),
  ('promo_code',            0, 'An operator-issued promotional code. NO RECEIPT EXISTS AND THAT IS CORRECT — nobody paid. The authority is the operator record, which is why requires_receipt is 0 rather than the row being absent: an exemption that is written down can be audited, and one that is not is indistinguishable from the bug.'),
  ('owner_comp',            0, 'An owner comp — staff, a reviewer, a support make-good. Same shape as promo_code and kept separate from it because "why does this person have the bundle for free" has two different answers with two different review paths.')
ON CONFLICT(source) DO NOTHING;

-- ── C · THE PINNED FEATURE-SET DEFINITIONS [ADR 057] §4 ──────────────────────
-- A feature set is a NAME and a VERSION, and a version is IMMUTABLE once it is
-- `sellable`. That immutability is the whole point of pinning: a grant that
-- records (name, version) can always be resolved to the exact product list it
-- was sold under, no matter what the register says today.
CREATE TABLE IF NOT EXISTS feature_sets (
  name        TEXT NOT NULL,
  version     INTEGER NOT NULL,
  minted_at   TEXT NOT NULL,
  -- The commit or register hash this version was minted FROM. "Why does version
  -- 2 contain these four products" has one answer, and it is not a memory.
  minted_from TEXT,
  -- 'draft'    — being assembled; nothing may be sold under it.
  -- 'sellable' — MEMBERS ARE FROZEN. A grant may pin it.
  -- 'retired'  — no new grants; EXISTING GRANTS ARE UNAFFECTED, which is the
  --              reason retirement is a status rather than a DELETE. Deleting a
  --              version would strand every grant that pinned it — the read
  --              would resolve no members and a paying customer would silently
  --              lose everything.
  status      TEXT NOT NULL DEFAULT 'draft',
  PRIMARY KEY (name, version)
);

-- ── D · THE MEMBERS ──────────────────────────────────────────────────────────
-- 🔴 `product_slug`, NOT `app_id`. A PRODUCT IS AN app | extension | script.
-- The bundle spans categories by design, so a new category must be a DATA change
-- and never a schema change: `product_kind` records which register the slug came
-- from, and a fourth kind is one more permitted value, not a migration.
-- Constraining this column to `catalog/apps.json` would have made the extension
-- FullShot unrepresentable in the bundle it is the second half of.
CREATE TABLE IF NOT EXISTS feature_set_members (
  name         TEXT NOT NULL,
  version      INTEGER NOT NULL,
  -- The slug as it appears in catalog/apps.json or
  -- extensions/catalog/extensions.json. Same shape rule as an app id
  -- (^[a-z][a-z0-9_]*$) because a catalogue slug IS the product's identity
  -- everywhere else in the tree.
  product_slug TEXT NOT NULL,
  -- 'app' | 'extension' | 'script'. Recorded rather than looked up, for the same
  -- reason `source` is: which register a slug lived in on the day it was sold is
  -- a fact, and a slug that later moves between registers must not silently
  -- change what an old grant meant.
  product_kind TEXT NOT NULL,
  PRIMARY KEY (name, version, product_slug)
);

CREATE INDEX IF NOT EXISTS idx_feature_set_members_slug
  ON feature_set_members (product_slug);

-- ⚠️ NO FEATURE SET IS SEEDED HERE, AND THAT IS THE HONEST STATE. Which products
-- are in the bundle and what it costs are OWNER decisions ([ADR 057] "Not decided
-- here"). Seeding `nikatru_all` v1 as `sellable` from this file would assert an
-- offer nobody has made, and — because a sellable version's members are frozen —
-- would freeze it. The register catalog/bundles.json carries the DRAFT
-- definition; minting a version into these two tables is a dated, reviewed act.
--
-- It is also not needed for the coming-soon gate. That gate is DERIVED
-- (tooling/bundle-availability.mjs): liveProducts >= 2 AND members ⊆ live AND
-- every member resolves to a price. Today catalog/apps.json has one `live` row
-- and extensions/catalog/extensions.json has one `preview` row, so the count is
-- 1 and the answer is false — from data, not from a flag.
