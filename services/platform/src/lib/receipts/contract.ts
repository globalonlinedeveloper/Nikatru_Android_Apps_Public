// ─────────────────────────────────────────────────────────────────────────────
// THE STORE-RECEIPT INTERFACE — the shape that makes "a purchase never grants on
// the client's word" a property of the code rather than a rule in a document.
//
// 🔴 THE DEFECT THIS EXISTS TO CLOSE, stated first. On iOS and Android the
// purchase→unlock leg runs INSIDE THE CLIENT: StoreKit and Play Billing hand the
// app a transaction, the app decides it is now Pro, and on those two platforms
// that unlock CANNOT BE REVERSED by us — there is no server call that takes it
// back, and `research/2026-09-09/bundle-entitlement-design-2026-09-09.md` §8
// files it as the one loop that could never be proven safe. A server that
// granted on the strength of the posted token would inherit the same
// irreversibility AND add a forgery surface, because an opaque token is a string
// anybody can send twice or make up.
//
// The replacement is one sentence and every type below serves it:
//
//   THE CLIENT POSTS AN OPAQUE TOKEN. THE SERVER CALLS THE STORE'S OWN API.
//   ONLY A VERIFIED SERVER-SIDE ANSWER WRITES A GRANT.
//
// So a forged token grants nothing (the store does not know it), a replayed
// token grants nothing new (the store answers with the SAME subscription, and
// the write is an upsert on that identity), and a push notification grants
// nothing on its own — Google's RTDN carries no proof in its body and Microsoft
// has no push at all, which is why `purchases.subscriptionsv2.get` and the
// Collections query are MANDATORY rather than an optimisation.
//
// ── WHY THE HTTP CALL IS A PARAMETER AND NOT AN IMPORT ──────────────────────
// `fetchImpl` is handed in. It is modelled on src/lib/mor/registry.ts's reason
// for existing as data: a seam that a guard and a test can both reach. Concretely
// it means the whole verifier — URL construction, auth header, response parse,
// state mapping — runs in the suite against a canned store answer, with NO
// network, NO secret and NO vendor account. A verifier whose transport were an
// imported global could only be tested by not testing it.
//
// ── AND AN UNCONFIGURED RAIL REFUSES, IT NEVER GRANTS ───────────────────────
// Apple, Google and Microsoft credentials DO NOT EXIST for this project today.
// A verifier with no configured credential answers 503 and writes nothing. The
// tempting alternative — "no credential, so trust the client this once" — is the
// exact failure this file is here to make impossible, and it would be invisible
// until the first forged token.
// ─────────────────────────────────────────────────────────────────────────────

/** What the client posted, plus the clock. The token is OPAQUE to us by design. */
export interface ReceiptVerifyInput {
  /** The store's own handle: a StoreKit transaction id, a Play purchase token, a Microsoft Store ID key. */
  readonly token: string;
  readonly nowMs: number;
}

/**
 * Everything the verifier needs from OUTSIDE itself.
 *
 * `credentials` is resolved from the environment by the route and passed in, so
 * the verifier never reads `c.env` and is therefore runnable anywhere — which is
 * what lets the suite exercise the real code path.
 */
export interface ReceiptVerifyDeps {
  readonly credentials: Readonly<Record<string, string>>;
  /** 🔴 THE INJECTABLE SEAM. Tests hand in a canned store answer; NO network. */
  readonly fetchImpl: typeof fetch;
}

/**
 * What the STORE said, normalised. Every field here came from the store's API
 * response and none of it came from the request body — that separation is
 * invariant G7 (`tooling/ci/assert-bundle-provenance.mjs`) expressed as a type.
 */
export interface VerifiedReceipt {
  /** The registry key: also the `provider` column and the URL segment. */
  readonly store: string;
  /** The store's product identifier. Maps to a feature set SERVER-SIDE. */
  readonly productId: string;
  /** The subscription identity the store restates on every renewal. */
  readonly subscriptionId: string;
  readonly transactionId: string | null;
  /** The rail's own status word, verbatim. Never re-spelled. */
  readonly status: string;
  /** Whether the STORE says this is a paid, current entitlement right now. */
  readonly isActive: boolean;
  readonly expiresAt: string | null;
  readonly currentPeriodEnd: string | null;
  readonly trialEnd: string | null;
  /**
   * The store's own clock for this state. Feeds the [5]M-2 ordering clause,
   * which refuses an EQUAL clock — so this MUST be a field that moves on every
   * renewal (Play: the latest `lineItems[].expiryTime`; Microsoft:
   * `modifiedDate`), and NEVER the purchase instant, which is constant for the
   * subscription's whole life and would make every renewal `stale`.
   */
  readonly occurredAt: string | null;
}

/**
 * ⚠️ THE FAILURE HALF CARRIES AN HTTP STATUS, and the statuses are not
 * interchangeable:
 *   403 — the store does not recognise this token, or says it is not paid. THE
 *         FORGED / REPLAYED-AS-NEW CASE. Nothing is written, ever.
 *   502 — the store's API could not be reached or answered nonsense. We do not
 *         know, so we do not decide; the client may retry.
 *   503 — this rail is NOT CONFIGURED on this deploy. Also "we do not know", and
 *         deliberately the same shape as the money route's refusal to run
 *         without MONEY_ENVIRONMENT: there is no safe default.
 */
export type ReceiptOutcome =
  | { readonly ok: true; readonly receipt: VerifiedReceipt }
  | {
      readonly ok: false;
      readonly status: 403 | 502 | 503;
      readonly code: string;
      readonly detail: string;
    };

/**
 * One store rail.
 *
 * Modelled on `MoRWebhookVerifier` in src/lib/mor/contract.ts, including the
 * reason its credential names are DATA: a guard can enumerate what a rail needs
 * from the registry instead of from a hand-kept list that goes stale the day a
 * rail is added.
 */
export interface ReceiptVerifier {
  /** URL segment, `bundle_grants.provider` value, registry key. One string. */
  readonly store: string;
  /**
   * The `bundle_sources` member a grant from this rail records. Seeded by
   * migration 0009 and mirrored in contracts/entitlement/bundle.js — read from
   * there rather than invented here, so a rail cannot record a provenance the
   * database has no row for.
   */
  readonly source: string;
  /**
   * Every environment variable this rail needs before it may answer at all.
   * EMPTY IS NOT PERMITTED: a rail that needs no credential is a rail that is
   * calling nothing, i.e. deciding from the client's word.
   */
  readonly credentialEnvVars: readonly string[];
  /**
   * Whether the verifier is implemented end-to-end, or is present in shape only.
   *
   * 🔴 RECORDED AS DATA BECAUSE THE HONEST ANSWER DIFFERS PER RAIL TODAY and a
   * reader must not have to infer it from how much code there is. `false` means
   * the rail REFUSES even when credentials are present — it never means "grants
   * with less evidence".
   */
  readonly implemented: boolean;
  verify(input: ReceiptVerifyInput, deps: ReceiptVerifyDeps): Promise<ReceiptOutcome>;
}

/** A small helper so every rail spells the refusal the same way. */
export function refuse(
  status: 403 | 502 | 503,
  code: string,
  detail: string,
): ReceiptOutcome {
  return { ok: false, status, code, detail };
}

/**
 * Normalise a store instant to the UTC ISO-8601 the ordering clause compares.
 *
 * The same rule `normalizeInstant` applies on the MoR side, and for the same
 * reason: epoch milliseconds stored raw would sort as a number-shaped string
 * against ISO strings and every comparison between two rails would be nonsense.
 * UNPARSEABLE RETURNS NULL rather than a guess — a date we cannot read is not a
 * date, and the read denies on it.
 */
export function isoFromStoreInstant(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
  if (typeof v !== 'string' || v.trim() === '') return null;
  // Play sends epoch millis AS A STRING. A bare digit run is that and nothing else.
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? new Date(n).toISOString() : null;
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
