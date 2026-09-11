// ─────────────────────────────────────────────────────────────────────────────
// entitlement-parity.ts — ONE fixture and ONE set of expected bytes for
// `GET /v1/entitlements`, imported by BOTH Workers' suites.
//
// 🔴 WHY THE TWO CARRIERS ARE NOT COMPARED INSIDE ONE FILE. ⏱ 2026-09-11.
// The first version of this proof (#617) mounted BOTH carriers in
// services/platform/test/one-entitlement-reader.test.ts, which imported
// services/subscriptiontracker-api/src/routes/entitlements.ts. That put the api
// Worker's source inside the platform Worker's module graph. `npx tsc --noEmit`
// in services/platform then resolved `hono` for that file from
// services/subscriptiontracker-api/node_modules — which the platform CI lane never
// installs, because each Worker runs its own `npm ci` — and failed:
//   ../subscriptiontracker-api/src/routes/entitlements.ts(43,22): error TS2307:
//     Cannot find module 'hono' or its corresponding type declarations.
//   ../subscriptiontracker-api/src/routes/entitlements.ts(55,21): error TS7006:
//     Parameter 'c' implicitly has an 'any' type.
// It passed on a laptop only because both Workers happened to be installed there.
//
// So equality is proven by TRANSITIVITY: each Worker's suite drives ITS OWN
// carrier through the SAME seeded rows and asserts the SAME bytes, written once
// below. api == EXPECTED and platform == EXPECTED ⇒ api == platform, and each
// half runs in the lane that owns its dependencies.
// services/_shared/test/worker-isolation.test.ts keeps a Worker from reaching
// into a sibling Worker's modules again.
//
// ⚠️ NO IMPORTS, ON PURPOSE. A bare import here resolves for nobody (see
// shared-home.test.ts); a relative one would tie the fixture to one carrier. The
// database handle is typed structurally — both harnesses expose the
// `node:sqlite` DatabaseSync they built from the real platform migrations as `.db`.
// ─────────────────────────────────────────────────────────────────────────────

/** The slice of a `node:sqlite` DatabaseSync the seeders use. */
export interface SeedDb {
  exec(sql: string): void;
  prepare(sql: string): { run(...args: never[]): unknown };
}

export const PARITY_USER = '11111111-1111-4111-8111-111111111111';
export const PARITY_APP = 'subscriptiontracker';
export const PARITY_EXT = 'fullshot';
export const PARITY_EXPIRES = '2099-01-01T00:00:00.000Z';
export const PARITY_REQUEST_ID = 'rid-parity';

type Run = (...args: unknown[]) => unknown;
const run = (db: SeedDb, sql: string, ...args: unknown[]) => (db.prepare(sql).run as unknown as Run)(...args);

/** A live bundle grant whose PINNED feature set contains the app and the
 *  extension, and NO `entitlements` row at all. */
export function seedBundleOnly(db: SeedDb): void {
  run(
    db,
    `INSERT INTO feature_sets (name, version, minted_at, minted_from, status)
     VALUES ('nikatru_bundle', 1, '2026-09-09T00:00:00.000Z', 'test-fixture', 'sellable')`,
  );
  for (const [slug, kind] of [
    [PARITY_APP, 'app'],
    [PARITY_EXT, 'extension'],
  ]) {
    run(db, `INSERT INTO feature_set_members (name, version, product_slug, product_kind) VALUES (?,?,?,?)`, 'nikatru_bundle', 1, slug, kind);
  }
  run(
    db,
    `INSERT INTO bundle_grants (
       grant_id, user_id, source, feature_set_name, feature_set_version,
       provider, provider_environment, provider_subscription_id, provider_transaction_id,
       provider_status, last_event_id, occurred_at, current_period_end, trial_end, expires_at,
       grace_until, revoked_at, revocation_reason, credit_days_applied, superseded_by,
       created_at, updated_at)
     VALUES ('grant-1', ?, 'paddle_bundle', 'nikatru_bundle', 1,
             'paddle', 'live', 'sub_1', NULL,
             'active', 'evt_1', '2026-09-09T00:00:00.000Z', NULL, NULL, ?,
             NULL, NULL, NULL, NULL, NULL,
             '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z')`,
    PARITY_USER,
    PARITY_EXPIRES,
  );
}

/** One live per-app row and no bundle grant. */
export function seedAppRowOnly(db: SeedDb): void {
  run(
    db,
    `INSERT INTO entitlements
       (user_id, app_id, entitlement, product_id, store, is_active, expires_at, updated_at,
        provider, provider_environment, provider_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    PARITY_USER,
    PARITY_APP,
    'pro',
    'p1',
    'STRIPE',
    1,
    PARITY_EXPIRES,
    '2026-08-01T00:00:00.000Z',
    'paddle',
    'live',
    'active',
  );
}

/** G8 — revoke the grant `seedBundleOnly` wrote. */
export function revokeBundleGrant(db: SeedDb): void {
  run(
    db,
    `UPDATE bundle_grants SET revoked_at = ?, revocation_reason = 'refund_approved' WHERE grant_id = 'grant-1'`,
    '2026-09-10T00:00:00.000Z',
  );
}

/** THE BYTES both carriers must answer, key order included — a client parses
 *  JSON, but "byte-identical" is the claim both route headers make, so it is the
 *  claim tested. `bundle` is ABSENT (not null) when no live grant exists; the
 *  money world (`provider_environment`) and the subject are on neither wire. */
export const PARITY_EXPECTED = {
  bundleOnly:
    '{"app_id":"subscriptiontracker","is_pro":true,"granted_via":"bundle","entitlements":[],' +
    '"bundle":{"feature_set":"nikatru_bundle","version":1,"products":["fullshot","subscriptiontracker"],' +
    '"expires_at":"2099-01-01T00:00:00.000Z","source":"paddle_bundle"}}',
  appRowOnly:
    '{"app_id":"subscriptiontracker","is_pro":true,"granted_via":"app","entitlements":[' +
    '{"entitlement":"pro","product_id":"p1","store":"STRIPE","is_active":true,"expires_at":"2099-01-01T00:00:00.000Z",' +
    '"provider":"paddle","provider_status":"active","current_period_end":null,"trial_end":null,"revocation_reason":null}]}',
  revokedBundle: '{"app_id":"subscriptiontracker","is_pro":false,"granted_via":"none","entitlements":[]}',
  moneyRailNotConfigured: '{"error":"money_rail_not_configured"}',
} as const;
