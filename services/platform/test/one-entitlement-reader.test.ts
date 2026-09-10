// ─────────────────────────────────────────────────────────────────────────────
// one-entitlement-reader.test.ts — BOTH Workers answer `/v1/entitlements` from
// the ONE reader in services/_shared/src/entitlement-read.ts, and the proof is
// the bytes, not the import.
//
// 🔴 THE DEFECT THIS FILE IS THE RED FOR (measured on origin/main 543b3220,
// 2026-09-10). `services/subscriptiontracker-api/src/routes/entitlements.ts`
// carried a private `SELECT … FROM entitlements` with no bundle branch, while
// the shared host's route carried the union. A customer holding a live bundle
// grant and NO per-app row was `is_pro: false` on api.nikatru.com and
// `is_pro: true, granted_via: 'bundle'` on platform.nikatru.com — for the SAME
// user and the SAME database. Two readers of one money table.
//
// TWO MUTATIONS THIS FILE CATCHES, each run on the real tree before the file
// was committed (green control first, restore re-verified green after):
//   A  restore the private reader in the per-app route   → the bundle-only
//      fixture answers `is_pro: false` there → RED (and the byte comparison
//      fails on `granted_via`/`bundle`).
//   B  drop the bundle branch from the shared module     → BOTH routes answer
//      `is_pro: false` for the bundle-only fixture → RED on the per-app route's
//      own assertion, not only on parity.
//
// The per-app route is mounted from ITS source tree, with ITS Hono copy (each
// Worker runs its own `npm ci`); the fixture is one real-SQL platform_db built
// from the real migrations. No mock answers anything here.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import platformEntitlements from '../src/routes/entitlements';
import apiEntitlements from '../../subscriptiontracker-api/src/routes/entitlements';
import type { AppEnv as PlatformEnv } from '../src/types';
import type { AppEnv as ApiEnv } from '../../subscriptiontracker-api/src/types';
import { realPlatformDb, type RealDb } from './harness';

const USER = '11111111-1111-4111-8111-111111111111';
const APP = 'subscriptiontracker';
const EXT = 'fullshot';
const EXPIRES = '2099-01-01T00:00:00.000Z';

/** Auth is stubbed on BOTH carriers — what is under test is the read, and each
 *  Worker's auth is covered by its own suite against the real middleware. */
function stubAuth<E extends { Variables: { userId: string; requestId: string } }>(app: Hono<E>) {
  app.use('*', async (c, next) => {
    c.set('userId', USER);
    c.set('requestId', 'rid-parity');
    await next();
  });
  app.onError((_e, c) => c.json({ error: 'internal_error' }, 500));
}

/** ⚠️ `null` means NO money environment, never `undefined`: an `undefined` argument is
 *  swallowed by the parameter default — the trap test/entitlements.test.ts records. */
function platformHost(db: RealDb, environment: string | null = 'live') {
  const app = new Hono<PlatformEnv>();
  stubAuth(app);
  app.route('/v1', platformEntitlements);
  const env = {
    PLATFORM_DB: db,
    APP_ID: 'platform',
    API_VERSION: 'v1',
    MONEY_ENVIRONMENT: environment ?? undefined,
  } as unknown as PlatformEnv['Bindings'];
  return () => app.request(`/v1/entitlements?app_id=${APP}`, {}, env);
}

function apiHost(db: RealDb, environment: string | null = 'live') {
  const app = new Hono<ApiEnv>();
  stubAuth(app);
  app.route('/v1/entitlements', apiEntitlements);
  const env = {
    PLATFORM_DB: db,
    APP_ID: APP,
    API_VERSION: 'v1',
    MONEY_ENVIRONMENT: environment ?? undefined,
  } as unknown as ApiEnv['Bindings'];
  return () => app.request('/v1/entitlements', {}, env);
}

/** THE FIXTURE: a live bundle grant whose pinned feature set contains the app
 *  and the extension, and NO `entitlements` row at all. */
function seedBundleOnly(db: RealDb) {
  db.db
    .prepare(
      `INSERT INTO feature_sets (name, version, minted_at, minted_from, status)
       VALUES ('nikatru_bundle', 1, '2026-09-09T00:00:00.000Z', 'test-fixture', 'sellable')`,
    )
    .run();
  for (const [slug, kind] of [
    [APP, 'app'],
    [EXT, 'extension'],
  ]) {
    db.db
      .prepare(`INSERT INTO feature_set_members (name, version, product_slug, product_kind) VALUES (?,?,?,?)`)
      .run('nikatru_bundle', 1, slug, kind);
  }
  db.db
    .prepare(
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
    )
    .run(USER, EXPIRES);
}

describe('ONE reader — a bundle grant reaches the per-app Worker', () => {
  it('a bundle_grants row and NO entitlements row is entitled on api.nikatru.com, via the bundle', async () => {
    const db = realPlatformDb();
    seedBundleOnly(db);
    expect(db.db.prepare('SELECT COUNT(*) AS n FROM entitlements').get()).toEqual({ n: 0 });

    const res = await apiHost(db)();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.is_pro, 'the bundle branch decides on the per-app Worker too').toBe(true);
    expect(body.granted_via).toBe('bundle');
    expect(body.entitlements).toEqual([]);
    expect(body.bundle).toEqual({
      feature_set: 'nikatru_bundle',
      version: 1,
      products: [EXT, APP], // sorted by slug — the pin, in a stable order
      expires_at: EXPIRES,
      source: 'paddle_bundle',
    });
  });

  it('the SAME fixture through the shared host is BYTE-IDENTICAL', async () => {
    const db = realPlatformDb();
    seedBundleOnly(db);
    const [viaApi, viaPlatform] = await Promise.all([apiHost(db)(), platformHost(db)()]);
    expect(viaApi.status).toBe(200);
    expect(viaPlatform.status).toBe(200);
    const [a, p] = await Promise.all([viaApi.text(), viaPlatform.text()]);
    expect(a).toBe(p);
    expect(a).toContain('"granted_via":"bundle"');
  });

  it('a per-app row alone is byte-identical too, and `bundle` is ABSENT on both', async () => {
    const db = realPlatformDb();
    db.db
      .prepare(
        `INSERT INTO entitlements
           (user_id, app_id, entitlement, product_id, store, is_active, expires_at, updated_at,
            provider, provider_environment, provider_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(USER, APP, 'pro', 'p1', 'STRIPE', 1, EXPIRES, '2026-08-01T00:00:00.000Z', 'paddle', 'live', 'active');
    const a = await (await apiHost(db)()).text();
    const p = await (await platformHost(db)()).text();
    expect(a).toBe(p);
    expect(JSON.parse(a)).toMatchObject({ app_id: APP, is_pro: true, granted_via: 'app' });
    expect(a).not.toContain('"bundle"');
    expect(a, 'the money world is not on either wire').not.toContain('provider_environment');
    expect(a, 'the subject is not on either wire').not.toContain(USER);
  });

  it('a revoked bundle grant denies on BOTH carriers — G8 reaches the per-app Worker', async () => {
    const db = realPlatformDb();
    seedBundleOnly(db);
    db.db
      .prepare(`UPDATE bundle_grants SET revoked_at = ?, revocation_reason = 'refund_approved' WHERE grant_id = 'grant-1'`)
      .run('2026-09-10T00:00:00.000Z');
    const a = await (await apiHost(db)()).text();
    const p = await (await platformHost(db)()).text();
    expect(a).toBe(p);
    expect(JSON.parse(a)).toMatchObject({ is_pro: false, granted_via: 'none' });
    expect(a).not.toContain('"bundle"');
  });

  it('an undeclared MONEY_ENVIRONMENT is 503 on BOTH carriers, with the same refusal body', async () => {
    const db = realPlatformDb();
    seedBundleOnly(db);
    const [a, p] = await Promise.all([apiHost(db, null)(), platformHost(db, null)()]);
    expect(a.status).toBe(503);
    expect(p.status).toBe(503);
    expect(await a.text()).toBe(await p.text());
  });

  it('a database error never answers `is_pro: true` — the reader throws, the carrier answers 500', async () => {
    const db = realPlatformDb();
    seedBundleOnly(db);
    // Break the bundle table AFTER the per-app read would have found nothing:
    // the union must fail closed as a whole, not answer from the half that worked.
    db.db.exec('DROP TABLE feature_set_members');
    const [a, p] = await Promise.all([apiHost(db)(), platformHost(db)()]);
    expect(a.status).toBe(500);
    expect(p.status).toBe(500);
    // ⚠️ The BODY is asserted in each Worker's own suite, not here: Hono's
    // `route()` decides which error handler wraps a sub-app by comparing its
    // handler to the DEFAULT by identity, and the per-app route is served by a
    // second Hono copy (each Worker runs its own `npm ci`), so this harness's
    // `onError` cannot reach it. The real carriers' `index.ts` both answer
    // `{"error":"internal_error"}`; what this file can prove across copies is
    // that neither answers an entitlement.
    for (const res of [a, p]) {
      const text = await res.text();
      expect(text).not.toContain('is_pro');
      expect(text).not.toContain('granted_via');
    }
  });
});
