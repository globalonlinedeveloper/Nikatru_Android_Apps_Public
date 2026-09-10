// ─────────────────────────────────────────────────────────────────────────────
// THE NIGHTLY BACKSTOP — `moneyRederive` re-derives stored provider
// notifications whose derivation never concluded.
//
// 🔴 THE DEFECT. A `refused` derivation (a refund that arrived BEFORE the grant
// it reverses) or a derivation that THREW left the stored row unconcluded, and
// until 2026-09-10 nothing in the Worker ever re-read it: the refunded customer
// kept Pro for good. routes/money.ts now answers 503 so the rail re-delivers
// (test/money.test.ts); this file proves the limb that catches whatever outlives
// the rail's 3-day retry window.
//
// Every case drives the REAL writer (src/lib/mor/store.ts) over the REAL
// migrations, and the money question is asserted on the entitlement row — never
// on a heartbeat alone.
//
// MUTATION PROOF: change the predicate in `unconcludedNotifications`
// (`LIKE 'refused:%'` → any other prefix) and the refund-before-grant case goes
// RED on `is_active: 1`; remove `await moneyRederive(env)` from the nightly
// handler and test/scheduled-crons.test.ts goes RED on the missing job.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  MAX_REDERIVE_PER_RUN,
  MONEY_REDERIVE_JOB,
  REDERIVE_MAX_AGE_DAYS,
  moneyRederive,
} from '../src/scheduled';
import {
  deriveAndApply,
  isUnconcluded,
  persistNotification,
  unconcludedNotifications,
  type DerivationState,
} from '../src/lib/mor/store';
import { PADDLE_CUSTOM_DATA_APP_ID, PADDLE_CUSTOM_DATA_USER_ID, paddleVerifier } from '../src/lib/mor/paddle';
import { realPlatformDb, type RealDb } from './harness';
import type { Env } from '../src/types';

const NOW_MS = Date.parse('2026-09-10T12:00:00.000Z');
const USER = 'user-rederive';
const APP = 'subscriptiontracker';
const SUB = 'sub_0000000000000000000000009';

function subscriptionBody(o: { eventId: string; occurredAt: string; status: string; periodEnd: string | null; withAccount?: boolean }): string {
  const custom: Record<string, string> = {};
  if (o.withAccount !== false) {
    custom[PADDLE_CUSTOM_DATA_USER_ID] = USER;
    custom[PADDLE_CUSTOM_DATA_APP_ID] = APP;
  }
  return JSON.stringify({
    event_id: o.eventId,
    notification_id: 'ntf_rd',
    event_type: 'subscription.updated',
    occurred_at: o.occurredAt,
    data: {
      id: SUB,
      status: o.status,
      current_billing_period: o.periodEnd === null ? null : { starts_at: '2026-08-01T00:00:00.000Z', ends_at: o.periodEnd },
      items: [],
      custom_data: custom,
      customer_id: 'ctm_0000000000000000000000009',
      customer: {},
    },
  });
}

function adjustmentBody(o: { eventId: string; occurredAt: string; subscriptionId?: string | null }): string {
  return JSON.stringify({
    event_id: o.eventId,
    notification_id: 'ntf_rd2',
    event_type: 'adjustment.created',
    occurred_at: o.occurredAt,
    data: {
      id: 'adj_0000000000000000000000009',
      action: 'refund',
      status: 'approved',
      transaction_id: 'txn_0000000000000000000000009',
      subscription_id: o.subscriptionId === undefined ? SUB : o.subscriptionId,
    },
  });
}

/** Deliver through the REAL store, the way the route does: persist, then derive. */
async function deliver(db: RealDb, raw: string): Promise<string> {
  const parsed = paddleVerifier.parse(raw);
  if (!parsed.ok) throw new Error(`the real paddle adapter refused the fixture — ${parsed.reason}`);
  const deps = { db: db as unknown as D1Database, environment: 'live' as const, nowMs: NOW_MS };
  await persistNotification(deps, parsed.notification, raw);
  return (await deriveAndApply(deps, parsed.notification)).outcome;
}

const link = (db: RealDb) =>
  db.db.exec(
    `INSERT INTO provider_accounts (provider, provider_subscription_id, app_id, user_id, linked_at) ` +
      `VALUES ('paddle','${SUB}','${APP}','${USER}','2026-08-01T00:00:00.000Z')`,
  );

/** `environment: null` means the variable is ABSENT — a default parameter would
 *  swallow an explicit `undefined`, which is exactly the case under test. */
const envFor = (db: RealDb, environment: string | null = 'live') =>
  ({ PLATFORM_DB: db, MONEY_ENVIRONMENT: environment ?? undefined }) as unknown as Env;

/** A RealDb whose `prepare` is intercepted and whose every other method (the
 *  heartbeat writer's `batch` included) still reaches the real instance. A
 *  spread would drop the prototype methods. */
function intercepting(real: RealDb, prepare: (sql: string) => unknown): RealDb {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'prepare') return prepare;
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

const heartbeat = (db: RealDb) =>
  db.rows('SELECT ok, detail FROM cron_heartbeat WHERE job = ? ORDER BY ran_at DESC', MONEY_REDERIVE_JOB)[0] as { ok: number; detail: string };

const entRow = (db: RealDb) => db.rows('SELECT is_active, revocation_reason FROM entitlements WHERE user_id = ?', USER)[0];

describe('🔴 refund BEFORE grant — the sweep re-derives the refused refund and the customer ends NOT entitled', () => {
  it('re-derives the refused refund once the grant is in, and prints what it did', async () => {
    const db = realPlatformDb();
    link(db);
    // 1 · the refund arrives first and is refused: no grant exists to reverse.
    expect(await deliver(db, adjustmentBody({ eventId: 'evt_rd_refund', occurredAt: '2026-09-03T00:00:00.000Z' }))).toBe('refused');
    // 2 · the grant arrives; the customer is Pro.
    expect(await deliver(db, subscriptionBody({ eventId: 'evt_rd_grant', occurredAt: '2026-09-01T00:00:00.000Z', status: 'active', periodEnd: '2027-01-01T00:00:00.000Z' }))).toBe('applied');
    expect(entRow(db).is_active).toBe(1);

    // 3 · the nightly limb.
    await moneyRederive(envFor(db), NOW_MS);

    // 🔴 THE MONEY QUESTION, on the row.
    expect(entRow(db)).toMatchObject({ is_active: 0, revocation_reason: 'refund_approved' });
    const hb = heartbeat(db);
    expect(hb.ok).toBe(1);
    expect(hb.detail).toContain('candidates=1');
    expect(hb.detail).toContain('applied=1');
    // And the row is now concluded, so tomorrow's run has nothing to do.
    expect(await unconcludedNotifications(db as unknown as D1Database, '2026-01-01T00:00:00.000Z', 100)).toHaveLength(0);
  });

  it('a candidate that is refused AGAIN is a printed count, not a red row — and stays for tomorrow', async () => {
    const db = realPlatformDb();
    link(db);
    expect(await deliver(db, adjustmentBody({ eventId: 'evt_rd_orphan', occurredAt: '2026-09-03T00:00:00.000Z' }))).toBe('refused');
    await moneyRederive(envFor(db), NOW_MS);
    const hb = heartbeat(db);
    expect(hb.ok).toBe(1);
    expect(hb.detail).toContain('candidates=1');
    expect(hb.detail).toContain('refused=1');
    expect(db.count('entitlements')).toBe(0);
    expect(await unconcludedNotifications(db as unknown as D1Database, '2026-01-01T00:00:00.000Z', 100)).toHaveLength(1);
  });
});

describe('the sweep is bounded, and it fails closed', () => {
  it('a row older than the age bound is left alone, and the heartbeat says so', async () => {
    const db = realPlatformDb();
    link(db);
    expect(await deliver(db, adjustmentBody({ eventId: 'evt_rd_old', occurredAt: '2026-01-03T00:00:00.000Z' }))).toBe('refused');
    const tooOld = new Date(NOW_MS - (REDERIVE_MAX_AGE_DAYS + 10) * 86_400_000).toISOString();
    db.db.exec(`UPDATE provider_notifications SET received_at = '${tooOld}'`);
    await moneyRederive(envFor(db), NOW_MS);
    const hb = heartbeat(db);
    expect(hb.ok).toBe(1);
    expect(hb.detail).toContain('candidates=0');
  });

  it('no MONEY_ENVIRONMENT: ok=0, nothing derived — the same refusal the route makes', async () => {
    const db = realPlatformDb();
    link(db);
    expect(await deliver(db, adjustmentBody({ eventId: 'evt_rd_refund', occurredAt: '2026-09-03T00:00:00.000Z' }))).toBe('refused');
    expect(await deliver(db, subscriptionBody({ eventId: 'evt_rd_grant', occurredAt: '2026-09-01T00:00:00.000Z', status: 'active', periodEnd: '2027-01-01T00:00:00.000Z' }))).toBe('applied');
    await moneyRederive(envFor(db, null), NOW_MS);
    const hb = heartbeat(db);
    expect(hb.ok).toBe(0);
    expect(hb.detail).toContain('MONEY_ENVIRONMENT');
    // The refund was NOT re-derived: the customer is still Pro, honestly.
    expect(entRow(db).is_active).toBe(1);
  });

  it('a failing query is an ok=0 row, never a silent "nothing to do"', async () => {
    const real = realPlatformDb();
    const db = intercepting(real, (sql) => {
      if (sql.includes('FROM provider_notifications')) throw new Error('injected D1 failure');
      return real.prepare(sql);
    });
    await moneyRederive(envFor(db), NOW_MS);
    const hb = heartbeat(real);
    expect(hb.ok).toBe(0);
    expect(hb.detail).toContain('injected D1 failure');
  });

  it('the per-run bound is a positive number the limb actually passes to the query', async () => {
    expect(MAX_REDERIVE_PER_RUN).toBeGreaterThan(0);
    expect(REDERIVE_MAX_AGE_DAYS).toBeGreaterThan(0);
  });
});

describe('"unconcluded" is ONE definition — the SQL and the predicate agree on every state the writer produces', () => {
  it('selects exactly the rows `isUnconcluded` accepts', async () => {
    const db = realPlatformDb();
    link(db);
    // refused (an adjustment before its grant)
    expect(await deliver(db, adjustmentBody({ eventId: 'evt_state_refused', occurredAt: '2026-09-03T00:00:00.000Z' }))).toBe('refused');
    // applied
    expect(await deliver(db, subscriptionBody({ eventId: 'evt_state_applied', occurredAt: '2026-09-01T00:00:00.000Z', status: 'active', periodEnd: '2027-01-01T00:00:00.000Z' }))).toBe('applied');
    // unclaimed (a subscription nobody is linked to, no metadata)
    const orphan = subscriptionBody({ eventId: 'evt_state_unclaimed', occurredAt: '2026-09-02T00:00:00.000Z', status: 'active', periodEnd: '2027-01-01T00:00:00.000Z', withAccount: false })
      .replace(SUB, 'sub_0000000000000000000000077');
    expect(await deliver(db, orphan)).toBe('unclaimed');
    // ignored (not a money entity)
    const product = JSON.stringify({ event_id: 'evt_state_ignored', notification_id: 'n', event_type: 'product.updated', occurred_at: '2026-09-02T00:00:00.000Z', data: { id: 'pro_1', name: 'x' } });
    expect(await deliver(db, product)).toBe('ignored');
    // never stamped (persisted, derivation never ran)
    const parsed = paddleVerifier.parse(subscriptionBody({ eventId: 'evt_state_unstamped', occurredAt: '2026-09-02T00:00:00.000Z', status: 'active', periodEnd: '2027-01-01T00:00:00.000Z' }));
    if (!parsed.ok) throw new Error(parsed.reason);
    await persistNotification({ db: db as unknown as D1Database, environment: 'live', nowMs: NOW_MS }, parsed.notification, 'raw');

    const all = db.rows('SELECT provider_event_id, derived_at, derive_error FROM provider_notifications') as unknown as Array<DerivationState & { provider_event_id: string }>;
    expect(all).toHaveLength(5);
    const byPredicate = all.filter((r) => isUnconcluded(r)).map((r) => r.provider_event_id).sort();
    const bySql = (await unconcludedNotifications(db as unknown as D1Database, '2026-01-01T00:00:00.000Z', 100))
      .map((r) => r.provider_event_id)
      .sort();
    expect(bySql).toEqual(byPredicate);
    // And the set is the one the header names: refused + never stamped, nothing else.
    expect(bySql).toEqual(['evt_state_refused', 'evt_state_unstamped']);
  });
});
