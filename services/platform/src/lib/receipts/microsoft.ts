// ─────────────────────────────────────────────────────────────────────────────
// MICROSOFT STORE — the Collections API, and this rail has NO PUSH AT ALL.
//
// 🔴 THE CLEAREST CASE THAT A RECEIPT IS A PULL. Paddle signs a webhook, Apple
// signs a notification, Google at least pings. Microsoft sends nothing: the
// client obtains a Store ID key from the device and the SERVER asks
//
//   POST https://collections.mp.microsoft.com/v6.0/collections/query
//
// whether that identity holds the product. There is no message to forge because
// there is no message — which also means there is no way to pretend the client's
// word is evidence, and no branch below tries.
//
// ⚠️ THE STORE ID KEY IS SHORT-LIVED AND SCOPED TO ONE USER + ONE PUBLISHER, so
// replaying somebody else's key does not work at Microsoft's end either. That is
// a property of the rail and NOT the reason this file refuses forgeries — the
// reason is that only Microsoft's own answer is acted on.
//
// ── WHAT IS REAL HERE AND WHAT IS NOT ───────────────────────────────────────
// REAL: the request, the body shape, the response parse, the product match, the
// expiry resolution, every refusal. All exercised in the suite through the
// injected `fetchImpl`.
// NOT PRESENT: the Azure AD client-credentials exchange that mints the service
// access token. Partner Center association is not finished
// (research/2026-09-09/partner-center-association-2026-09-09.md), so
// `MICROSOFT_STORE_SERVICE_TOKEN` is read as already minted. Absent ⇒ 503.
// ─────────────────────────────────────────────────────────────────────────────
import {
  type ReceiptOutcome,
  type ReceiptVerifier,
  type ReceiptVerifyDeps,
  type ReceiptVerifyInput,
  isoFromStoreInstant,
  refuse,
} from './contract';

const COLLECTIONS_QUERY = 'https://collections.mp.microsoft.com/v6.0/collections/query';

/**
 * The fields read from one `CollectionItemContractV6` item, named as the
 * Collections reference names them
 * (learn.microsoft.com/windows/uwp/monetize/query-for-products, "Response
 * body"). Nothing not read is declared, so a reader cannot mistake a declared
 * field for a consulted one.
 */
interface CollectionItem {
  productId?: unknown;
  status?: unknown;
  /** "The end date of the item." Moves on every renewal. */
  endDate?: unknown;
  /** "The date this item was last modified." Moves on every state change. */
  modifiedDate?: unknown;
  orderId?: unknown;
  /** "An ID that identifies this collection item from other items the user owns. This ID is unique per product." */
  itemId?: unknown;
}

/**
 * 🔴 THE ORDERING CLOCK ON THIS RAIL IS THE LAST MODIFICATION, NOT THE PURCHASE.
 *
 * `occurredAt` feeds the [5]M-2 clause, which refuses an EQUAL clock. It
 * therefore has to be a field that moves on every renewal. `acquiredDate` —
 * "The date on which the user acquired the item" — is fixed for the item's
 * whole life, so keyed on it every renewal re-post was `stale` and the grant's
 * `expires_at` never advanced past period one.
 *
 * `modifiedDate` is the reference's "The date this item was last modified": a
 * renewal modifies the item (its `endDate` moves), so the clock moves with it,
 * and a re-delivery of an unchanged item leaves it equal — the true-duplicate
 * case the clause is right to refuse. `endDate` is the fallback for a document
 * that omits `modifiedDate` despite the reference marking it required; it moves
 * on renewal too. A document carrying neither has no clock and is refused by
 * the caller rather than ordered by a guess.
 */
function orderingClock(item: CollectionItem): string | null {
  return isoFromStoreInstant(item.modifiedDate) ?? isoFromStoreInstant(item.endDate);
}

/**
 * 🔴 `Active` AND NOTHING ELSE. Microsoft's collection item statuses include
 * `Expired`, `Revoked`, `Banned` and `ActivePendingSubscriptionUpdate`. Matching
 * a PREFIX ("starts with Active") would quietly admit the pending-update state,
 * which is a subscription mid-change and not one we have decided the rules for.
 * The set is exact and a state outside it denies.
 */
const ACTIVE_STATUS = 'Active';

export const microsoftStoreVerifier: ReceiptVerifier = {
  store: 'microsoft_store',
  source: 'microsoft_store',
  credentialEnvVars: ['MICROSOFT_STORE_SERVICE_TOKEN'],
  implemented: true,

  async verify(input: ReceiptVerifyInput, deps: ReceiptVerifyDeps): Promise<ReceiptOutcome> {
    const token = deps.credentials.MICROSOFT_STORE_SERVICE_TOKEN ?? '';
    if (token === '') {
      return refuse(
        503,
        'receipt_rail_not_configured',
        'MICROSOFT_STORE_SERVICE_TOKEN is not set, so the Collections API cannot be queried. ' +
          'The Store ID key the client posted proves nothing on its own and is not a fallback.',
      );
    }

    let res: Response;
    try {
      res = await deps.fetchImpl(COLLECTIONS_QUERY, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        // The documented request body, field for field
        // (learn.microsoft.com/windows/uwp/monetize/query-for-products,
        // "Request body"): `beneficiaries[].identityType` = "b2b",
        // `identityValue` = the Store ID key, `localTicketReference` = the
        // caller's own correlation id echoed back per item, and `productTypes`
        // is REQUIRED. The Store ID key IS the beneficiary identity and is
        // passed through verbatim; nothing about the caller is asserted by us.
        body: JSON.stringify({
          beneficiaries: [
            { identityType: 'b2b', identityValue: input.token, localTicketReference: 'nikatru' },
          ],
          maxPageSize: 100,
          productTypes: ['Durable'],
          // Only items valid NOW: "active status, start date < now, and end date
          // > now". An expired item is not evidence of anything we would grant.
          validityType: 'Valid',
        }),
      });
    } catch (err) {
      return refuse(502, 'store_unreachable', `Microsoft Collections could not be reached: ${String(err)}`);
    }

    if (res.status === 400 || res.status === 401 || res.status === 403) {
      // 🔴 THE FORGED / EXPIRED STORE-ID-KEY ANSWER. Microsoft would not take
      // the ticket. Nothing is written.
      return refuse(
        403,
        'receipt_not_verified',
        `Microsoft rejected the Store ID key (HTTP ${res.status}). No grant is written.`,
      );
    }
    if (!res.ok) {
      return refuse(502, 'store_error', `Microsoft Collections answered HTTP ${res.status}.`);
    }

    let doc: { items?: unknown };
    try {
      doc = (await res.json()) as { items?: unknown };
    } catch {
      return refuse(502, 'store_unreadable', 'Microsoft Collections answered with a body that is not JSON.');
    }

    const items = Array.isArray(doc.items) ? (doc.items as CollectionItem[]) : [];
    const held = items.find(
      (i) => typeof i?.productId === 'string' && i.productId !== '' && i.status === ACTIVE_STATUS,
    );
    if (held === undefined) {
      // The identity is genuine and holds NOTHING we sell. That is a real,
      // verified answer — and it is a refusal, not an error.
      return refuse(
        403,
        'receipt_not_active',
        `Microsoft reports no Active entitlement for this identity (${items.length} item(s) returned).`,
      );
    }

    const productId = held.productId as string;
    // A durable with no end date is a LIFETIME entitlement on this rail, and the
    // read's rule 3 already means exactly that. `null` is carried through rather
    // than being turned into a far-future date nobody could audit.
    const end = isoFromStoreInstant(held.endDate);
    const clock = orderingClock(held);
    if (clock === null) {
      // No `modifiedDate` and no `endDate`: the item cannot be placed in the
      // ordering, and a write with no clock would either always apply (a
      // guessed `now`) or never apply (NULL loses to everything). Neither is a
      // fact Microsoft stated. Refuse as unreadable.
      return refuse(
        502,
        'store_unreadable',
        'Microsoft Collections returned an Active item with neither modifiedDate nor endDate, so it cannot ' +
          'be ordered against the grant already held. Refusing rather than guessing a clock.',
      );
    }
    return {
      ok: true,
      receipt: {
        store: 'microsoft_store',
        productId,
        // Microsoft's collection ITEM id (`itemId`, "unique per product") is the
        // stable per-user handle for this entitlement; the Store ID key is
        // short-lived and would make every renewal look like a new
        // subscription. The product id is the fallback for an item without one,
        // and is per-user-stable for the same reason.
        subscriptionId: typeof held.itemId === 'string' && held.itemId !== '' ? held.itemId : productId,
        transactionId: typeof held.orderId === 'string' ? held.orderId : null,
        status: ACTIVE_STATUS,
        isActive: true,
        expiresAt: end,
        currentPeriodEnd: end,
        trialEnd: null,
        // The clock that moves per renewal — see `orderingClock`. NEVER
        // `acquiredDate`, which is constant and made every renewal `stale`.
        occurredAt: clock,
      },
    };
  },
};
