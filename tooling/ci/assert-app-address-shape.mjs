#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-app-address-shape.mjs — an app's PUBLIC address is a PATH on the apex,
// and this guard is what makes that irreversible.
//
// ── WHY A GUARD AND NOT A NOTE ───────────────────────────────────────────────
// [ADR 075] (LOCKED) moved every app's published address from a per-app
// subdomain to a path under the one already-approved apex origin. The reason is
// not aesthetic and it is not about DNS — it is that BOTH payment rails attach
// approval to the DOMAIN:
//
//   · Paddle approves the domain(s) you may sell through, and of a subdomain
//     says "you will need to have that subdomain approved separately"; its
//     checkout overlay enforces at init AGAINST THE PAGE ORIGIN, so on a
//     subdomain an in-app checkout could not open at all.
//   · Razorpay allows one main website plus five additional ones (manual
//     review), and subdomains are not self-service at all — the vendor's answer
//     is "raise a request with our Support Team".
//
// Neither rail charges anything for a PATH or a query string. So the difference
// between the two address shapes is a vendor submission PER APP, forever,
// against zero — and a factory whose whole premise is the marginal app costing
// nothing cannot pay a review per app. [ADR 075] carries the sources.
//
// The failure mode this guards against is not somebody arguing the decision
// back. It is a NEW APP being stamped, or an existing row being hand-edited,
// with the old address shape — which is free to happen, looks completely
// normal in a diff, and is discovered when a payment rail refuses. [ADR 038]
// already locked apex checkout in 2026-08 and the subdomain shape survived in
// the catalogue for another thirteen months anyway, because nothing failed.
//
// ── THE LIMBS ────────────────────────────────────────────────────────────────
// For every row in the published catalogue:
//   1. `url` is https and its hostname is the apex host.
//   2. `url`'s pathname is "/" + the row's slug — the app's own id, so the
//      address and the identity cannot drift apart.
//   3. `listings.web` is BYTE-EQUAL to `url`. They are one fact with two
//      readers ([ADR 055]); assert-catalog-contract.mjs already holds them
//      equal, and this file holds the pair to the SHAPE as well, so neither
//      guard alone can be satisfied by moving both spellings together.
//   4. `origin` is an https origin and is NOT the apex. The app's bytes come
//      from its own deployment project; an app that claimed the apex as its
//      own origin would be a router pointed at itself.
// And across the route table the apex router reads:
//   5. SET EQUALITY, both directions — every routed path has a catalogue row
//      and every catalogue row has a route. One direction alone permits a
//      published app nothing routes (a 404 on the address we advertise) or a
//      route to nothing (bytes served under an address no catalogue admits).
//   6. Each route's `origin` equals its catalogue row's `origin`, so the thing
//      the router fetches is the thing the catalogue says it publishes.
//   7. The route path and the compiled base href are the same address written
//      two ways (`/<id>` and `/<id>/`). A Flutter web build compiled with the
//      wrong base href serves assets one directory too high and fails only in
//      the browser, which is the latest possible place to find out.
//
// ── 🔴 NO LITERAL HOSTNAME. NO LITERAL APP ID. THAT IS THE POINT ─────────────
// The apex is IMPORTED from tooling/sites/apex.mjs, the one declaration in this
// repository, and the path is composed from the row's own slug. So this guard
// contains no copy of either side of the comparison it makes: rename the app
// and both sides move together, exactly as the rename requires; move the apex
// and one edit moves every reader.
//
// That property is not left to the reader's good intentions — limb 0 below
// reads THIS FILE and fails if the imported host, or any catalogue slug,
// appears in it. A guard that hard-codes the value it checks is green on the
// day of the rename and red for a reason nobody can act on afterwards.
//
// (The word in `sites/nikatru/app-routes.json` is a DIRECTORY name, not a
// hostname. The self-check looks for the full host, which no path contains.)
//
// ── THE COVERAGE FLOOR ───────────────────────────────────────────────────────
// 🔴 Every limb above is vacuously true over an empty catalogue, and limb 0's
// slug sweep is vacuously true over one too. So zero rows REFUSES, and it
// refuses as COVERAGE LOST (exit 2) rather than as a finding, because "there
// are no apps" is a statement about this guard's subject having disappeared,
// not about an app being wrong. Same for the apex module failing to import —
// with no apex there is nothing to compare a hostname to and limbs 1 and 4
// would both pass on anything — and same for the route table being absent,
// which would leave limbs 5, 6 and 7 checking a set against nothing.
//
// ⚠️ AND THE FLOOR FIRES ON HAVING NO SUBJECT, NEVER ON THE SUBJECT BEING BAD.
// This file's first version counted the addresses that PASSED and refused at
// zero, so a one-app catalogue whose single address was wrong came out as
// COVERAGE LOST with the finding swallowed — the guard announcing it had
// checked nothing at the precise moment it had found the thing it exists to
// find. Caught by the real-tree mutation in test/app-address-shape.test.mjs,
// not by reading. The counters are separate now; see them where they are
// declared.
//
// Usage:  node tooling/ci/assert-app-address-shape.mjs [repoRoot]
// Exit:   0 = every published address is a path on the apex, and the route
//             table and the catalogue are the same set
//         1 = a finding — an address, a listing, an origin or a route is wrong
//         2 = COVERAGE LOST — no catalogue, no rows, no apex, no route table
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSourceComments, codeMask, NON_CODE } from './text-reductions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv[2] ?? join(HERE, '..', '..'));

const CATALOGUE = 'catalog/apps.json';
const ROUTES = 'sites/nikatru/app-routes.json';
const APEX = 'tooling/sites/apex.mjs';

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);

/** COVERAGE LOST exits IMMEDIATELY and with its own code. It is not a finding
 *  in a list: a finding says "this row is wrong", coverage loss says "I did not
 *  check enough for anything I print to be evidence", and collapsing the two
 *  into exit 1 is how a guard's refusal gets read as a bug in the tree. */
function coverageLost(lines) {
  console.error('✗ COVERAGE LOST — assert-app-address-shape checked nothing it exists to check:');
  for (const l of lines) console.error(`  · ${l}`);
  process.exit(2);
}

function read(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function done() {
  for (const n of notes) console.log(`  ok  ${n}`);
  if (problems.length) {
    console.error(`\n✗ assert-app-address-shape: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  · ${p}`);
    console.error(
      '\n  [ADR 075]: an app is published at a PATH on the apex. The subdomain survives as an internal\n' +
        '  origin and as the source of a permanent 301 — it is never the published address, because both\n' +
        '  payment rails approve a DOMAIN and neither charges anything for a path.',
    );
    process.exit(1);
  }
  console.log('✓ assert-app-address-shape: every app is published at a path on the apex.');
  process.exit(0);
}

// ── COVERAGE, BEFORE ANY CLAIM ───────────────────────────────────────────────
const rawCatalogue = read(CATALOGUE);
if (rawCatalogue === null) {
  coverageLost([
    `there is no catalogue at ${CATALOGUE}.`,
    'It is the published record of every address this factory advertises. Absent is not "nothing to',
    'check": every limb below iterates it, so all of them would pass in silence.',
  ]);
}

let catalogue;
try {
  catalogue = JSON.parse(rawCatalogue);
} catch (e) {
  coverageLost([
    `${CATALOGUE} is not valid JSON (${e.message}).`,
    'An unparseable catalogue yields no rows, and no rows is no coverage — reporting a clean address',
    'shape over a file nothing can read would be the vacuous pass this floor exists to refuse.',
  ]);
}

if (!Array.isArray(catalogue) || catalogue.length === 0) {
  coverageLost([
    `${CATALOGUE} holds ${Array.isArray(catalogue) ? '0 rows' : `a ${catalogue === null ? 'null' : typeof catalogue}, not an array`}.`,
    'Every assertion in this file ranges over the catalogue rows. With none, all of them are vacuously',
    'true — the guard would print ok while the factory advertised nothing at all.',
  ]);
}

// The apex is IMPORTED, never retyped. Without it there is no host to compare a
// published address to, and limbs 1 and 4 would accept any hostname on earth.
let APEX_ORIGIN;
let APEX_HOST;
let publicAppUrl;
let appBaseHref;
try {
  ({ APEX_ORIGIN, APEX_HOST, publicAppUrl, appBaseHref } = await import('../sites/apex.mjs'));
} catch (e) {
  coverageLost([
    `${APEX} could not be imported (${e.message}).`,
    'It is the ONE declaration of the apex in this repository. This guard deliberately holds no copy of',
    'it, so without the import there is no expected value and every address limb below would compare a',
    'hostname against undefined and pass.',
  ]);
}
if (typeof APEX_HOST !== 'string' || APEX_HOST === '' || typeof publicAppUrl !== 'function' || typeof appBaseHref !== 'function') {
  coverageLost([
    `${APEX} imported but did not export the apex declaration this guard reads`,
    '(APEX_ORIGIN, APEX_HOST, publicAppUrl, appBaseHref).',
    'A partial import is worse than a missing one: the limbs still run, against nothing.',
  ]);
}

// The route table the apex router reads. Absent, limbs 5-7 compare the
// catalogue against an empty set — which is a finding-shaped answer produced by
// having no subject, not by anything being wrong.
const rawRoutes = read(ROUTES);
if (rawRoutes === null) {
  coverageLost([
    `there is no route table at ${ROUTES}.`,
    'It is what the apex router reads to know which path serves which origin. Without it the set-equality',
    'limb has one side only, and "every route has a row" is vacuously true of no routes — so an app could',
    'be published at an address nothing serves and this guard would say so with a tick.',
  ]);
}

let routes;
try {
  routes = JSON.parse(rawRoutes);
} catch (e) {
  coverageLost([`${ROUTES} is not valid JSON (${e.message}), so the set of served paths cannot be derived at all.`]);
}
if (!Array.isArray(routes) || routes.length === 0) {
  coverageLost([
    `${ROUTES} holds ${Array.isArray(routes) ? '0 routes' : `a ${routes === null ? 'null' : typeof routes}, not an array`}.`,
    'The router serves nothing, so no published address resolves — and the set-equality limb below would',
    'report the catalogue as entirely unrouted, which is a finding about the tree rather than about a row.',
  ]);
}

// ── LIMB 0 · THIS FILE CARRIES NO COPY OF WHAT IT CHECKS ─────────────────────
// The rename is the whole reason [ADR 075] can be enforced at all: the address
// and the id move together because BOTH sides are derived. A literal here would
// silently make that false.
//
// The two sweeps deliberately differ in what they read, and the difference is
// the difference between an assertion that can only red on a real defect and
// one people delete.
//
//   · The HOST is looked for in the RAW bytes, comments included. There is no
//     legitimate reason to write it in this file at all, and a hostname in a
//     comment is how the next reader learns to type one in code.
//   · A SLUG is looked for ONLY WHERE IT WOULD BE HARD-CODED — inside a string
//     or template literal, after comments are blanked. A slug is an ordinary
//     lowercase word: an app id of "url", "path" or "origin" would match every
//     identifier in this file under a plain text search, and a guard that reds
//     on correct code gets switched off rather than obeyed. The literal
//     context comes from `codeMask`, the one implementation of "which bytes are
//     code" in this repository, so a fixture in backticks cannot walk past it
//     the way a quote-only oracle let one walk past assert-guards-refuse-empty.
//
// ⚠️ THE RESIDUAL RISK, STATED RATHER THAN HIDDEN: an app id that is also an
// ordinary word appearing in one of THIS FILE'S OWN MESSAGE STRINGS — an app
// literally called "origin" or "web" — reds here without anything being wrong.
// The fix when that day comes is to reword the message, which is this file's
// own prose and free to change; it is NOT to delete the limb, and it is not to
// hard-code the id the limb exists to keep out. The exposure is bounded because
// the literals it searches are all written here.
const selfSource = readFileSync(fileURLToPath(import.meta.url), 'utf8');
if (selfSource.includes(APEX_HOST)) {
  fail(
    `this guard's own source contains the apex host it imported from ${APEX}. The import exists so that ` +
      `the expected value is declared once; a literal copy here is a second declaration, and it is the ` +
      `one that survives a change to the first.`,
  );
}
/** Comments blanked to spaces (offsets preserved), then masked: what is left
 *  marked NON_CODE is a string or template literal and nothing else. */
const selfCode = stripSourceComments(selfSource, '.mjs');
const selfMask = codeMask(selfCode);
for (const row of catalogue) {
  const slug = row?.slug;
  if (typeof slug !== 'string' || slug === '') continue;
  /** Token boundaries, so that an id of "web" is not found inside the word
   *  "website". They are ASCII-class rather than `\b` because an id may carry
   *  `_` and a neighbouring `-` is a real boundary in a URL. */
  const token = new RegExp(`(?:^|[^a-z0-9_-])(${slug})(?:[^a-z0-9_-]|$)`, 'g');
  for (let m = token.exec(selfCode); m !== null; m = token.exec(selfCode)) {
    const i = m.index + m[0].indexOf(slug);
    if (selfMask[i] !== NON_CODE) continue; // an identifier that happens to spell the id
    fail(
      `this guard's own source hard-codes the app id "${slug}" in a string literal at offset ${i}. Every ` +
        `address here is composed from the row's own slug precisely so that a rename moves BOTH sides of ` +
        `the comparison at once; a literal id pins one side to a name the app may no longer have, and the ` +
        `guard stays green while doing it.`,
    );
    break;
  }
}

// ── LIMBS 1-4 · THE PUBLISHED ADDRESS OF EVERY ROW ───────────────────────────
/** slug -> origin, for the route limbs. Only rows whose address survived limbs
 *  1-2 are entered: a row whose address is already wrong would otherwise be
 *  reported a second time as "unrouted", which reads like two defects. */
const byPath = new Map();
/** 🔴 TWO COUNTERS, BECAUSE THERE ARE TWO QUESTIONS, and collapsing them into
 *  one is a bug this file HAD. `addressesRead` answers "did I get to compare
 *  anything?" — the coverage question. `addressesHeld` answers "how many
 *  compared clean?" — a result. The first version's floor fired on
 *  `addressesHeld === 0`, so a one-app catalogue whose single address was WRONG
 *  came out as COVERAGE LOST (exit 2) with the finding swallowed: the guard
 *  reported that it had checked nothing at the exact moment it had found the
 *  defect it exists to find. A floor must fire on having no SUBJECT, never on
 *  the subject being bad. */
let addressesRead = 0;
let addressesHeld = 0;

catalogue.forEach((row, i) => {
  const at = `${CATALOGUE}[${i}]`;
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    fail(`${at} is not an object, so it declares no address at all.`);
    return;
  }
  const slug = row.slug;
  if (typeof slug !== 'string' || slug === '') {
    fail(`${at} has no usable \`slug\`. The published path IS the slug, so a row without one has no address this guard can derive.`);
    return;
  }
  const label = `${at} ("${slug}")`;

  if (typeof row.url !== 'string' || row.url === '') {
    fail(`${label} has no \`url\`. It is the address every card, canonical tag and store listing points at.`);
    return;
  }

  let parsed;
  try {
    parsed = new URL(row.url);
  } catch {
    fail(`${label} has a \`url\` of ${JSON.stringify(row.url)}, which is not a URL at all.`);
    return;
  }

  addressesRead += 1;
  const expected = publicAppUrl(slug);
  let addressOk = true;

  // 1 · the host is the apex, and nothing else — and the scheme is https.
  // The scheme is checked here rather than left to the reachability guard
  // because `publicAppUrl` composes one and this is where the composed value is
  // the expected answer; an http address on the right host and path would
  // otherwise satisfy every limb below while being a downgrade a stranger
  // follows.
  if (parsed.protocol !== 'https:') {
    addressOk = false;
    fail(
      `${label} is published over "${parsed.protocol}", not https. Expected ${JSON.stringify(expected)} — ` +
        `this address is what stores, ads and canonical tags point at.`,
    );
  }
  if (parsed.hostname !== APEX_HOST) {
    addressOk = false;
    fail(
      `${label} is published at host "${parsed.hostname}", not the apex. [ADR 075]: an app's public address ` +
        `is a PATH on the apex — a per-app host costs a payment-rail submission per app on both rails and ` +
        `buys nothing, and Paddle's overlay enforces against the PAGE ORIGIN, so in-app checkout could not ` +
        `open there at all. Expected ${JSON.stringify(expected)}.`,
    );
  }

  // 2 · the path is the id. Composed, never typed.
  if (parsed.pathname !== `/${slug}`) {
    addressOk = false;
    fail(
      `${label} is published at path ${JSON.stringify(parsed.pathname)}, but its slug is "${slug}". The ` +
        `address and the identity are one fact: the router keys on the path, the build is compiled with ` +
        `${JSON.stringify(appBaseHref(slug))}, and a path that is not the id makes a rename impossible to ` +
        `carry out atomically. Expected ${JSON.stringify(expected)}.`,
    );
  }

  // 3 · `listings.web` and `url` are one fact with two readers.
  const listings = row.listings;
  if (listings !== null && typeof listings === 'object' && !Array.isArray(listings) && Object.hasOwn(listings, 'web')) {
    if (listings.web !== null && listings.web !== row.url) {
      fail(
        `${label} has \`listings.web\` = ${JSON.stringify(listings.web)} but \`url\` = ${JSON.stringify(row.url)}. ` +
          `They are the same fact ([ADR 055]) and each has readers that never see the other, so a subdomain ` +
          `left in one of them is an address this factory still advertises.`,
      );
    }
  }

  // 4 · the bytes come from the app's own project, never from the apex.
  if (typeof row.origin !== 'string' || row.origin === '') {
    fail(
      `${label} has no \`origin\`. Since [ADR 075] the apex router proxies each path to the app's own ` +
        `deployment project, and the origin is where it fetches; a row without one is an address with ` +
        `nothing behind it.`,
    );
  } else {
    let originUrl;
    try {
      originUrl = new URL(row.origin);
    } catch {
      originUrl = null;
    }
    if (originUrl === null || originUrl.protocol !== 'https:') {
      fail(`${label} has an \`origin\` of ${JSON.stringify(row.origin)}, which is not an https:// origin.`);
    } else if (originUrl.hostname === APEX_HOST) {
      fail(
        `${label} declares the APEX as its own \`origin\`. The router fetches this host to serve the app's ` +
          `path, so an app whose origin is the apex is a router pointed at itself — the loop takes the whole ` +
          `apex dark, the marketing site and the frozen legal archive with it.`,
      );
    } else if (originUrl.origin !== `${originUrl.protocol}//${originUrl.host}` || originUrl.pathname !== '/') {
      fail(
        `${label} has an \`origin\` of ${JSON.stringify(row.origin)}, which carries a path. It is an ORIGIN ` +
          `the router prefixes with the request path; anything after the host is silently dropped or doubled.`,
      );
    }
  }

  if (addressOk) {
    addressesHeld += 1;
    if (byPath.has(parsed.pathname)) {
      fail(`${label} publishes the path ${JSON.stringify(parsed.pathname)}, which ${CATALOGUE} already used. Two apps cannot share one address.`);
    } else {
      byPath.set(parsed.pathname, { slug, origin: typeof row.origin === 'string' ? row.origin : null, at });
    }
  }
});

// ── LIMBS 5-7 · THE ROUTE TABLE AND THE CATALOGUE ARE THE SAME SET ───────────
const routed = new Map();
routes.forEach((route, i) => {
  const at = `${ROUTES}[${i}]`;
  if (route === null || typeof route !== 'object' || Array.isArray(route)) {
    fail(`${at} is not an object; every route is \`{ path, origin }\`.`);
    return;
  }
  if (typeof route.path !== 'string' || !route.path.startsWith('/')) {
    fail(`${at} has a \`path\` of ${JSON.stringify(route.path)}, which is not an absolute path.`);
    return;
  }
  if (routed.has(route.path)) {
    fail(`${at} repeats the path ${JSON.stringify(route.path)}. Whichever entry the router reads second is dead configuration nobody can see.`);
    return;
  }
  routed.set(route.path, { origin: route.origin, at });
});

// 5 · both directions. Either alone permits half the defect.
for (const [path, row] of byPath) {
  if (!routed.has(path)) {
    fail(
      `${row.at} publishes ${JSON.stringify(path)} but ${ROUTES} carries no route for it. The catalogue is ` +
        `what the website, the sitemap and every store listing point at, so an unrouted row is a 404 at an ` +
        `address a stranger was given.`,
    );
  }
}
for (const [path, route] of routed) {
  if (!byPath.has(path)) {
    fail(
      `${route.at} routes ${JSON.stringify(path)} but no row in ${CATALOGUE} publishes that address. The ` +
        `router would serve an app the catalogue does not admit exists — unlisted, uncrawled, and outside ` +
        `every guard that ranges over the catalogue.`,
    );
  }
}

// 6 · one origin, agreed by both files.
for (const [path, row] of byPath) {
  const route = routed.get(path);
  if (route === undefined) continue;
  if (route.origin !== row.origin) {
    fail(
      `${route.at} routes ${JSON.stringify(path)} to ${JSON.stringify(route.origin)} while ${row.at} declares ` +
        `\`origin\` ${JSON.stringify(row.origin)}. The catalogue names where the bytes come from and the ` +
        `router fetches them; two answers means one of the two is describing an app nobody is serving.`,
    );
  }
}

// 7 · the routed path and the compiled base href are one address, two spellings.
for (const [path, row] of byPath) {
  if (!routed.has(path)) continue;
  if (appBaseHref(row.slug) !== `${path}/`) {
    fail(
      `route ${JSON.stringify(path)} and the base href ${JSON.stringify(appBaseHref(row.slug))} the build is ` +
        `compiled with are not the same address. A web build compiled with the wrong base href resolves ` +
        `every asset one directory too high and fails only in a browser.`,
    );
  }
}

// ── THE SELF-CHECK A SHRINK CANNOT HIDE IN ───────────────────────────────────
if (addressesRead === 0) {
  coverageLost([
    `${catalogue.length} catalogue row(s) were read and not one carried a \`url\` this guard could parse.`,
    'Every limb here compares a published address, so with none parsed all of them are vacuously true —',
    'which is indistinguishable from a clean run. This fires on having no SUBJECT; an address that parsed',
    'and was WRONG is a finding (exit 1) and is reported as one, never as coverage loss.',
  ]);
}

console.log(`published addresses — ${catalogue.length} row(s) in ${CATALOGUE}, ${routes.length} route(s) in ${ROUTES}:`);
for (const [path, row] of byPath) {
  console.log(`      ${row.slug}  ${APEX_ORIGIN.replace(/\/$/, '')}${path}  ←  ${row.origin ?? '(no origin)'}`);
}
notes.push(`apex imported from ${APEX}; no hostname and no app id is written in this file`);
notes.push(
  `${addressesRead} of ${catalogue.length} row(s) yielded an address to check; ${addressesHeld} held to the ` +
    `apex-path shape, against ${routed.size} route(s)`,
);

done();
