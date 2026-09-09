// ─────────────────────────────────────────────────────────────────────────────
// The STORE-RECEIPT registry — the same shape, and the same reason, as
// src/lib/mor/registry.ts.
//
// It is DATA rather than a switch statement in the route because a guard can
// derive the rail set FROM THIS FILE. A guard whose right-hand side is a list
// kept inside the guard stops covering a rail the day one is added and never says
// so — the "a check that stopped checking" shape [pipeline F-10] exists for.
// Here, registering a rail puts it inside the floor automatically, and an EMPTY
// registry is COVERAGE LOST rather than a clean run over nothing.
//
// ⚠️ ALL THREE RAILS ARE REGISTERED AND NONE OF THEM IS CONFIGURED. That is the
// honest state as of 2026-09-09: no Apple, Google or Microsoft credential exists
// for this project. A registered-but-unconfigured rail answers 503 and names the
// variable it wants; an ABSENT rail would answer 404, which is indistinguishable
// from a typo in the URL and tells an operator nothing.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReceiptVerifier } from './contract';
import { appleIapVerifier } from './apple';
import { googlePlayVerifier } from './google';
import { microsoftStoreVerifier } from './microsoft';

/**
 * Every store rail the receipts route knows.
 *
 * ⚠️ PADDLE AND RAZORPAY ARE DELIBERATELY ABSENT and their absence is correct
 * rather than an omission: they are merchant-of-record WEBHOOK rails, verified by
 * an HMAC over the raw bytes at POST /v1/money/:provider. A receipt route for
 * them would be a second door onto the same evidence, and two doors to one
 * grant is how two writers to one table start.
 */
export const RECEIPT_VERIFIERS: readonly ReceiptVerifier[] = [
  appleIapVerifier,
  googlePlayVerifier,
  microsoftStoreVerifier,
];

const BY_STORE = new Map(RECEIPT_VERIFIERS.map((v) => [v.store, v]));

export function receiptVerifierFor(store: string): ReceiptVerifier | null {
  return BY_STORE.get(store) ?? null;
}
