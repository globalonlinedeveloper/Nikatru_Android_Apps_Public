// ─────────────────────────────────────────────────────────────────────────────
// THE REPLAY PROPERTY — the final entitlement does not depend on the order the
// rail delivered in.
//
// [5]M-2 · a notification is recorded VERBATIM, EXACTLY ONCE, BEFORE it is
//          interpreted, and an OUT-OF-ORDER delivery cannot re-grant a refunded
//          subscription.
//
// 🔴 WHAT WAS UNPROVEN. `research/2026-09-09/bundle-entitlement-design-2026-09-09.md`
// §8 lists "webhook ordering and retry as the provider really behaves" among the
// things that CANNOT be made production-ready before real money moves: no vendor
// guarantees delivery order and no fixture can prove a vendor's behaviour. The
// half that IS ours — whether our derivation cares — had never been executed in
// any order but the one the fixtures happened to be written in.
//
// The property is one SQL clause, in src/lib/mor/store.ts::upsertEntitlement:
//
//     WHERE entitlements.occurred_at IS NULL
//        OR excluded.occurred_at > entitlements.occurred_at
//
// and the defect it closes is stated in that file's own header: "A refund at T2
// and a retried purchase from T1 < T2 are TWO DIFFERENT EVENT IDS: both are
// stored exactly once, both are genuinely new, and the late one re-grants Pro to
// a refunded customer. Deduplication is orthogonal and cannot help."
//
// ⚠️ THE DRIVER IS NOT WRITTEN TWICE. The corpus loader, the five delivery
// orders, the round-based re-delivery and the byte-identity comparison all live
// in `tooling/ops/money-dry-run.mjs` and are imported here. That file is the
// OPERATOR's hand tool — pointed at a real `provider_notifications` export with
// `--from` — and this file is the CI guard; they must agree about what "replayed
// in four orders" means, and the only way two copies of that sentence agree is
// by there being one copy. What differs between them is the database factory
// (this file injects the real-migrations vitest harness; the ops script builds
// the same thing over node:sqlite because harness.ts pulls its SQL through
// Vite's `?raw` suffix, which bare `node` has no loader for) and nothing else.
//
// 🔴 AND THE RED CONTROLS ARE THE POINT. Order-independence asserted with no
// order-DEPENDENT case beside it proves nothing at all: a comparison that has
// silently stopped comparing prints exactly the same green. Two are recorded
// below — one input the clause CANNOT protect (equal clocks), and one run with
// the clause itself surgically removed from the real statement. Both must go
// red, and the assertions say so.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { deriveAndApply, persistNotification } from '../src/lib/mor/store';
import { PADDLE_CUSTOM_DATA_APP_ID, PADDLE_CUSTOM_DATA_USER_ID, paddleVerifier } from '../src/lib/mor/paddle';
import { realPlatformDb, type RealDb } from './harness';
import {
  DEFAULT_CORPUS_REL,
  DEFAULT_NOW_MS,
  ORDERS,
  defaultCorpusDir,
  loadCorpusDir,
  normalizeRows,
  relabelAsSecondRail,
  replayAllOrders,
  replayOrder,
  runRedControl,
  type ReplayDelivery,
} from '../../../tooling/ops/money-dry-run.mjs';

/** The clock every decision is taken against. Pinned, or `revoked_at` alone
 *  would differ between two runs of the SAME order and read as an ordering
 *  defect. It sits after every fixture event so the lapsed branches run. */
const NOW_MS = DEFAULT_NOW_MS;

const injected = {
  makeDb: () => realPlatformDb(),
  persistNotification,
  deriveAndApply,
  environment: 'live',
  nowMs: NOW_MS,
};

/** Parse with the REAL adapter — a fixture the shipped parser cannot read is a
 *  fixture that quietly left the run, and this turns that into a failure. */
function deliver(source: string, raw: string): ReplayDelivery {
  const parsed = paddleVerifier.parse(raw);
  if (!parsed.ok) throw new Error(`${source}: the real paddle adapter refused it — ${parsed.reason}`);
  return { source, notification: parsed.notification, raw };
}

// ── the same body builders money.test.ts uses, kept to its idioms ────────────

const USER = 'replay-user-0001';
const APP = 'subscriptiontracker';
const SUB = 'sub_replaytest00000000000001';

function subscriptionBody(o: {
  eventId: string;
  occurredAt: string;
  status: string;
  periodEnd: string | null;
  withAccount?: boolean;
}): string {
  const custom: Record<string, string> = {};
  if (o.withAccount !== false) {
    custom[PADDLE_CUSTOM_DATA_USER_ID] = USER;
    custom[PADDLE_CUSTOM_DATA_APP_ID] = APP;
  }
  return JSON.stringify({
    event_id: o.eventId,
    notification_id: `ntf_${o.eventId}`,
    event_type: 'subscription.updated',
    occurred_at: o.occurredAt,
    data: {
      id: SUB,
      status: o.status,
      current_billing_period:
        o.periodEnd === null ? null : { starts_at: '2026-08-01T00:00:00.000Z', ends_at: o.periodEnd },
      items: [],
      custom_data: custom,
      customer_id: 'ctm_replaytest00000000000001',
      customer: { id: 'ctm_replaytest00000000000001', email: 'replay-test@example.invalid' },
    },
  });
}

function adjustmentBody(o: { eventId: string; occurredAt: string; action: string }): string {
  return JSON.stringify({
    event_id: o.eventId,
    notification_id: `ntf_${o.eventId}`,
    event_type: 'adjustment.created',
    occurred_at: o.occurredAt,
    data: {
      id: 'adj_replaytest00000000000001',
      action: o.action,
      status: 'approved',
      transaction_id: 'txn_replaytest00000000000001',
      subscription_id: SUB,
    },
  });
}

/** The checked-in corpus, read off disk exactly as the ops script reads it. */
function fixtureDeliveries(): ReplayDelivery[] {
  const corpus = loadCorpusDir(defaultCorpusDir());
  if (corpus === null) throw new Error(`COVERAGE LOST — ${DEFAULT_CORPUS_REL} is not a directory`);
  return corpus.map((e) => deliver(e.source, e.raw));
}

const rowOf = (db: RealDb) => db.rows('SELECT * FROM entitlements WHERE user_id = ?', USER)[0];

// ─────────────────────────────────────────────────────────────────────────────

describe('[5]M-2 · the final entitlement is the same in every delivery order', () => {
  it('the checked-in corpus REFUSES to be empty — the subject exists before anything is claimed about it', () => {
    // A green order-independence verdict over zero events is the exact failure
    // this repository keeps deleting: it reads identically to a rail that was
    // actually checked. Two is the floor, because one event has no order.
    const corpus = loadCorpusDir(defaultCorpusDir());
    expect(corpus, `COVERAGE LOST — ${DEFAULT_CORPUS_REL} is not on disk`).not.toBeNull();
    expect(corpus!.length).toBeGreaterThanOrEqual(2);
  });

  it('five orders over two rails, one final state — in-order, reversed, duplicated, interleaved', async () => {
    const railA = fixtureDeliveries();
    // There is no second adapter in this tree (registry.ts registers exactly one
    // verifier and there is no Razorpay code anywhere under services/), so the
    // second rail is a RELABEL of the same parsed events onto its own provider,
    // subscription and account. It is keyed independently everywhere it lands,
    // which is what the interleaved orders exercise; it is not a claim that a
    // second vendor's bytes were parsed.
    const deliveries = [...railA, ...relabelAsSecondRail(railA)];

    const { runs, baseline, identical, mismatches } = await replayAllOrders({ ...injected, deliveries });

    expect(runs.map((r) => r.name)).toEqual(ORDERS.map((o) => o.name));
    expect(mismatches, mismatches.map((m) => `${m.name}\n${m.diff.join('\n')}`).join('\n')).toEqual([]);
    expect(identical).toBe(true);

    // Not vacuous: the corpus really did move an entitlement, twice.
    expect(baseline.rows).toHaveLength(2);
    expect(baseline.outcomes.filter((o) => o.outcome === 'applied').length).toBeGreaterThan(0);

    // And the answer it converges on is the SAFE one. The newest access-moving
    // event pauses the subscription, so a reversed delivery that left this
    // customer Pro would be the whole defect, and the row says it did not.
    for (const row of baseline.rows) {
      expect(row.is_active).toBe(0);
      expect(row.revocation_reason).toBe('subscription_paused');
      expect(row.occurred_at).toBe('2026-10-20T00:00:00.000Z');
    }

    // The reversed run is where the clause actually fires: almost every delivery
    // after the first should be REFUSED as older than what is stored.
    const reversed = runs.find((r) => r.name === 'reversed')!;
    expect(reversed.outcomes.filter((o) => o.outcome === 'stale').length).toBeGreaterThan(0);
  });

  it('A REFUNDED CUSTOMER IS NOT RE-GRANTED PRO BY A LATE, OLDER GRANT', async () => {
    // 🔴 THE EXACT DEFECT store.ts's HEADER NAMES FIRST, constructed. Three
    // notifications, three different event ids, all genuinely new — so dedup is
    // no help and cannot be:
    //
    //   T0  subscription.updated  active     -> Pro
    //   T2  adjustment.created    refund     -> revoked, money returned
    //   T1  subscription.updated  active     -> arrives LAST, occurred FIRST
    //
    // Without the ordering clause the third write wins on arrival and a customer
    // who has been refunded is Pro again, indefinitely, and nothing anywhere
    // says so.
    const db = realPlatformDb();
    const deps = { db, environment: 'live', nowMs: NOW_MS } as unknown as Parameters<typeof deriveAndApply>[0];

    const grantT0 = deliver('T0', subscriptionBody({ eventId: 'evt_grant_t0', occurredAt: '2026-09-01T00:00:00.000Z', status: 'active', periodEnd: '2027-01-01T00:00:00.000Z' }));
    const refundT2 = deliver('T2', adjustmentBody({ eventId: 'evt_refund_t2', occurredAt: '2026-09-03T00:00:00.000Z', action: 'refund' }));
    const grantT1 = deliver('T1', subscriptionBody({ eventId: 'evt_grant_t1', occurredAt: '2026-09-02T00:00:00.000Z', status: 'active', periodEnd: '2027-01-01T00:00:00.000Z' }));

    const outcomes: string[] = [];
    for (const d of [grantT0, refundT2, grantT1]) {
      await persistNotification(deps, d.notification as never, d.raw);
      outcomes.push((await deriveAndApply(deps, d.notification as never)).outcome);
    }

    expect(outcomes).toEqual(['applied', 'applied', 'stale']);

    const row = rowOf(db);
    expect(row.is_active).toBe(0);
    expect(row.revocation_reason).toBe('refund_approved');
    expect(row.last_event_id).toBe('evt_refund_t2');
    expect(row.occurred_at).toBe('2026-09-03T00:00:00.000Z');
    // Belt and braces on the money question itself, in the vocabulary the LEGACY
    // reader knows: services/subscriptiontracker-api's entitlement route sees only
    // is_active and expires_at, and it must reach the same answer.
    expect(Date.parse(String(row.expires_at))).toBeLessThanOrEqual(NOW_MS);
  });

  it('a refund that arrives BEFORE the grant it reverses still ends revoked — because it is re-derived', async () => {
    // This drives the SECOND pass through the dry-run's `--rounds`, which is the
    // operator's replay tool. In the deployed Worker the second pass is the
    // rail's own re-delivery: routes/money.ts answers 503 for a derivation that
    // refused, Paddle re-delivers, and the duplicate branch re-derives
    // (test/money.test.ts, "a refused derivation is NOT lost"); the nightly
    // `moneyRederive` limb re-runs whatever outlives the rail's retry window
    // (test/money-rederive.test.ts). This case is the smallest corpus for which
    // a second pass is load-bearing at all.
    const grant = deliver('grant', subscriptionBody({ eventId: 'evt_pair_grant', occurredAt: '2026-09-01T00:00:00.000Z', status: 'active', periodEnd: '2027-01-01T00:00:00.000Z' }));
    const refund = deliver('refund', adjustmentBody({ eventId: 'evt_pair_refund', occurredAt: '2026-09-03T00:00:00.000Z', action: 'refund' }));

    const forward = await replayOrder({ ...injected, deliveries: [grant, refund] });
    const backward = await replayOrder({ ...injected, deliveries: [refund, grant] });

    // Reversed took a second pass; forward did not. Both reached the same row.
    expect(forward.rounds).toBe(1);
    expect(backward.rounds).toBe(2);
    expect(backward.canonical).toBe(forward.canonical);
    expect((backward.db as RealDb).rows('SELECT is_active, revocation_reason FROM entitlements')[0]).toMatchObject({
      is_active: 0,
      revocation_reason: 'refund_approved',
    });

    // The money was kept rather than dropped while it was unattributable — the
    // refund's first pass found no account and recorded the fact.
    expect(backward.outcomes.filter((o) => o.outcome === 'unclaimed')).toHaveLength(1);
    expect((backward.db as RealDb).count('unclaimed_payments')).toBe(1);
  });

  it('every event duplicated: the same final row, and one stored notification per event', async () => {
    const deliveries = fixtureDeliveries();
    const single = await replayOrder({ ...injected, deliveries });
    const doubled = await replayOrder({ ...injected, deliveries: deliveries.flatMap((d) => [d, d]) });

    expect(doubled.canonical).toBe(single.canonical);

    // `ON CONFLICT (provider, provider_event_id) DO NOTHING` — asserted by two
    // rows becoming one, never by a substring of the SQL.
    const db = doubled.db as RealDb;
    expect(db.count('provider_notifications')).toBe(deliveries.length);
    expect(doubled.outcomes.filter((o) => o.outcome === 'duplicate')).toHaveLength(deliveries.length);
  });
});

describe('[5]M-2 · RED CONTROLS — this suite can go red', () => {
  it('RED CONTROL 1 — two events on the SAME provider clock ARE order-dependent', async () => {
    // The clause compares STRICTLY (`>`), so it cannot separate two events that
    // claim the same instant: whichever lands first wins and the second is
    // refused. That is not a defect to fix here — it is the one input for which
    // the clause offers no protection, and it is what proves the comparison
    // above is still comparing. If this pair ever comes out identical, every
    // green verdict in this file is a verdict about nothing.
    const red = await runRedControl(injected);
    expect(red.orderDependent, 'the harness reported IDENTICAL state for a pair the ordering clause cannot separate').toBe(true);
    expect(red.diff.length).toBeGreaterThan(0);
  });

  it('RED CONTROL 2 — with the ordering clause REMOVED from the real statement, reversed re-grants Pro', async () => {
    // The mutation is applied to the statement store.ts actually issues, on its
    // way to the engine — not to a copy of the SQL written out here, which would
    // only prove that a string this file typed behaves the way this file says.
    const ORDERING_CLAUSE = /\s*WHERE entitlements\.occurred_at IS NULL\s+OR excluded\.occurred_at > entitlements\.occurred_at/;
    const mutations: string[] = [];
    const defeated = () => {
      const real = realPlatformDb();
      return {
        prepare(sql: string) {
          if (ORDERING_CLAUSE.test(sql)) {
            mutations.push(sql);
            return real.prepare(sql.replace(ORDERING_CLAUSE, ''));
          }
          return real.prepare(sql);
        },
        batch: (statements: never[]) => real.batch(statements),
      };
    };

    const deliveries = fixtureDeliveries();
    const forward = await replayOrder({ ...injected, makeDb: defeated, deliveries });
    const backward = await replayOrder({ ...injected, makeDb: defeated, deliveries: [...deliveries].reverse() });

    // A mutation that never fired is not evidence of anything.
    expect(mutations.length, 'the ordering clause was never found in any statement — the mutation is vacuous').toBeGreaterThan(0);

    expect(backward.canonical).not.toBe(forward.canonical);

    // And say WHAT goes wrong, not merely that something does: with the clause
    // gone, the oldest event in the corpus — a TRIALING grant from August — is
    // the last one written, so a subscription this rail knows to be PAUSED comes
    // out active. That is the re-granted refund, in the shape this corpus has.
    expect(forward.rows[0].is_active).toBe(0);
    expect(backward.rows[0].is_active).toBe(1);
    expect(backward.rows[0].provider_status).toBe('trialing');

    // The protected run, for contrast, does NOT move with the order.
    const protectedForward = await replayOrder({ ...injected, deliveries });
    const protectedBackward = await replayOrder({ ...injected, deliveries: [...deliveries].reverse() });
    expect(protectedBackward.canonical).toBe(protectedForward.canonical);
    expect(normalizeRows(protectedBackward.rows)).toBe(protectedForward.canonical);
  });
});
