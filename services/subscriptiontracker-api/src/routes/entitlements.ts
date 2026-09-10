// ─────────────────────────────────────────────────────────────────────────────
// /v1/entitlements — read this user's entitlement for THIS app from PLATFORM_DB.
//
// ── ⏱ 2026-09-10 · THIS WORKER NO LONGER CARRIES A READER OF ITS OWN ─────────
// Until today this file held its own `SELECT … FROM entitlements` — "a smaller
// subset, not the same one" as the shared host's, its header said — with no
// knowledge of `bundle_grants`, `granted_via` or a pinned feature set. The
// bundle union ([ADR 057] §5, #587), the extension membership (#612) and the
// receipts wave (#603) all landed in the OTHER reader, so a bundle purchase was
// invisible to any caller of this route. Two readers of one money table is the
// defect; the fix is that there is ONE, in services/_shared/src/entitlement-read.ts,
// and this file is a carrier for it exactly as the shared host is. The answer
// this route gives is now byte-identical to
// `GET platform.nikatru.com/v1/entitlements?app_id=<APP_ID>` for the same user
// and the same rows — services/platform/test/one-entitlement-reader.test.ts
// drives one fixture through both and compares the bytes.
//
// ── WHAT THIS FILE INJECTS INTO THE READER, AND WHY ──────────────────────────
//   · `isKnownProduct: (id) => id === c.env.APP_ID` — a per-app Worker answers
//     for exactly ONE product, by construction: the id never comes from the
//     request, it is the deploy's own `APP_ID` var. The reader still applies
//     the check, so the [5]M-4 refusal is structural rather than skipped.
//   · `isMoneyEnvironment` from ../lib/money — this Worker's copy of the
//     two-value vocabulary (that file's header records why it restates rather
//     than imports contracts/entitlement).
//   · `allRows` from ../lib/d1 — this Worker's transient-D1 retry.
//
// ── THE WIRE SHAPE CHANGED, ADDITIVELY, AND ONE KEY LEFT ─────────────────────
// Each row now carries `provider`, `provider_status`, `current_period_end`,
// `trial_end` and `revocation_reason`; the envelope gains `granted_via` and,
// only when a live grant exists, `bundle`. `provider_environment` is NO LONGER
// on the wire: the money world is a deploy fact, the deny reason is logged
// server-side against the request id (test/entitlements.test.ts asserts the
// log names the world), and no released client ever read the key. The shared
// host never sent it and its suite asserts it is absent, so keeping it here
// would have kept the two answers different by one key forever.
//
// The `c.json({ … })` literal is written here rather than returned by the
// reader so tooling/ci/assert-analytics-contract.mjs can keep reading route
// files for the envelope it pins; the shared host writes the identical literal.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { allRows } from '../lib/d1';
import { isMoneyEnvironment } from '../lib/money';
import {
  type EntitlementReadDeps,
  readProductEntitlement,
} from '../../../_shared/src/entitlement-read';

const app = new Hono<AppEnv>();

// GET / — { app_id, is_pro, granted_via, entitlements: [...], bundle? }
app.get('/', async (c) => {
  const userId = c.get('userId');
  const appId = c.env.APP_ID;
  const rid = c.get('requestId') ?? '-';

  const deps: EntitlementReadDeps = {
    db: c.env.PLATFORM_DB,
    allRows,
    isMoneyEnvironment,
    // ONE product per deploy. `APP_ID` is a wrangler var, never request input.
    isKnownProduct: (id) => id === appId,
    warn: (m) => console.warn(m),
    error: (m) => console.error(m),
  };
  const read = await readProductEntitlement(deps, {
    userId,
    productId: appId,
    environment: c.env.MONEY_ENVIRONMENT,
    rid,
  });

  // Unreachable while `isKnownProduct` is the singleton above; kept so the
  // carrier answers the reader's every outcome rather than assuming one away.
  if (read.kind === 'unknown_product') {
    return c.json({ error: 'unknown_app' }, 404);
  }
  // [5]M-12 — undeclared money world: no safe default, refuse.
  if (read.kind === 'money_rail_not_configured') {
    return c.json({ error: 'money_rail_not_configured' }, 503);
  }

  return c.json({
    app_id: read.app_id,
    is_pro: read.is_pro,
    granted_via: read.granted_via,
    entitlements: read.entitlements,
    bundle: read.bundle ?? undefined,
  });
});

export default app;
