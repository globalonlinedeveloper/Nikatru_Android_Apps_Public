import type { MoRWebhookVerifier, ParseOutcome, VerifyOutcome } from './contract';

// ─────────────────────────────────────────────────────────────────────────────
// razorpay.ts — THE INDIA RAIL'S SIGNATURE CHECK, AND NOTHING IT CANNOT SOURCE.
//
// [ADR 076]: India domestic sales run on Razorpay; every non-India channel stays
// on Paddle. Nikatru is the seller of record and issues the GST invoice; Razorpay
// is the payment gateway. [ADR 004]'s seam is what makes that a file and a
// registry line rather than a rewrite.
//
// ── WHAT IS ESTABLISHED HERE, AND FROM WHERE ─────────────────────────────────
// Read 2026-09-12 from Razorpay's own documentation
// (razorpay.com/docs/webhooks/validate-test/), quoted rather than paraphrased
// because the registry's own standard is that an adapter rests on a PRIMARY
// SOURCE and never on a remembered scheme:
//
//   · "The hash signature is calculated using HMAC with SHA256 algorithm; with
//      your webhook secret set as the key and the webhook request body as the
//      message."
//   · the header is `X-Razorpay-Signature`, and the digest is written as
//      "HMAC Hex Digest": `expected_signature = hmac('sha256', message, key)`.
//   · "ensure that the webhook body passed as an argument is the raw webhook
//      request body. Do not parse or cast the webhook request body."
//   · duplicates are identified by the `x-razorpay-event-id` header, whose value
//      "is unique per event".
//
// 🔴 THREE DIFFERENCES FROM PADDLE THAT MATTER, ALL OF THEM SOURCED:
//   1. NO TIMESTAMP IS SIGNED. Paddle signs `${ts}:${body}` and this adapter's
//      sibling rejects a stale request before spending a digest. Razorpay signs
//      the body alone, so there is no timestamp to check and NO REPLAY WINDOW CAN
//      BE DERIVED FROM THE SIGNATURE. `nowMs` is therefore unused here, and that
//      is a property of the rail rather than an oversight — inventing a window
//      from a body field would be a guess wearing a check's clothes. Replay
//      defence for this rail is the store's idempotency on the event id, which is
//      where it belongs and where Razorpay's own documentation puts it.
//   2. THE DIGEST IS OVER THE BODY ALONE, so `raw` is passed through untouched.
//   3. THE EVENT ID IS A HEADER, NOT A BODY FIELD. See `parse` below.
//
// ── WHAT IS NOT ESTABLISHED, AND SO IS NOT WRITTEN ───────────────────────────
// ⚠️ `parse` REFUSES, DELIBERATELY, AND THE REGISTRY'S OWN WORDS ARE THE REASON.
// It says of a rail nobody has sourced: "Registering an adapter built on a
// guessed signature scheme would put a rail in the registry that CANNOT verify
// anything, and it would satisfy every count-based guard while doing so." The
// signature scheme IS sourced, above — the EVENT PAYLOAD SHAPES ARE NOT. The page
// that documents the signature does not document the body of
// `subscription.charged`, and no live sample exists to read.
//
// ⚠️ AND THE ACCOUNT IS NOT THE MISSING PIECE - AN EARLIER DRAFT OF THIS
// PARAGRAPH SAID IT WAS, AND WAS WRONG. Private/platform-state/identity.json records
// the Razorpay account as `plan: live, KYC complete` as of 2026-09-05, registered
// deliberately (owner, 2026-08-28) as the domestic INR gateway. The mistake was
// reading an ABSENCE OF CREDENTIALS IN THIS REPOSITORY as an absence of the account:
// no RAZORPAY_WEBHOOK_SECRET in the vault and none in the repository secrets says the
// WEBHOOK has never been configured and its secret never captured - a much smaller
// thing, and the actual gate.
//
// So what this half waits on is a webhook endpoint configured on the live account,
// its secret captured, and ONE event delivered and kept. Note also that the register
// still calls Razorpay the domestic BACKUP rather than the live rail; [ADR 076]
// changed that and the row has not caught up.
//
// The contract is explicit about which way to fail: "An adapter that guesses at a
// shape it cannot source will mis-parse silently and write a wrong row that looks
// exactly like a right one. Refusing is recoverable; a wrong grant is not." So
// this rail can prove a notification is genuinely Razorpay's and will not claim
// to know what it says. That is a real security boundary shipped early, not a
// half-finished feature: a forged body is rejected today.
//
// ⚬ AND THE EVENT ID IS WHY THE SECOND HALF CANNOT BE FINISHED BY READING DOCS.
// `parse(raw)` takes the body alone — it must, because `scheduled.ts` re-parses
// STORED payloads where no header survives. Razorpay's unique event id lives in
// `x-razorpay-event-id`, a header. So a correct `parse` needs either a body field
// that no documentation promises, or the store to keep that header beside the
// payload. That is a decision about the money boundary, and it is made with a
// real sample in hand, not from a doc page.
// ─────────────────────────────────────────────────────────────────────────────

/** Razorpay's own header, spelled as the documentation spells it. Header lookup
 *  is case-insensitive per the Fetch standard, so the casing is cosmetic. */
const SIGNATURE_HEADER = 'X-Razorpay-Signature';

/** A hex SHA-256 digest is 64 hex characters. Anything else is malformed rather
 *  than wrong — a 400, not a 401, exactly as the contract separates them. */
const HEX_SHA256 = /^[0-9a-f]{64}$/i;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time compare over the ASCII of two hex digests.
 *
 * The same shape the Paddle adapter uses, and for the same reason: a length check
 * short-circuits, so the lengths are compared first and the BYTES only when they
 * match. Neither branch reveals anything about the secret.
 */
function safeEqualHex(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a.toLowerCase());
  const bb = enc.encode(b.toLowerCase());
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}

/** HMAC-SHA256 of the RAW body under the webhook secret, hex. Exported for the
 *  tests, which compute their own vectors rather than trusting this function to
 *  grade itself. */
export async function razorpaySignature(secret: string, raw: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(raw)));
}

export const razorpayVerifier: MoRWebhookVerifier = {
  provider: 'razorpay',
  secretEnvVar: 'RAZORPAY_WEBHOOK_SECRET',

  async verify(raw: string, headers: Headers, secret: string, _nowMs: number): Promise<VerifyOutcome> {
    if (secret.length === 0) {
      return { ok: false, status: 503, reason: 'no destination secret configured' };
    }
    const header = headers.get(SIGNATURE_HEADER);
    if (header === null || header.length === 0) {
      return { ok: false, status: 401, reason: `no ${SIGNATURE_HEADER} header` };
    }
    // Bounded before any work is done on it, like the sibling rail: a header is a
    // caller-controlled string and a digest is not worth spending on nonsense.
    if (header.length > 512) {
      return { ok: false, status: 400, reason: `${SIGNATURE_HEADER} header is implausibly long` };
    }
    if (!HEX_SHA256.test(header.trim())) {
      return {
        ok: false,
        status: 400,
        reason: `${SIGNATURE_HEADER} is not a 64-character hex SHA-256 digest`,
      };
    }
    const expected = await razorpaySignature(secret, raw);
    if (!safeEqualHex(expected, header.trim())) {
      return { ok: false, status: 401, reason: 'signature does not match' };
    }
    return { ok: true };
  },

  parse(_raw: string): ParseOutcome {
    // See the header of this file. The signature scheme is sourced; the event
    // payload shapes are not, and no account exists to sample. Refusing is a 400
    // that writes nothing and lets the rail retry — the stored entitlement keeps
    // whatever it already said.
    return {
      ok: false,
      reason:
        'razorpay: the payload shape is not established from a primary source yet. The signature scheme is ' +
        '(razorpay.com/docs/webhooks/validate-test/, read 2026-09-12) and is enforced by `verify`, so a forged ' +
        'body is already refused. What is missing is a real event sample and a decision about where the event ' +
        "id comes from: Razorpay's unique id is the `x-razorpay-event-id` HEADER, and this function is also run " +
        'over STORED payloads (scheduled.ts) where no header survives. The ACCOUNT is live and KYC-complete ' +
        '(2026-09-05); what is missing is a configured webhook, its captured secret, and one delivered event.',
    };
  },
};
