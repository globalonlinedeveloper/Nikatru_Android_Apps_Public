// ─────────────────────────────────────────────────────────────────────────────
// auth.ts — THE ONE HOME OF THE AUTH DECISIONS EVERY WORKER MAKES THE SAME WAY.
//
// [pipeline B-3] "The shared server can verify an identity token at the edge and
// expose a user id." [ADR 067] decision 2: the chassis has one home, and every
// carrier re-exports or imports it instead of copying it.
//
// ── 🔴 WHAT IS HERE, AND WHY IT IS NOT THE WHOLE MIDDLEWARE ──────────────────
// `services/platform/src/middleware/auth.ts` (253 lines), `services/subscriptiontracker-api`'s
// (373) and the brick's Worker template (287) are a REAL FORK, not three copies
// of one file: platform has no HS256 fallback and exports `platformAuth`;
// subscriptiontracker-api and the template have one and export `supabaseAuth` (permissive,
// labelled) plus `erasureAuth` (asymmetric only). Collapsing that is a security
// change, not a refactor, so it is not collapsed.
//
// What WAS triplicated byte-for-byte is the DECIDING, and that is what lives
// here: the algorithm pin, the "could the key set not be obtained" predicate
// (corrected twice, both times for reasons that were security-relevant), the KV
// key and TTL, the bearer parse, and the refusal to treat an empty JWKS document
// as a usable cache. Each carrier keeps only the `jose`/`hono` plumbing that
// wires those decisions to its own context type.
//
// ⚠️ AND THAT SPLIT IS FORCED, NOT PREFERRED. Nothing in `services/_shared/src/`
// may carry a bare import. Node, tsc and esbuild all resolve a bare specifier by
// walking up from the FILE that writes it, and there is no `node_modules` at
// `services/_shared/`, at `services/`, or at the repo root — each Worker runs
// its own `npm ci` in its own directory (`ci.yml` jobs `worker-subscriptiontracker-api` and
// `worker-platform`; `pnpm-workspace.yaml` lists neither). Measured 2026-09-06
// with a probe module importing `jose`:
//     services/platform $ npx tsc --noEmit
//     ../_shared/src/_probe.ts(1,27): error TS2307: Cannot find module 'jose'
//     services/platform $ npx wrangler deploy --dry-run --outdir <scratch>
//     X [ERROR] Could not resolve "jose"  ../_shared/src/_probe.ts:1:26
// Wrangler's own suggestion there — an `alias` entry — is REFUSED: aliasing
// `jose` to `./node_modules/jose` resolves a DIRECTORY and bypasses the
// package's `exports` conditions, which is precisely how the `workerd` build of
// jose was lost once already (`vitest.config.ts`'s header records the 44 tests
// that turned red). A shared home that silently changes which build of jose is
// verified is worse than three copies of a predicate.
//
// ── 🔴 A CARRIER'S SECRET EXPOSURE IS NOW A PROPERTY OF ITS IMPORTS ──────────
// THIS FILE NAMES NO SECRET. `SUPABASE_JWT_SECRET` appears nowhere in it and
// must not: `services/platform`'s whole argument for having no fallback is that
// the secret is not in scope, and `services/subscriptiontracker-api`'s `erasureAuth` rests on
// the same property one function deeper. Both are now checkable by reading what
// each Worker's `middleware/auth.ts` imports, which is what
// `tooling/ci/assert-erasure-reach.mjs` limb 3 walks.
// ─────────────────────────────────────────────────────────────────────────────

/** The KV key both carriers cache the JWKS document under. ONE identity project
 *  portfolio-wide, so one key. */
export const JWKS_KV_KEY = 'supabase_jwks';

/**
 * @ceiling none — a CACHE LIFETIME, and the reason is that the relation is
 * INVERSE, so an `lte` comparison against `kv.writesPerDay` would be arithmetic
 * that cannot fail and would therefore overstate what is checked.
 *
 * The resource this bounds is KV WRITES, whose Free ceiling is 1,000/day
 * (`tooling/ceilings.json` → `kv.writesPerDay`) — and a LARGER TTL spends FEWER
 * of them, not more. The arithmetic, written out because it is the whole
 * justification for the value: one write per expiry gives 86400/600 = 144
 * writes/day per namespace, ~14% of the Free daily budget, shared with the
 * config namespace. Halving this constant doubles that; taking it to 60s would
 * spend 1,440/day and exhaust the account's entire KV write budget on a cache.
 *
 * It is matched by `JWKS_READING_TTL_MS` in `health.ts`, so a health reading is
 * never staler than the cache of the thing it reports on.
 */
export const JWKS_TTL_SECONDS = 600; // 10 minutes

/**
 * 🔴 THE VERIFY OPTIONS ARE DECLARED ONCE AND SHARED BY EVERY PATH, AND THAT IS
 * THE WHOLE SAFETY ARGUMENT FOR EVERY FALLBACK BUILT ON THEM.
 *
 * A fallback that accepts a token the primary path would reject is worse than
 * the outage it fixes. Writing the options twice is how the two drift — one gets
 * `algorithms` tightened and the other does not, and the weaker path is the one
 * an attacker reaches by making the JWKS endpoint unreachable. So there is
 * exactly one object, and every asymmetric `jwtVerify` call takes it. Until
 * [ADR 067] there were THREE of these objects in three files.
 *
 * `algorithms: ['ES256']` is INV-406 ("ES256 via JWKS only"): without it, a
 * token whose header says `alg: none` or a symmetric algorithm is decided by the
 * token itself — the caller choosing how they are verified.
 */
export const verifyOptions = (supabaseUrl: string) => ({
  issuer: `${supabaseUrl}/auth/v1`,
  audience: 'authenticated',
  algorithms: ['ES256'],
});

/**
 * Could the KEY SET not be obtained, as distinct from the token being bad?
 *
 * 🔴 CORRECTED, TWICE, AND THE CORRECTIONS ARE WHY THIS BELONGS IN ONE PLACE.
 * The first version of this predicate was BOTH TOO NARROW TO FIRE IN PRODUCTION
 * AND TOO WIDE TO BE SAFE, and it passed its tests either way. Both halves were
 * established by reading the INSTALLED jose dist (`dist/browser/`, the build
 * these Workers bundle), not from memory.
 *
 * TOO NARROW. It keyed on `err instanceof TypeError`, justified as "what undici
 * raises". Undici is NODE. These Workers run on workerd, and the tests run in
 * Node — so the one shape the tests exercised is the one shape production cannot
 * produce. Worse, `runtime/fetch_jwks.js` turns a NON-200 response into bare
 * `JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response")`, and a
 * non-200 is the MOST LIKELY outage shape of all: Box A is reached through a
 * Cloudflare Tunnel, and a tunnel with no origin behind it answers 502/530. So
 * the commonest real outage fell straight through this predicate and 401'd.
 *
 * 🔴 ON `services/subscriptiontracker-api` THAT MISS WAS NOT MERELY A 401. A primary failure
 * there falls through to the LEGACY HS256 SHARED SECRET, so the commonest outage
 * shape would have silently downgraded every request from a signature to a
 * shared string. Widening the predicate correctly is what closes that.
 *
 * TOO WIDE. It accepted `ERR_JWKS_NO_MATCHING_KEY` and
 * `ERR_JWKS_MULTIPLE_MATCHING_KEYS`. Those are raised by `getKey` AFTER a key
 * set has been obtained: they mean "your `kid` is not in it", which is a fact
 * about the TOKEN. Falling back to a stale cache on them is a second bite at
 * verification against an OLDER key set, so a token signed by a key that had
 * since been ROTATED OUT would have been accepted from the cache. That is a
 * security regression, not a resilience feature. Both codes are gone.
 *
 * WHAT IT KEYS ON NOW, and why each is precise rather than broad:
 *   - `ERR_JWKS_TIMEOUT` — jose's own abort timeout on the JWKS fetch.
 *   - `ERR_JOSE_GENERIC` — bare `JOSEError`. Measured: a grep for
 *     `new JOSEError(` over the whole installed browser dist returns EXACTLY TWO
 *     hits, both in `runtime/fetch_jwks.js` — the non-200 and the unparseable
 *     body. Nothing in the verification path throws it, so this is a narrow
 *     signal, not a broad one.
 *   - An error carrying NO jose `code` — it came from the runtime's `fetch`,
 *     because `fetch_jwks.js` rethrows the runtime's own rejection unwrapped.
 *     This is what makes the fallback work on workerd at all.
 *
 * ⚠️ AND IT IS STILL NOT THE "not a JWT error" NEGATIVE TEST THAT WAS RIGHTLY
 * REFUSED. Every jose error class sets a `code` in its constructor (checked
 * across all of `util/errors.js`), so a FUTURE jose class arrives WITH a code and
 * is excluded by the last clause rather than swept into the fallback. That is the
 * property the negative test could not offer.
 */
export function isKeySetUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  // No jose code at all => the runtime's fetch failed (workerd network errors,
  // undici's TypeError). Not a verification outcome.
  if (typeof code !== 'string') return true;
  if (code === 'ERR_JWKS_TIMEOUT' || code === 'ERR_JOSE_GENERIC') return true;
  // A non-jose code such as ECONNREFUSED / ENOTFOUND is still a transport
  // failure; every jose code is prefixed `ERR_`.
  return !code.startsWith('ERR_');
}

/** The `Bearer <token>` part of an Authorization header, or null. A header that
 *  is exactly `Bearer` with nothing after it does not match `(.+)` and is
 *  therefore null — the same answer as an absent header, which is the answer a
 *  caller who supplied no credential is owed. */
export const bearer = (authz: string): string | null =>
  /^Bearer\s+(.+)$/i.exec(authz)?.[1] ?? null;

/**
 * The cached JWKS document, if it is USABLE — the parse and the refusal, with no
 * `jose` in scope, so the decision lives here and only the key-set construction
 * stays in each carrier.
 *
 * 🔴 AN EMPTY KEY SET IS NOT A USABLE FALLBACK. It is exactly what a
 * misconfigured GoTrue publishes, and treating it as one would turn a
 * configuration error into a silent, permanent 401 nobody could diagnose. A
 * corrupt or unparseable cache is no cache either: fail closed, which is what
 * every carrier did before this file existed and what they still do.
 *
 * Returns the parsed document (whose `keys` array is non-empty) or `null`.
 */
export function usableJwksDocument(cached: string | null): { keys: unknown[] } | null {
  if (cached === null) return null;
  try {
    const parsed = JSON.parse(cached) as { keys?: unknown[] };
    if (!Array.isArray(parsed.keys) || parsed.keys.length === 0) return null;
    return parsed as { keys: unknown[] };
  } catch {
    return null;
  }
}
