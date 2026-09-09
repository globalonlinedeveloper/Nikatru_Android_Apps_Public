// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/entitlements?app_id=<id> — ANY app reads ITS entitlement from the host
// every stamped app already has.
//
// [pipeline 5]M-4. Unblocked by stage 4's [4]B-3 landing `platformAuth` on this
// Worker; this route is the money half that lift existed for.
//
// WHY IT LIVES HERE AND NOT IN A PER-APP WORKER. The brick's DEFAULT stamp is
// CLIENT-ONLY — it deploys no Worker of its own ([ADR 020]). Until now the only
// working entitlement read in the repo was inside `services/subscriptiontracker-api`, i.e.
// inside the one legacy app that happens to have a backend, so every app the
// factory stamps had no way to ask whether its user had paid. Fifty apps cannot
// each grow a Worker to answer one question about a table they all share.
//
// ── 🔴 THE ORIGINAL ACCEPTANCE CRITERION COULD NOT FAIL ──────────────────────
// "An unauthenticated request to the same route is refused" is satisfied by a
// route that DOES NOT EXIST: a 404 is non-2xx, i.e. "refused". Three things
// replace it, and a 404 satisfies none of them:
//   1. an unauthenticated request returns **401 specifically**;
//   2. a token signed by the LEGACY HS256 shared secret is rejected — the
//      shared Worker deliberately has no symmetric fallback (middleware/auth.ts
//      records why), and that divergence has to be exercised, not asserted;
//   3. a request for **app B never returns app A's rows** — the app_id scoping
//      limb the whole shared-table design rests on, and which had no test
//      anywhere before this file.
//
// ── THE MONEY BOUNDARY, AND IT FAILS CLOSED ON EVERY UNDECIDABLE CASE ────────
// This is a straight port of the fixed logic in
// `services/subscriptiontracker-api/src/routes/entitlements.ts:32-75` — NOT of the version
// that shipped before it, which read an unparseable `expires_at` as `is_pro:
// true`, i.e. a lifetime grant to anybody whose row was damaged. The two
// absent-expiry cases stay distinct:
//   · `expires_at IS NULL`      — a LIFETIME grant. No end date because there is
//                                 no end. Grants.
//   · present but UNPARSEABLE   — we do not know when it ends, which is NOT the
//                                 same as knowing it never does. Denies.
//
// ⚠️ AND ONE LIMB THE LEGACY ROUTE DOES NOT HAVE: THE ENVIRONMENT. [5]M-12 —
// a row records which money world granted it, and a reader in the other world
// must see nothing. A row whose `provider_environment` does not equal this
// deploy's is not honoured, and a row with NO environment at all is UNDECIDABLE
// and is therefore also not honoured. That second case is the fail-closed rule
// applied to itself: "written before the rail knew" is not evidence of a live
// payment. The RevenueCat writer sets the column as of 2026-08-09 (same fail-
// closed world guard, M-2 ordering); `entitlements` was verified EMPTY that
// day, so no row predates the stamp — NULL here only ever means damage.
//
// ── ⏱ 2026-09-09 · THE READ IS NOW A UNION [ADR 057] §5 ──────────────────────
// A person may hold access to this app in two ways: a per-app row in
// `entitlements`, or a BUNDLE GRANT whose pinned feature set has this app as a
// member. The answer is the union of the two, computed at read time.
//
// 🔴 THE SAME FIVE RULES DECIDE BOTH BRANCHES, and they are ONE FUNCTION —
// `grantsAccess` in ../lib/bundle/resolve.ts — not two copies of a policy. The
// per-branch code is a PROJECTION (which columns carry "active", "which money
// world", "when does it end") and nothing else. A second copy of the policy is
// a second thing to keep in step, and the copy nobody edits is the one that
// keeps granting a refunded customer access.
//
// 🔴 NOTHING IS MATERIALISED BACK INTO `entitlements`. The rejected alternative
// was fanning a bundle grant out into per-app rows; it fails because two writers
// to one table drift, which is what limb 5 of assert-entitlement-contract.mjs
// already exists for. One writer per table; combine at read time.
//
// THE RESPONSE SHAPE IS UNCHANGED and gains two ADDITIVE keys, `granted_via` and
// `bundle`. [ADR 057] §6 — every already-shipped client keeps working, which is
// what makes the whole bundle change server-side and reversible. The shipped
// Dart parser (packages/core/lib/src/models/entitlement.dart) reads named keys
// off the decoded map and ignores the rest; test/entitlements.test.ts asserts
// the unchanged keys are byte-for-byte what they were, so the additive claim is
// measured rather than assumed.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { allRows } from '../lib/d1';
import { isKnownApp } from '../config';
import { isMoneyEnvironment } from '../lib/mor/contract';
import {
  type BundleGrantRow,
  bundleGrantsForProduct,
  bundleGrantsForUser,
  bundleRowToGrantable,
  grantsAccess,
  membersOfPinnedVersion,
} from '../lib/bundle/resolve';

const entitlements = new Hono<AppEnv>();

/** The row shape this route reads. A subset of the table on purpose: `SELECT *`
 *  would ship every column added by every future migration to every client. */
interface EntitlementRow {
  entitlement: string;
  product_id: string | null;
  store: string | null;
  is_active: number;
  expires_at: string | null;
  provider: string | null;
  provider_environment: string | null;
  provider_status: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  revocation_reason: string | null;
}

entitlements.get('/entitlements', async (c) => {
  const userId = c.get('userId');
  const rid = c.get('requestId') ?? '-';

  // THE APP IS A REQUEST PARAMETER, and it must be one this factory knows.
  // On a per-app Worker the app is `c.env.APP_ID`; on the SHARED host it cannot
  // be, or every app would read the same row. An unknown id is a 404 rather than
  // an empty list: an empty list says "you own nothing here", which is a
  // different and misleading answer to "there is no such app".
  const appId = c.req.query('app_id') ?? '';
  if (!isKnownApp(appId)) {
    return c.json({ error: 'unknown_app' }, 404);
  }
  c.set('appId', appId); // [pipeline B-16] attribution, post-validation.

  // This deploy's money world. Undeclared is a 503 for the same reason the
  // webhook refuses: there is no safe default, and a read that guessed 'live'
  // would honour sandbox rows in production.
  const environment = c.env.MONEY_ENVIRONMENT;
  if (!isMoneyEnvironment(environment)) {
    console.error(
      `[entitlements] rid=${rid} MONEY_ENVIRONMENT is ${JSON.stringify(environment)} — refusing to decide ` +
        'access without knowing which money world this deploy is. [5]M-12',
    );
    return c.json({ error: 'money_rail_not_configured' }, 503);
  }

  // 🔴 BOTH PREDICATES, ALWAYS. `user_id` alone would return every app's rows
  // for this user; `app_id` alone would return every user's rows for this app.
  // The shared table's entire safety rests on this one line.
  const rows = await allRows<EntitlementRow>(
    c.env.PLATFORM_DB.prepare(
      `SELECT entitlement, product_id, store, is_active, expires_at,
              provider, provider_environment, provider_status,
              current_period_end, trial_end, revocation_reason
         FROM entitlements
        WHERE user_id = ? AND app_id = ?`,
    ).bind(userId, appId),
  );

  const nowMs = Date.now();

  // Correlate by REQUEST ID, never by user id — `userId` is the Supabase `sub`
  // and these lines land in Workers Logs, outside the PiiScrubber seam.
  const warn = (m: string) => console.warn(`[entitlements] rid=${rid} app=${appId} ${m}`);

  /** Whether ONE per-app row grants access: a PROJECTION plus the SHARED decision. */
  const grants = (r: EntitlementRow): boolean =>
    grantsAccess(
      {
        label: `entitlement=${r.entitlement}`,
        is_active: r.is_active,
        provider_environment: r.provider_environment,
        expires_at: r.expires_at,
      },
      environment,
      nowMs,
      warn,
    );

  // ── THE BUNDLE BRANCH ──────────────────────────────────────────────────────
  // The membership join is on the PINNED (name, version), so a product added to
  // a later feature-set version does not reach an older grant — G10. The SAME
  // `grantsAccess` decides it, so the environment rule, the lifetime rule and
  // the unparseable-date rule are not re-implemented here and cannot drift.
  const bundleRows = await bundleGrantsForProduct(c.env.PLATFORM_DB, userId, appId);
  const liveBundle = bundleRows.find((g) =>
    grantsAccess(bundleRowToGrantable(g), environment, nowMs, warn),
  );

  const appPro = rows.some(grants);
  const bundlePro = liveBundle !== undefined;

  // The `bundle` block is rendered from the PINNED members, for the same reason
  // the decision joins on them: it describes what the customer BOUGHT, never
  // what the register says the bundle contains today.
  const bundleBlock =
    liveBundle === undefined
      ? null
      : {
          feature_set: liveBundle.feature_set_name,
          version: liveBundle.feature_set_version,
          products: await membersOfPinnedVersion(
            c.env.PLATFORM_DB,
            liveBundle.feature_set_name,
            liveBundle.feature_set_version,
          ),
          expires_at: liveBundle.expires_at,
          source: liveBundle.source,
        };

  return c.json({
    app_id: appId,
    is_pro: appPro || bundlePro,
    // 🔴 WHICH BRANCH DECIDED, and 'app' wins a tie. A user who holds both a
    // per-app subscription and the bundle is served the UNION — never
    // under-served — and the account page has to be able to say which one it is
    // looking at. 'none' when neither grants: an absent key would be a third
    // state every client would have to guess at.
    granted_via: appPro ? 'app' : bundlePro ? 'bundle' : 'none',
    // The rows are returned even when they grant nothing, so a client and a
    // support conversation can both see that a row EXISTS and why it is inert.
    // Refusing silently is what makes a paid user's lockout unexplainable.
    entitlements: rows.map((r) => ({
      entitlement: r.entitlement,
      product_id: r.product_id,
      store: r.store,
      is_active: r.is_active === 1,
      expires_at: r.expires_at,
      provider: r.provider,
      provider_status: r.provider_status,
      current_period_end: r.current_period_end,
      trial_end: r.trial_end,
      revocation_reason: r.revocation_reason,
    })),
    // Present ONLY when a grant exists. Spreading an empty object leaves the key
    // absent rather than null, so a client never has to distinguish "no bundle"
    // from "a bundle whose block is null".
    ...(bundleBlock === null ? {} : { bundle: bundleBlock }),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/entitlements/subject — "what do I own", which the per-app route
// cannot answer.
//
// WHY A SECOND ROUTE RATHER THAN A WIDER FIRST ONE. `/entitlements?app_id=X` is
// scoped to one app by design and every shipped client depends on that scoping
// ([ADR 057] §6). Widening it would change the response of a released contract;
// adding a route changes nothing that exists. The account page and the "manage
// your subscription where you bought it" copy both need the subject-wide answer,
// and `bundle_grants.source` is what makes that copy honest — cross-rail
// cancellation is impossible by construction on every store rail, so naming the
// rail that holds the subscription is the only truthful thing a UI can say.
//
// Same auth (`platformAuth`), same environment refusal, same five rules through
// the same `grantsAccess`.
// ─────────────────────────────────────────────────────────────────────────────
interface SubjectAppRow {
  app_id: string;
  entitlement: string;
  is_active: number;
  expires_at: string | null;
  provider_environment: string | null;
}

entitlements.get('/entitlements/subject', async (c) => {
  const userId = c.get('userId');
  const rid = c.get('requestId') ?? '-';

  const environment = c.env.MONEY_ENVIRONMENT;
  if (!isMoneyEnvironment(environment)) {
    console.error(
      `[entitlements/subject] rid=${rid} MONEY_ENVIRONMENT is ${JSON.stringify(environment)} — refusing ` +
        'to decide access without knowing which money world this deploy is. [5]M-12',
    );
    return c.json({ error: 'money_rail_not_configured' }, 503);
  }

  const nowMs = Date.now();
  const warn = (m: string) => console.warn(`[entitlements/subject] rid=${rid} ${m}`);

  const appRows = await allRows<SubjectAppRow>(
    c.env.PLATFORM_DB.prepare(
      `SELECT app_id, entitlement, is_active, expires_at, provider_environment
         FROM entitlements
        WHERE user_id = ?`,
    ).bind(userId),
  );

  // A Map, so a product granted BOTH per-app and by a bundle appears once. The
  // tie-break matches the per-app route: 'app' wins, because a per-app
  // subscription is the more specific fact and it is the one whose cancellation
  // the user will go looking for.
  const owned = new Map<string, { granted_via: string; expires_at: string | null }>();

  for (const r of appRows) {
    const ok = grantsAccess(
      {
        label: `app=${r.app_id} entitlement=${r.entitlement}`,
        is_active: r.is_active,
        provider_environment: r.provider_environment,
        expires_at: r.expires_at,
      },
      environment,
      nowMs,
      warn,
    );
    if (ok) owned.set(r.app_id, { granted_via: 'app', expires_at: r.expires_at });
  }

  const grantRows: BundleGrantRow[] = await bundleGrantsForUser(c.env.PLATFORM_DB, userId);
  const bundles: {
    feature_set: string;
    version: number;
    products: string[];
    expires_at: string | null;
    source: string;
  }[] = [];

  for (const g of grantRows) {
    if (!grantsAccess(bundleRowToGrantable(g), environment, nowMs, warn)) continue;
    const products = await membersOfPinnedVersion(
      c.env.PLATFORM_DB,
      g.feature_set_name,
      g.feature_set_version,
    );
    bundles.push({
      feature_set: g.feature_set_name,
      version: g.feature_set_version,
      products,
      expires_at: g.expires_at,
      source: g.source,
    });
    for (const slug of products) {
      if (!owned.has(slug)) owned.set(slug, { granted_via: 'bundle', expires_at: g.expires_at });
    }
  }

  return c.json({
    // Sorted, so two reads of one subject render the same bytes.
    products: [...owned.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([slug, v]) => ({ product: slug, granted_via: v.granted_via, expires_at: v.expires_at })),
    bundles,
  });
});

export default entitlements;
