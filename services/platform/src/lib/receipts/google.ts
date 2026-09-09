// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE PLAY — `purchases.subscriptionsv2.get`, and it is MANDATORY.
//
// 🔴 THE RTDN IS A CACHE-INVALIDATION PING, NOT A RECEIPT. A Real-time developer
// notification tells you "something changed for this purchase token" and its body
// carries NO PROOF of what changed, of what was paid, or of whether the purchase
// is real. The authentication it does have is on the Pub/Sub subscription, not on
// the statement. So a grant written from an RTDN alone is a grant with no
// evidence — which is why migration 0009's seed row for `google_play_billing`
// says exactly that, in the database, where a future reader will find it.
//
// The purchase token the CLIENT posts is worth no more. It is an opaque string;
// anybody can send one, and a real one can be sent a hundred times. The only
// statement with evidential weight is Google's own answer to
//
//   GET https://androidpublisher.googleapis.com/androidpublisher/v3/applications
//       /{packageName}/purchases/subscriptionsv2/tokens/{token}
//
// which is what this file asks for and the ONLY thing it will act on.
//
// ── WHAT IS REAL HERE AND WHAT IS NOT ───────────────────────────────────────
// REAL: the URL, the auth header, the response parse, the state mapping, the
// expiry resolution and every refusal. All of it runs in the test suite against
// an injected `fetchImpl`.
// NOT PRESENT: a service-account OAuth exchange. `GOOGLE_PLAY_OAUTH_BEARER` is
// read as an already-minted access token because the service account itself does
// not exist yet (research/2026-09-09/google-service-account-access-2026-09-09.md).
// Absent ⇒ 503, never a grant. When the account is created, minting the bearer is
// one function and it changes nothing below.
// ─────────────────────────────────────────────────────────────────────────────
import {
  type ReceiptOutcome,
  type ReceiptVerifier,
  type ReceiptVerifyDeps,
  type ReceiptVerifyInput,
  isoFromStoreInstant,
  refuse,
} from './contract';

const API_HOST = 'https://androidpublisher.googleapis.com';

/**
 * The subscription states Google can report, and OUR reading of each.
 *
 * 🔴 THE DEFAULT IS DENY. An unrecognised state — a new one Google adds, or a
 * typo in a fixture — is UNDECIDABLE and therefore grants nothing. The
 * alternative (treat unknown as active) would mean every future Play API change
 * silently widens who is Pro.
 *
 * ⚠️ `IN_GRACE_PERIOD` GRANTS AND `ON_HOLD` DOES NOT, and the split is the same
 * one the RevenueCat writer already draws: a billing problem is grace, not a
 * revocation, and the outcome arrives later as an expiry. On hold, the user has
 * already lost access at Google's end and honouring it here would be us granting
 * what the store has taken away.
 */
const ACTIVE_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  // Cancelled but PAID THROUGH the current period — [5]M-8: cancel-at-period-end
  // is not a revocation, and revoking here would take away time already bought.
  'SUBSCRIPTION_STATE_CANCELED',
]);

interface PlayLineItem {
  productId?: unknown;
  expiryTime?: unknown;
  offerDetails?: unknown;
}

interface PlaySubscriptionV2 {
  subscriptionState?: unknown;
  latestOrderId?: unknown;
  startTime?: unknown;
  lineItems?: unknown;
  linkedPurchaseToken?: unknown;
  canceledStateContext?: unknown;
  testPurchase?: unknown;
}

function firstLineItem(doc: PlaySubscriptionV2): PlayLineItem | null {
  const items = Array.isArray(doc.lineItems) ? doc.lineItems : [];
  const first = items[0];
  return first !== null && typeof first === 'object' ? (first as PlayLineItem) : null;
}

export const googlePlayVerifier: ReceiptVerifier = {
  store: 'google_play',
  source: 'google_play_billing',
  credentialEnvVars: ['GOOGLE_PLAY_PACKAGE_NAME', 'GOOGLE_PLAY_OAUTH_BEARER'],
  implemented: true,

  async verify(input: ReceiptVerifyInput, deps: ReceiptVerifyDeps): Promise<ReceiptOutcome> {
    const pkg = deps.credentials.GOOGLE_PLAY_PACKAGE_NAME ?? '';
    const bearer = deps.credentials.GOOGLE_PLAY_OAUTH_BEARER ?? '';
    if (pkg === '' || bearer === '') {
      return refuse(
        503,
        'receipt_rail_not_configured',
        'GOOGLE_PLAY_PACKAGE_NAME and GOOGLE_PLAY_OAUTH_BEARER must both be set. Without them the server ' +
          'cannot ask Google anything, and the only remaining source of truth would be the token the ' +
          'client sent — which is precisely what this rail exists to refuse.',
      );
    }
    // The token goes in the PATH, so it is encoded. A token carrying a slash
    // would otherwise re-point the request at a different resource.
    const url =
      `${API_HOST}/androidpublisher/v3/applications/${encodeURIComponent(pkg)}` +
      `/purchases/subscriptionsv2/tokens/${encodeURIComponent(input.token)}`;

    let res: Response;
    try {
      res = await deps.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
      });
    } catch (err) {
      return refuse(502, 'store_unreachable', `Google Play API could not be reached: ${String(err)}`);
    }

    if (res.status === 404 || res.status === 400 || res.status === 410) {
      // 🔴 THE FORGED-TOKEN ANSWER. Google does not know this purchase token.
      // 403 and NOTHING WRITTEN. There is no branch below this one.
      return refuse(
        403,
        'receipt_not_verified',
        `Google Play does not recognise this purchase token (HTTP ${res.status}). No grant is written.`,
      );
    }
    if (!res.ok) {
      return refuse(502, 'store_error', `Google Play answered HTTP ${res.status}.`);
    }

    let doc: PlaySubscriptionV2;
    try {
      doc = (await res.json()) as PlaySubscriptionV2;
    } catch {
      return refuse(502, 'store_unreadable', 'Google Play answered with a body that is not JSON.');
    }

    const state = typeof doc.subscriptionState === 'string' ? doc.subscriptionState : '';
    const item = firstLineItem(doc);
    const productId = typeof item?.productId === 'string' ? item.productId : '';
    if (productId === '') {
      return refuse(
        502,
        'store_unreadable',
        'Google Play answered without a lineItems[0].productId, so what was bought is unknown. ' +
          'Refusing rather than granting a product nobody named.',
      );
    }
    if (!ACTIVE_STATES.has(state)) {
      return refuse(
        403,
        'receipt_not_active',
        `Google Play reports subscriptionState=${JSON.stringify(state)}, which grants nothing. ` +
          'An unrecognised state is UNDECIDABLE and denies for the same reason.',
      );
    }

    const expiry = isoFromStoreInstant(item?.expiryTime);
    const orderId = typeof doc.latestOrderId === 'string' ? doc.latestOrderId : null;
    return {
      ok: true,
      receipt: {
        store: 'google_play',
        productId,
        // 🔴 THE PURCHASE TOKEN IS THE SUBSCRIPTION IDENTITY on this rail, not the
        // order id: the order changes on every renewal and the token does not, so
        // keying on the order would make every renewal a NEW grant row instead of
        // an upsert onto the existing one.
        subscriptionId: input.token,
        transactionId: orderId,
        status: state,
        isActive: true,
        // Play states the end of the paid period and nothing else; `expiresAt`
        // and `currentPeriodEnd` are the SAME fact here, and saying so is
        // honester than inventing a difference.
        expiresAt: expiry,
        currentPeriodEnd: expiry,
        trialEnd: null,
        occurredAt: isoFromStoreInstant(doc.startTime) ?? new Date(input.nowMs).toISOString(),
      },
    };
  },
};
