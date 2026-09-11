// ─────────────────────────────────────────────────────────────────────────────
// one-entitlement-reader.test.ts — THIS Worker answers `/v1/entitlements` from
// the ONE reader in services/_shared/src/entitlement-read.ts, and the proof is
// the bytes, not the import.
//
// 🔴 THE DEFECT THIS FILE IS THE RED FOR (measured on origin/main 543b3220,
// 2026-09-10). src/routes/entitlements.ts carried a private
// `SELECT … FROM entitlements` with no bundle branch, while the shared host's
// route carried the union. A customer holding a live bundle grant and NO per-app
// row was `is_pro: false` on api.nikatru.com and `is_pro: true, granted_via:
// 'bundle'` on platform.nikatru.com — for the SAME user and the SAME database.
//
// The expected bytes live in services/_shared/test/entitlement-parity.ts and the
// shared host's suite (services/platform/test/one-entitlement-reader.test.ts)
// asserts the SAME constants against ITS carrier — equality by transitivity,
// because a single file mounting both carriers compiled only where both Workers
// were installed (that file's header records the TS2307).
//
// MUTATIONS THIS FILE CATCHES (green control first, restore re-verified green):
//   A  restore a private `SELECT … FROM entitlements` read in the per-app route
//      → the bundle-only fixture answers `is_pro: false` → RED here.
//   B  drop the bundle branch from the shared module → RED here AND in the
//      shared host's suite.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import entitlements from '../src/routes/entitlements';
import type { AppEnv } from '../src/types';
import { realPlatformDb } from './harness';
import {
  PARITY_APP,
  PARITY_EXPECTED,
  PARITY_REQUEST_ID,
  PARITY_USER,
  revokeBundleGrant,
  seedAppRowOnly,
  seedBundleOnly,
} from '../../_shared/test/entitlement-parity';

type Db = ReturnType<typeof realPlatformDb>;

/** Auth is stubbed — what is under test is the read; this Worker's auth is
 *  covered by test/auth.test.ts against the real middleware. ⚠️ `null` means NO
 *  money environment, never `undefined`: an `undefined` argument is swallowed by
 *  the parameter default. */
function apiHost(db: Db, environment: string | null = 'live') {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', PARITY_USER);
    c.set('requestId', PARITY_REQUEST_ID);
    await next();
  });
  app.onError((_e, c) => c.json({ error: 'internal_error' }, 500));
  app.route('/v1/entitlements', entitlements);
  const env = {
    PLATFORM_DB: db,
    APP_ID: PARITY_APP,
    API_VERSION: 'v1',
    MONEY_ENVIRONMENT: environment ?? undefined,
  } as unknown as AppEnv['Bindings'];
  return () => app.request('/v1/entitlements', {}, env);
}

describe('ONE reader — the per-app Worker answers the shared bytes', () => {
  it('a bundle_grants row and NO entitlements row is entitled here, via the bundle', async () => {
    const db = realPlatformDb();
    seedBundleOnly(db.db);
    expect(db.db.prepare('SELECT COUNT(*) AS n FROM entitlements').get()).toEqual({ n: 0 });

    const res = await apiHost(db)();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text).is_pro, 'the bundle branch decides on the per-app Worker too').toBe(true);
    expect(text).toBe(PARITY_EXPECTED.bundleOnly);
  });

  it('a per-app row alone answers the shared bytes, and `bundle` is ABSENT', async () => {
    const db = realPlatformDb();
    seedAppRowOnly(db.db);
    const text = await (await apiHost(db)()).text();
    expect(text).toBe(PARITY_EXPECTED.appRowOnly);
    expect(text, 'the money world is not on the wire').not.toContain('provider_environment');
    expect(text, 'the subject is not on the wire').not.toContain(PARITY_USER);
  });

  it('a revoked bundle grant denies — G8 reaches the per-app Worker', async () => {
    const db = realPlatformDb();
    seedBundleOnly(db.db);
    revokeBundleGrant(db.db);
    expect(await (await apiHost(db)()).text()).toBe(PARITY_EXPECTED.revokedBundle);
  });

  it('an undeclared MONEY_ENVIRONMENT is 503 with the shared refusal body', async () => {
    const db = realPlatformDb();
    seedBundleOnly(db.db);
    const res = await apiHost(db, null)();
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(PARITY_EXPECTED.moneyRailNotConfigured);
  });

  it('a database error never answers `is_pro: true` — the reader throws, the carrier answers 500', async () => {
    const db = realPlatformDb();
    seedBundleOnly(db.db);
    // Break the bundle table AFTER the per-app read would have found nothing:
    // the union must fail closed as a whole, not answer from the half that worked.
    db.db.exec('DROP TABLE feature_set_members');
    const res = await apiHost(db)();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe('{"error":"internal_error"}');
    expect(text).not.toContain('is_pro');
  });
});
