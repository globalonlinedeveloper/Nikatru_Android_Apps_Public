// ─────────────────────────────────────────────────────────────────────────────
// app-address-shape.test.mjs — assert-app-address-shape.mjs must be able to FAIL,
// and must fail with the RIGHT EXIT CODE.
//
// The guard holds [ADR 075]: an app's public address is a PATH on the apex, and
// the subdomain survives only as an internal origin and a 301. The only thing
// worth testing is the set of inputs it must refuse — a guard exercised solely
// against the real repository has only ever seen valid input, which is by
// definition valid ([pipeline F-10]).
//
// ⚠️ REAL-TREE NEGATIVE TESTS FIRST, THEN FIXTURES. Every case below was first
// produced by MUTATING THE ACTUAL working tree and running the guard, then
// restoring the file and re-checking its hash against the pin
// 4323d1c7046df0f0a78b95bb932bab49cea68b24 (catalog/apps.json, 1 row, 2026-09-09).
// A fixture the test author wrote encodes the same misunderstanding as the guard
// the test author wrote; only breaking the real tree proves the guard reaches
// the real tree. Results, each exit code captured on its own line:
//   R1  url + listings.web → the subdomain shape   -> exit 1, named the host,
//                                                     the path, and the now-
//                                                     unrouted route row
//   R2  the catalogue emptied to `[]`              -> exit 2 COVERAGE LOST
//   R3  sites/nikatru/app-routes.json moved aside  -> exit 2 COVERAGE LOST
//   R4  `listings.web` ALONE drifted to the subdomain
//                                                  -> exit 1, named both spellings
//   R5  `origin` set to the apex                   -> exit 1, "router pointed at itself"
// Restored after each: sha1 back to the pin, `git status --porcelain` empty for
// that path, guard exit 0.
//
// 🔴 R1 IS THE CASE THAT PAID FOR ITSELF. Against the FIRST version of the guard
// it came out as exit 2, not 1: that version's coverage floor counted the
// addresses that PASSED and refused at zero, so a one-row catalogue whose single
// address was wrong reported COVERAGE LOST and swallowed all three findings —
// the guard announcing it had checked nothing at the exact moment it had found
// the defect it exists to find. Nothing in a fixture suite would have shown
// that, because a fixture suite naturally carries several rows. The counters are
// separate now (`addressesRead` vs `addressesHeld`) and case R1 below is the
// permanent record of why.
//
// 🔴 THE POSITIVE CONTROL IS NOT OPTIONAL. Without a case that runs the guard
// against the REAL repository and demands exit 0, every negative result here is
// equally consistent with a guard that refuses everything it is ever shown.
//
// ── WHY NOTHING IN THIS FILE SPELLS THE APEX OR AN APP ID ────────────────────
// The guard's headline property is that it carries neither literal, so that
// [ADR 074]'s pending id rename moves both sides of every comparison at once. A
// test that typed the host would be the second declaration the guard refuses to
// be, and it would go red on the rename for a reason that has nothing to do with
// what it tests. Fixtures compose their addresses with `publicAppUrl`, imported
// from the same one declaration the guard imports.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { APEX_ORIGIN, APEX_HOST, publicAppUrl, appBaseHref } from '../../sites/apex.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-app-address-shape.mjs');

/** The two files the guard reads, spelled once. */
const CATALOGUE_REL = join('catalog', 'apps.json');
const ROUTES_REL = join('sites', 'nikatru', 'app-routes.json');

let TMP;
let seq = 0;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-app-address-shape-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const run = (root, guard = GUARD) => {
  const r = spawnSync(process.execPath, [guard, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

/** A valid app, composed the way the repository composes one. Every case below
 *  breaks exactly ONE thing about it: a fixture that differs from a good row in
 *  several ways cannot tell you which difference the guard reacted to. */
const APP = (slug) => ({
  slug,
  name: `A ${slug}`,
  tagline: 'x',
  url: publicAppUrl(slug),
  origin: `https://${slug}-fixture.pages.dev`,
  api: '',
  listings: { web: publicAppUrl(slug), play: null },
  platforms: ['web'],
  status: 'live',
});

const ROUTE = (row) => ({ path: new URL(row.url).pathname, origin: row.origin });

/** Builds a root the guard can be pointed at. `catalogue`/`routes` accept a
 *  string to write raw bytes (for the unparseable cases) and `null` to leave the
 *  file out entirely. */
function makeRoot({ catalogue = [APP('alpha')], routes = undefined } = {}) {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, 'catalog'), { recursive: true });
  mkdirSync(join(root, 'sites', 'nikatru'), { recursive: true });
  const rows = Array.isArray(catalogue) ? catalogue : catalogue;
  if (catalogue !== null) {
    writeFileSync(join(root, CATALOGUE_REL), typeof rows === 'string' ? rows : JSON.stringify(rows, null, 2));
  }
  const table = routes === undefined && Array.isArray(catalogue) ? catalogue.map(ROUTE) : routes;
  if (table !== null && table !== undefined) {
    writeFileSync(join(root, ROUTES_REL), typeof table === 'string' ? table : JSON.stringify(table, null, 2));
  }
  return root;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the positive control', () => {
  test('the REAL repository passes — without this, every red below is worthless', () => {
    const r = run(REPO);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /every app is published at a path on the apex/);
  });

  test('a clean fixture passes, so the fixture builder is not the thing failing', () => {
    const r = run(makeRoot());
    assert.equal(r.code, 0, r.out);
  });

  test('two apps pass — the set-equality limb is not satisfied only by having one row', () => {
    const rows = [APP('alpha'), APP('beta')];
    const r = run(makeRoot({ catalogue: rows }));
    assert.equal(r.code, 0, r.out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('COVERAGE LOST is exit 2, and is never a pass', () => {
  test('no catalogue at all', () => {
    const r = run(makeRoot({ catalogue: null }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /there is no catalogue/);
  });

  test('an EMPTY catalogue — every limb is vacuously true over no rows', () => {
    const r = run(makeRoot({ catalogue: [] }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /holds 0 rows/);
  });

  test('an unparseable catalogue', () => {
    const r = run(makeRoot({ catalogue: '{not json' }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /not valid JSON/);
  });

  test('a catalogue that is an object, not an array', () => {
    const r = run(makeRoot({ catalogue: '{"apps": []}' }));
    assert.equal(r.code, 2, r.out);
  });

  test('no route table', () => {
    const r = run(makeRoot({ routes: null }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /there is no route table/);
  });

  test('an EMPTY route table — "every route has a row" is vacuously true of no routes', () => {
    const r = run(makeRoot({ routes: [] }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /holds 0 routes/);
  });

  test('an unparseable route table', () => {
    const r = run(makeRoot({ routes: 'nope' }));
    assert.equal(r.code, 2, r.out);
  });

  test('every row carries a url that is not a URL — no address was ever compared', () => {
    const row = { ...APP('alpha'), url: 'not a url' };
    const r = run(makeRoot({ catalogue: [row], routes: [{ path: '/alpha', origin: row.origin }] }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /not one carried a `url` this guard could parse/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a wrong address is a FINDING (exit 1), never coverage loss', () => {
  // 🔴 R1's regression case. See the header.
  test('a ONE-ROW catalogue published on a subdomain reds as 1, not 2', () => {
    const row = { ...APP('alpha') };
    row.url = `https://alpha.${APEX_HOST}`;
    row.listings = { ...row.listings, web: row.url };
    const r = run(makeRoot({ catalogue: [row], routes: [{ path: '/alpha', origin: row.origin }] }));
    assert.equal(r.code, 1, r.out);
    assert.doesNotMatch(r.out, /COVERAGE LOST/);
    assert.match(r.out, /not the apex/);
  });

  test('the apex host with the wrong path', () => {
    const row = { ...APP('alpha'), url: `${APEX_ORIGIN}elsewhere` };
    row.listings = { ...row.listings, web: row.url };
    const r = run(makeRoot({ catalogue: [row], routes: [{ path: '/elsewhere', origin: row.origin }] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /but its slug is/);
  });

  test('http, not https, on the apex host', () => {
    const row = { ...APP('alpha'), url: publicAppUrl('alpha').replace('https:', 'http:') };
    row.listings = { ...row.listings, web: row.url };
    const r = run(makeRoot({ catalogue: [row] }));
    assert.equal(r.code, 1, r.out);
  });

  test('`listings.web` drifted away from `url` — one fact, two readers', () => {
    const row = APP('alpha');
    row.listings = { ...row.listings, web: `https://alpha.${APEX_HOST}` };
    const r = run(makeRoot({ catalogue: [row] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /listings\.web/);
  });

  test('a row with no `origin` — an address with nothing behind it', () => {
    const row = APP('alpha');
    delete row.origin;
    const r = run(makeRoot({ catalogue: [row], routes: [{ path: '/alpha', origin: undefined }] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /has no `origin`/);
  });

  test('`origin` IS the apex — a router pointed at itself', () => {
    const row = { ...APP('alpha'), origin: APEX_ORIGIN.replace(/\/$/, '') };
    const r = run(makeRoot({ catalogue: [row], routes: [ROUTE(row)] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /router pointed at itself/);
  });

  test('`origin` is not https', () => {
    const row = { ...APP('alpha'), origin: 'http://alpha-fixture.pages.dev' };
    const r = run(makeRoot({ catalogue: [row], routes: [ROUTE(row)] }));
    assert.equal(r.code, 1, r.out);
  });

  test('`origin` carries a path — the router prefixes it with the request path', () => {
    const row = { ...APP('alpha'), origin: 'https://alpha-fixture.pages.dev/build' };
    const r = run(makeRoot({ catalogue: [row], routes: [ROUTE(row)] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /which carries a path/);
  });

  test('two rows publishing one address', () => {
    // The address is COMPOSED from the slug, so the only way two rows can reach
    // one address is by sharing a slug — which is exactly the hand-edit this
    // limb is for. A fixture that instead copied one row's `url` onto another
    // slug reds on limb 2 first and never reaches here; that fixture was
    // written, and it is the reason this comment exists.
    const a = APP('alpha');
    const b = { ...APP('alpha'), name: 'A second alpha' };
    const r = run(makeRoot({ catalogue: [a, b], routes: [ROUTE(a)] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /already used/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the catalogue and the route table are ONE SET, checked both ways', () => {
  test('a published app nothing routes — a 404 at an address a stranger was given', () => {
    const rows = [APP('alpha'), APP('beta')];
    const r = run(makeRoot({ catalogue: rows, routes: [ROUTE(rows[0])] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /carries no route for it/);
  });

  test('a route to an app no catalogue row admits exists', () => {
    const rows = [APP('alpha')];
    const r = run(makeRoot({ catalogue: rows, routes: [ROUTE(rows[0]), { path: '/ghost', origin: 'https://ghost.pages.dev' }] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no row in .* publishes that address/);
  });

  test('the two files disagree about the origin', () => {
    const row = APP('alpha');
    const r = run(makeRoot({ catalogue: [row], routes: [{ path: '/alpha', origin: 'https://somewhere-else.pages.dev' }] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /while .* declares/);
  });

  test('a duplicated route — whichever the router reads second is dead configuration', () => {
    const row = APP('alpha');
    const r = run(makeRoot({ catalogue: [row], routes: [ROUTE(row), ROUTE(row)] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /repeats the path/);
  });

  test('a route with no leading slash', () => {
    const row = APP('alpha');
    const r = run(makeRoot({ catalogue: [row], routes: [{ path: 'alpha', origin: row.origin }] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /not an absolute path/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE LIMB THAT KEEPS THE RENAME SAFE. The guard reads its OWN source and
// fails if the apex host, or an app id, is written into it. Testing that needs a
// guard whose source differs, so a COPY is built in a temp tree beside copies of
// the two modules it imports — never inside tooling/ci, where a stray .mjs is a
// guard escaping every count taken over that directory.
describe('the guard refuses to hard-code what it checks', () => {
  let home;
  let copy;

  before(() => {
    home = join(TMP, 'selfcheck');
    mkdirSync(join(home, 'tooling', 'ci'), { recursive: true });
    mkdirSync(join(home, 'tooling', 'sites'), { recursive: true });
    for (const [from, to] of [
      [join(CI_DIR, 'text-reductions.mjs'), join(home, 'tooling', 'ci', 'text-reductions.mjs')],
      [join(REPO, 'tooling', 'sites', 'apex.mjs'), join(home, 'tooling', 'sites', 'apex.mjs')],
    ]) {
      writeFileSync(to, readFileSync(from, 'utf8'));
    }
    copy = join(home, 'tooling', 'ci', 'copy.mjs');
  });

  /** Appends a line to the copy. Appended, so no executed statement changes —
   *  the ONLY difference between a green copy and a red one is bytes the
   *  self-check reads. */
  const withTail = (tail) => {
    writeFileSync(copy, readFileSync(GUARD, 'utf8') + tail);
    return copy;
  };

  test('the unmodified copy is green — the copy itself is not what reds', () => {
    const r = run(makeRoot(), withTail(''));
    assert.equal(r.code, 0, r.out);
  });

  test('the apex host written into its CODE', () => {
    const r = run(makeRoot(), withTail(`\nconst pinned = '${APEX_HOST}';\n`));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /contains the apex host it imported/);
  });

  test('the apex host written into a COMMENT — prose is how the next reader learns to type one', () => {
    const r = run(makeRoot(), withTail(`\n// see ${APEX_HOST}\n`));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /contains the apex host it imported/);
  });

  test('an app id hard-coded in a string literal', () => {
    const r = run(makeRoot(), withTail(`\nconst pinned = 'alpha';\n`));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /hard-codes the app id "alpha"/);
  });

  test('an app id hard-coded in a TEMPLATE literal — a quote-only oracle walks past this', () => {
    const r = run(makeRoot(), withTail('\nconst pinned = `alpha`;\n'));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /hard-codes the app id "alpha"/);
  });

  test('an IDENTIFIER that spells an app id does NOT red — the limb reads literals, not words', () => {
    // `routed` is a real variable in the guard and appears nowhere in its
    // message strings. An assertion that reds on correct code is one people
    // delete rather than obey, so this case is what keeps the limb honest.
    const row = { ...APP('routed') };
    const r = run(makeRoot({ catalogue: [row], routes: [ROUTE(row)] }), withTail(''));
    assert.equal(r.code, 0, r.out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the base href and the route are one address in two spellings', () => {
  test('appBaseHref is what the route path plus a slash must be', () => {
    // Not a mutation of the guard: a statement about the imported declaration,
    // which is the pair the guard's limb 7 compares. If these two ever stop
    // being the same address, limb 7 is the thing that reds and this case says
    // what it means.
    for (const slug of ['alpha', 'beta']) {
      assert.equal(appBaseHref(slug), `${new URL(publicAppUrl(slug)).pathname}/`);
    }
  });
});
