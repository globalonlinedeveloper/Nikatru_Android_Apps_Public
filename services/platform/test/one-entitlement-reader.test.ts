// ─────────────────────────────────────────────────────────────────────────────
// one-entitlement-reader.test.ts — the SHARED HOST answers `/v1/entitlements`
// from the ONE reader in services/_shared/src/entitlement-read.ts, with the SAME
// bytes the per-app Worker answers — and the proof is the bytes, not the import.
//
// 🔴 THE DEFECT (measured on origin/main 543b3220, 2026-09-10). The per-app
// Worker carried a private `SELECT … FROM entitlements` with no bundle branch,
// while this Worker's route carried the union. A customer holding a live bundle
// grant and NO per-app row was `is_pro: false` on api.nikatru.com and
// `is_pro: true, granted_via: 'bundle'` here — for the SAME user and database.
//
// ⏱ 2026-09-11 · HOW EQUALITY IS PROVEN NOW. This file first mounted BOTH
// carriers and compared them directly, by importing
// services/subscriptiontracker-api/src/routes/entitlements.ts. That module
// imports `hono`, which resolves only from the api Worker's node_modules, so this
// Worker's `npx tsc --noEmit` failed in CI (TS2307 at 43,22 and TS7006 at 55,21)
// while passing on any machine with both Workers installed. Now each Worker's
// suite asserts ITS OWN carrier against the same seeded rows and the same
// expected bytes in services/_shared/test/entitlement-parity.ts: api == EXPECTED
// and platform == EXPECTED ⇒ api == platform, each half in the lane that owns
// its dependencies. services/_shared/test/worker-isolation.test.ts refuses the
// cross-Worker import that broke the lane.
//
// MUTATION THIS FILE CATCHES (green control first, restore re-verified green):
//   B  drop the bundle branch from the shared module → the bundle-only fixture
//      answers `is_pro: false` → RED here, and in the per-app Worker's suite.
// Mutation A — a private reader restored in the per-app route — is the per-app
// Worker's suite's to catch (services/subscriptiontracker-api/test/
// one-entitlement-reader.test.ts), and tooling/ci/assert-one-entitlement-reader.mjs
// refuses its `FROM entitlements` as an undeclared read.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import platformEntitlements from '../src/routes/entitlements';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';
import {
  PARITY_APP,
  PARITY_EXPECTED,
  PARITY_REQUEST_ID,
  PARITY_USER,
  revokeBundleGrant,
  seedAppRowOnly,
  seedBundleOnly,
} from '../../_shared/test/entitlement-parity';

/** Auth is stubbed — what is under test is the read; this Worker's auth is
 *  covered by its own suite against the real middleware. ⚠️ `null` means NO
 *  money environment, never `undefined`: an `undefined` argument is swallowed by
 *  the parameter default — the trap test/entitlements.test.ts records. */
function platformHost(db: RealDb, environment: string | null = 'live') {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', PARITY_USER);
    c.set('requestId', PARITY_REQUEST_ID);
    await next();
  });
  app.onError((_e, c) => c.json({ error: 'internal_error' }, 500));
  app.route('/v1', platformEntitlements);
  const env = {
    PLATFORM_DB: db,
    APP_ID: 'platform',
    API_VERSION: 'v1',
    MONEY_ENVIRONMENT: environment ?? undefined,
  } as unknown as AppEnv['Bindings'];
  return () => app.request(`/v1/entitlements?app_id=${PARITY_APP}`, {}, env);
}

describe('ONE reader — the shared host answers the shared bytes', () => {
  it('a bundle_grants row and NO entitlements row is entitled, via the bundle', async () => {
    const db = realPlatformDb();
    seedBundleOnly(db.db);
    expect(db.db.prepare('SELECT COUNT(*) AS n FROM entitlements').get()).toEqual({ n: 0 });

    const res = await platformHost(db)();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text).is_pro, 'the bundle branch decides').toBe(true);
    expect(text).toBe(PARITY_EXPECTED.bundleOnly);
  });

  it('a per-app row alone answers the shared bytes, and `bundle` is ABSENT', async () => {
    const db = realPlatformDb();
    seedAppRowOnly(db.db);
    const text = await (await platformHost(db)()).text();
    expect(text).toBe(PARITY_EXPECTED.appRowOnly);
    expect(text, 'the money world is not on the wire').not.toContain('provider_environment');
    expect(text, 'the subject is not on the wire').not.toContain(PARITY_USER);
  });

  it('a revoked bundle grant denies — G8', async () => {
    const db = realPlatformDb();
    seedBundleOnly(db.db);
    revokeBundleGrant(db.db);
    expect(await (await platformHost(db)()).text()).toBe(PARITY_EXPECTED.revokedBundle);
  });

  it('an undeclared MONEY_ENVIRONMENT is 503 with the shared refusal body', async () => {
    const db = realPlatformDb();
    seedBundleOnly(db.db);
    const res = await platformHost(db, null)();
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(PARITY_EXPECTED.moneyRailNotConfigured);
  });

  it('a database error never answers `is_pro: true` — the reader throws, the carrier answers 500', async () => {
    const db = realPlatformDb();
    seedBundleOnly(db.db);
    // Break the bundle table AFTER the per-app read would have found nothing:
    // the union must fail closed as a whole, not answer from the half that worked.
    db.db.exec('DROP TABLE feature_set_members');
    const res = await platformHost(db)();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe('{"error":"internal_error"}');
    expect(text).not.toContain('is_pro');
  });
});
