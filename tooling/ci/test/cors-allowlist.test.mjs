// ─────────────────────────────────────────────────────────────────────────────
// cors-allowlist.test.mjs — assert-cors-allowlist.mjs must be able to FAIL.
//
// [4]B-2 (CORS half) + [3]S-11. The Worker allowlists are DERIVED from
// catalog/apps.json; nothing about a new app's origin may depend on
// a human remembering to edit a comma-separated string in two wrangler configs.
//
// ⚠️ REAL-TREE NEGATIVE TESTS FIRST (2026-08-07, three, against the live repo —
// a fixture you wrote encodes the same misunderstanding as the guard you wrote):
//   N1 a second live app added to the REAL apps.json (drift.nikatru.com), nothing
//      else changed
//        · against the PREVIOUS guard -> BYTE-IDENTICAL output, exit 0. That is
//          the defect: the origins were a hardcoded POLICY literal inside the
//          guard, i.e. still a hand-edited list, merely relocated.
//        · against THIS guard -> exit 1, naming https://drift.nikatru.com.
//   N2 `https://evil.example.com` appended to the REAL services/subscriptiontracker-api
//      ALLOWED_ORIGINS -> exit 1, "NOTHING justifies it".
//   N3 the REAL apps.json emptied to `[]` -> COVERAGE LOST, exit 1.
//   Each mutation was reverted with `git checkout --` and proven byte-identical
//   by `git hash-object` (4c5f555b… for apps.json, b3d38665… for subscriptiontracker-api).
//   `node --check` passes on the guard, so every catch above is an assertion
//   firing and not a parse error.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 [ADR 075] — WHAT THIS FILE LOST, AND WHY THE LOSS IS RECORDED HERE RATHER
// THAN QUIETLY EDITED AWAY.
//
// Every app moved from `<id>.nikatru.com` to a PATH on the apex: a catalogue row's
// `url` is now `https://nikatru.com/<slug>`, so EVERY app derives THE SAME browser
// origin. N1 above — the founding negative test of this whole file — can no longer
// be written. A second app's origin is the string the first app already
// contributes, so "missing from the shared Worker" has no input that reds it.
//
// That is not a fixture problem. It is the real consequence the design recorded in
// advance: **CORS stopped being a per-app boundary the day app #2 shipped.** An
// exact allowlist can still say "a browser, at nikatru.com"; it can no longer say
// WHICH app's tab is calling. Two cases below therefore assert something that
// CANNOT HAPPEN, and this repo's rule is that an assertion which cannot fail is
// worse than none. Both were rewritten in place — each carries a comment naming
// what it used to assert and why that became untestable — onto the two properties
// that ARE still falsifiable:
//   · N apps yield exactly ONE derived origin, and a Worker missing THAT origin
//     is still red (the floor survived; only its per-app resolution died);
//   · a per-app Worker without `vars.APP_ID` is red — the token+APP_ID pair is the
//     boundary that REPLACED the per-app origin, and the guard asserts it in the
//     same block as the assertion it replaces.
// And one case was ADDED for the limb that makes the reversal itself reviewable:
// a catalogue row back on a subdomain must go red and name the apex.
//
// ⏱ THE RETIRING SUBDOMAIN HAS NOW LEFT, 2026-09-09. It was deliberately listed in
// both live configs and justified in the guard's EXTRAS for the length of the
// cutover; the note here said "it leaves with the 301". The 301 landed -- measured:
// subly.nikatru.com/, /x, /version.json and a deep path with a query all 301 in one
// hop to a 200 on nikatru.com/subscriptiontracker/ -- so nothing is served there and no browser
// sends that Origin. Config and EXTRAS left together, which is what the case below
// ("dropped from a config but not from EXTRAS") exists to force.
//
// Run:  node --test "tooling/ci/test/cors-allowlist.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { APEX_ORIGIN, APEX_HOST } from '../../sites/apex.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-cors-allowlist.mjs');

let TMP;
let seq = 0;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-cors-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** IMPORTED, never retyped — same rule the guard itself follows. If the apex ever
 *  moves, both sides of every comparison in this file move with it. */
const APEX = new URL(APEX_ORIGIN).origin;

/** 🔴 THE APP ID IS READ OFF THE DECLARATION, NEVER RE-SPELLED HERE.
 *
 *  Until 2026-09-09 this file spelled the id as a literal on BOTH sides of every
 *  comparison — in the fixture catalogue row AND in the regexp the assertion
 *  matched the guard's output against. A pair like that is DISARMED by a global
 *  find-and-replace: the sweep rewrites subject and assertion together and every
 *  case goes on passing while proving nothing. Worse, the `subly → subscription-
 *  tracker` sweep could NOT rewrite the four live external resources (the
 *  retiring subdomain, the old Pages origin, `subly_db`, the release stamps), so
 *  the halves that were rewritten stopped agreeing with the halves that were
 *  frozen and two cases went red for a reason that had nothing to do with CORS.
 *
 *  `catalog/apps.json` is the published declaration — the same file the guard
 *  derives from — so a future rename moves both sides of every comparison in
 *  this file at once, and can reach neither by hand. */
const APP = (() => {
  const rows = JSON.parse(readFileSync(join(REPO, 'catalog', 'apps.json'), 'utf8'));
  const slugs = (Array.isArray(rows) ? rows : [])
    .map((r) => r?.slug)
    .filter((s) => typeof s === 'string' && s !== '');
  assert.ok(slugs.length > 0, 'catalog/apps.json declares no slug — this test can derive nothing');
  return slugs[0];
})();

/** The app's own Worker directory. DERIVED, because `services/<slug>-api` is the
 *  guard's derivation rule and re-typing it here would let the two disagree. */
const API = `${APP}-api`;

/** ⚠️ REAL LIVE RESOURCES, DELIBERATELY NOT RENAMED — the sweep that moved the
 *  app id could not move these and must never be "tidied" into agreement with it:
 *
 *  · `subly-9cp.pages.dev` is the OLD Cloudflare Pages origin, still the live
 *    origin until the separate migration step lands;
 *  · `subly.nikatru.com` is the RETIRED subdomain — a real DNS label with a zone
 *    Redirect Rule 301ing it to the path form. It is NOT derivable from the
 *    catalogue any more and survives only as an EXTRAS entry for the length of
 *    the cutover [ADR 075].
 *
 *  Both are spelled out because both are proper names of things that exist, not
 *  expressions of the app's identity. Everything that IS the app's identity is
 *  derived from `APP` above. */
const PAGES = 'https://subly-9cp.pages.dev';
const LOCAL = 'http://localhost:3000';
/** The RETIRED app subdomain. It is no longer in either config and no longer in
 *  EXTRAS -- it is kept here only as the input for the two cases that must still
 *  be able to fail: an unjustified origin, and the coupled removal below. */
const SUBDOMAIN = 'https://subly.nikatru.com';

/** The live catalogue row's shape. `origin` is carried by the real apps.json and
 *  is NOT what the guard derives from — the browser origin comes from `url`, i.e.
 *  from the app's PUBLIC ADDRESS, which is now a path on the apex. */
const LIVE_ROW = {
  slug: APP,
  name: 'Nikatru Subscription Tracker',
  url: `${APEX}/${APP}`,
  origin: PAGES,
  status: 'live',
};

/** The allowlists the real repo carries today (services/platform/wrangler.jsonc
 *  and services/<slug>-api/wrangler.jsonc, read 2026-09-09), so the baseline
 *  fixture is the live config rather than a convenient invention. The retired
 *  subdomain left both on 2026-09-09 with the 301 (#569). */
const REAL = {
  platform: `${APEX},${PAGES},${LOCAL}`,
  [API]: `${APEX},${PAGES}`,
};

/** Quote a derived string for use inside a `new RegExp`. Every assertion in this
 *  file that names a host or a path builds its pattern from the declaration; this
 *  is what keeps that safe when the value contains `.` or `/`. */
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build a throwaway repo. `workers` maps a service directory either to its
 * ALLOWED_ORIGINS string (or `null` to omit the var entirely), or to a
 * `{ allowed, appId }` pair — `appId: null` omits `vars.APP_ID`, which is the
 * only way to write the input that reds the limb that replaced the per-app origin.
 *
 * 🔴 EVERY fixture config is written as REAL JSONC — line comments, a block
 * comment and a trailing comma — because "parse the config, never grep it" is
 * the property under test, not a detail of the fixture.
 */
function tree({ apps = [LIVE_ROW], workers = REAL, extraComment = '' } = {}) {
  const root = join(TMP, `r${seq++}`);
  const dataDir = join(root, 'catalog');
  mkdirSync(dataDir, { recursive: true });
  if (apps !== null) writeFileSync(join(dataDir, 'apps.json'), JSON.stringify(apps, null, 2));

  for (const [name, spec] of Object.entries(workers)) {
    const { allowed, appId } =
      spec !== null && typeof spec === 'object' ? spec : { allowed: spec, appId: name };
    const dir = join(root, 'services', name);
    mkdirSync(dir, { recursive: true });
    const varsLine = allowed === null ? '' : `    "ALLOWED_ORIGINS": ${JSON.stringify(allowed)},\n`;
    const appIdLine = appId === null ? '' : `    "APP_ID": ${JSON.stringify(appId)},\n`;
    writeFileSync(
      join(dir, 'wrangler.jsonc'),
      `{\n` +
        `  /* Cloudflare Worker — ${name}. Block comment, on purpose. */\n` +
        `  "name": ${JSON.stringify(name)},\n` +
        `  "main": "src/index.ts",\n` +
        `  // This app's web origins only (comma-separated).\n` +
        `${extraComment}` +
        `  "vars": {\n` +
        appIdLine +
        varsLine +
        `  },\n` + // ← trailing comma before } — jsonc, not json
        `}\n`,
    );
  }
  return root;
}

function run(cwd) {
  try {
    const stdout = execFileSync(process.execPath, [GUARD], { cwd, encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('assert-cors-allowlist', () => {
  test('passes on the live shape: every derived origin present, nothing unjustified', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /2 Worker config\(s\) checked against 1 catalogue origin\(s\) from 1 app\(s\)/);
    // Derived and EXTRAS are counted SEPARATELY and both printed: a single
    // blended tally is how a hand-maintained list creeps back unnoticed. The
    // EXTRAS count is FIVE, not three, and the two it grew by are the retiring
    // subdomain in each config — the number rising is the cutover being visible.
    assert.match(out, /2 derived requirement\(s\) \+ 3 declared EXTRAS all present/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ⏱ REWRITTEN [ADR 075]. THIS USED TO BE "FAILS when a new catalogue app is
  // missing from the shared Worker" — N1, the defect [4]B-2 exists for and the
  // one the previous guard passed: a second app (`https://drift.nikatru.com`)
  // stamped into the catalogue, nobody edits the shared Worker, exit 1 naming
  // the new origin.
  //
  // THAT INPUT NO LONGER EXISTS. App #2's `url` is `https://nikatru.com/drift`,
  // whose origin is the string app #1 already contributes, so nothing can ever
  // be "missing" for the second app alone. The per-app CORS boundary was traded
  // for one payment-provider approval instead of N; this is the receipt.
  //
  // What survives, and CAN still fail: N apps must collapse to exactly ONE
  // derived origin (publish one on a subdomain again and the tally changes and
  // the apex limb below goes red), and the shared Worker missing THAT origin is
  // still every app's browser traffic refused at runtime. Both halves asserted.
  // ─────────────────────────────────────────────────────────────────────────
  test('two catalogue apps yield exactly ONE derived origin, and dropping it still FAILS', () => {
    const drift = { slug: 'drift', name: 'Drift', url: `${APEX}/drift`, status: 'live' };

    // (a) the collapse itself: 2 apps, 1 origin. If this ever reads "2
    //     catalogue origin(s)", an app has left the apex.
    const ok = run(tree({ apps: [LIVE_ROW, drift] }));
    assert.equal(ok.code, 0, ok.out);
    assert.match(
      ok.out,
      /2 Worker config\(s\) checked against 1 catalogue origin\(s\) from 2 app\(s\)/,
    );
    // The shared Worker still carries one derived requirement PER APP — they
    // just happen to be the same string now, which is exactly the point.
    assert.match(ok.out, /3 derived requirement\(s\) \+ 3 declared EXTRAS all present/);

    // (b) the floor that survived: drop the apex from the shared Worker and
    //     every app in the catalogue is named, not just the newest one.
    const workers = { ...REAL, platform: `${RETIRED_SUBDOMAIN},${PAGES},${LOCAL}` };
    const { code, out } = run(tree({ apps: [LIVE_ROW, drift], workers }));
    assert.equal(code, 1);
    assert.match(out, /services\/platform\/wrangler\.jsonc — missing "https:\/\/nikatru\.com"/);
    assert.match(out, /apps\.json declares "drift"/);
    assert.match(out, new RegExp(`apps\\.json declares "${rx(APP)}"`));
    assert.match(out, /refused at runtime with nothing logged server side/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ⏱ REWRITTEN [ADR 075]. THIS USED TO BE "FAILS when a per-app Worker drops
  // its own app origin" — services/<slug>-api had to list THAT ONE APP'S origin,
  // and the input that redded it was subscriptiontracker-api carrying everything except
  // `https://subly.nikatru.com`.
  //
  // UNTESTABLE FOR THE SAME REASON as the case above: "its own app origin" and
  // "every other app's origin" are now one string. Dropping the apex from a
  // per-app Worker is still red — case (b) above covers that shape — but it no
  // longer asserts a PER-APP anything, so keeping it here under this name would
  // be an assertion whose title is a lie.
  //
  // What replaced the boundary is asserted instead: a per-app Worker (one not
  // marked `scope: 'every-app'`) must declare `vars.APP_ID`. With one shared
  // origin, the token+APP_ID pair is the only thing left that can tell one app's
  // caller from another's, and a per-app Worker without it authorises on a
  // string every app in the portfolio sends. THAT has an input that reds it.
  // ─────────────────────────────────────────────────────────────────────────
  test('FAILS when a per-app Worker declares no vars.APP_ID', () => {
    const workers = { ...REAL, [API]: { allowed: REAL[API], appId: null } };
    const { code, out } = run(tree({ workers }));
    assert.equal(code, 1);
    assert.match(
      out,
      new RegExp(`services/${rx(API)}/wrangler\\.jsonc — vars\\.APP_ID is missing on a PER-APP Worker`),
    );
    assert.match(out, /authorises on a string every app in the portfolio sends/);
    // The shared Worker is exempt from this limb by design — it is every app's
    // Worker, so there is no single APP_ID it could carry. If this ever starts
    // naming services/platform, the exemption has inverted.
    assert.doesNotMatch(out, /services\/platform\/wrangler\.jsonc — vars\.APP_ID/);
  });

  // ── the reversal itself is guarded [ADR 075] ──────────────────────────────
  // NEW. The two cases above lost their teeth because every app moved to the
  // apex; this is the case that makes moving BACK a red build rather than a
  // silent restoration of a boundary nothing else asserts any more. An app on
  // its own origin needs its own payment-provider approval and its own
  // allowlist entry, and neither happens by accident.
  test('FAILS when a catalogue row is published on a subdomain again', () => {
    // 🔴 THE RELAPSE HOST IS THE APP'S OWN SUBDOMAIN UNDER THE ID IT CARRIES
    // TODAY, DERIVED — not the RETIRED one. Those are two different facts and
    // the file used to conflate them: the fixture published the row on
    // `subly.nikatru.com` (a real, live, 301'd DNS label that the rename sweep
    // could not touch) while the assertion had been swept to the new id, so the
    // case failed for a reason with nothing to do with the reversal it guards.
    // What is under test is "THIS app went back to its OWN origin", so both the
    // url written and the host asserted come from `APP`.
    const ownSubdomain = `https://${APP}.${APEX_HOST}`;
    const relapsed = { ...LIVE_ROW, url: ownSubdomain };
    const { code, out } = run(tree({ apps: [relapsed] }));
    assert.equal(code, 1);
    // ⚠️ ANCHORED TO THE SENTENCE, NOT LEFT AS A BARE HOST PATTERN. An unanchored
    // host pattern over text that contains URLs is the missing-regexp-anchor
    // shape (CodeQL js/regex/missing-regexp-anchor): it matches inside
    // `https://<app>.nikatru.com.evil.example` too, so it would go on passing
    // while the guard named a host nobody meant. Each assertion below pins the
    // host to what must surround it — the quotes the guard prints around every
    // origin — so the match cannot drift onto a longer name.
    assert.match(out, new RegExp(`1 catalogue origin\\(s\\) are not the apex "${rx(APEX)}"`));
    assert.match(out, new RegExp(`"${rx(ownSubdomain)}"`));
    assert.match(out, /publishes every app at a PATH on the apex/);
  });

  // The other direction: the catalogue is also a CEILING, not just a floor.
  test('FAILS on a hand-added origin the catalogue does not justify', () => {
    const workers = { ...REAL, [API]: `${REAL[API]},https://evil.example.com` };
    const { code, out } = run(tree({ workers }));
    assert.equal(code, 1);
    assert.match(out, /"https:\/\/evil\.example\.com" is listed but NOTHING justifies it/);
    assert.match(out, /standing CORS grant nobody reviewed/);
  });

  test('accepts the declared EXTRAS (retiring subdomain, preview domain, local dev server)', () => {
    // These are NOT in apps.json and must still be allowed, because EXTRAS
    // gives each a reason. The subdomain is one of them now: it stopped being
    // catalogue-derived the moment the app moved to a path.
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    // ⚠️ SUBSTRING, NOT REGEX. These are NEGATIVE assertions — "the guard did not
    // complain about this host" — and for a negative the loosest match is the
    // strongest check, so anchoring them would weaken them. But a bare host
    // pattern compiled as a regex over text full of URLs is the
    // missing-regexp-anchor shape whatever its polarity, and arguing that a
    // scanner has miscategorised one line is how a rule stops being read at all.
    // `includes` says exactly what is meant, catches strictly more, and is not a
    // regex — so there is nothing left to anchor.
    // The bare `pages.dev` suffix is kept alongside the three exact hosts, so
    // this stays a SUPERSET of what it checked before the hosts were derived.
    for (const host of ['pages.dev', ...[PAGES, LOCAL, RETIRED_SUBDOMAIN].map((o) => new URL(o).host)]) {
      assert.ok(!out.includes(host), `the guard named ${host} on a tree where every EXTRA is present:\n${out}`);
    }
  });

  // 🔴 AN EXTRA IS REQUIRED, NOT MERELY PERMITTED — and the first draft of this
  // guard got that wrong. Treating EXTRAS as a permit-list alone meant dropping
  // http://localhost:3000 from services/platform became a PASS, silently
  // regressing a case the pre-derivation guard already caught (guards.test.mjs
  // "FAILS when a required PLATFORM origin is dropped"). Removing an origin has
  // to be a reviewable diff, not a quiet edit to a comma-separated string.
  test('FAILS when a declared EXTRA is dropped from the config', () => {
    const workers = { ...REAL, platform: `${APEX},${RETIRED_SUBDOMAIN},${PAGES}` }; // localhost gone
    const { code, out } = run(tree({ workers }));
    assert.equal(code, 1);
    assert.match(out, /missing "http:\/\/localhost:3000" — EXTRAS:/);
    assert.match(out, /delete the EXTRAS entry in the same change/);
  });

  // ⏱ REWRITTEN 2026-09-09, when the cutover's last step landed. It used to assert
  // the removal was COUPLED: with the subdomain still in EXTRAS, dropping it from a
  // config alone had to red, because a live browser tab would lose its API with
  // nothing logged. Both halves left in one commit, so that input can no longer be
  // written -- and the assertion is now the one that keeps the retirement PERMANENT:
  // putting the subdomain back into a config, with nothing in EXTRAS justifying it,
  // is an unreviewed standing CORS grant for a host that serves only a 301.
  //
  // 🔴 THE EXPECTED MESSAGE IS BUILT FROM `SUBDOMAIN`, NOT RE-SPELT. It was
  // re-spelt until 2026-09-09 and the slug rename rewrote that ESCAPED copy while
  // leaving the plain const alone, so this case sat demanding
  // `subscriptiontracker.nikatru.com` — a host that exists nowhere and that the
  // guard can never print. It could not have failed. Subject and assertion now
  // come from one declaration.
  test('FAILS when the retired subdomain is put back into a config', () => {
    const workers = { ...REAL, [API]: `${APEX},${PAGES},${SUBDOMAIN}` };
    const { code, out } = run(tree({ workers }));
    assert.equal(code, 1);
    assert.match(out, new RegExp(`"${rx(SUBDOMAIN)}" is listed but NOTHING justifies it`));
    assert.match(out, /standing CORS grant nobody reviewed/);
  });

  test('FAILS when ALLOWED_ORIGINS is absent', () => {
    const { code, out } = run(tree({ workers: { ...REAL, platform: null } }));
    assert.equal(code, 1);
    assert.match(out, /vars\.ALLOWED_ORIGINS is missing/);
  });

  test('FAILS when ALLOWED_ORIGINS is an empty string', () => {
    const { code, out } = run(tree({ workers: { ...REAL, platform: '' } }));
    assert.equal(code, 1);
    assert.match(out, /ALLOWED_ORIGINS is EMPTY/);
  });

  // 🔴 THE ANTI-GREP CASE. A comment that mentions an origin must not satisfy
  // the requirement, and must not trip the unjustified check either. This repo
  // shipped a `grep '"r2_buckets"'` that matched the comment explaining why
  // there is no r2_buckets; the same mistake was reproduced again on 2026-08-07.
  test('ignores origins that appear only in comments (parsed, not grepped)', () => {
    const ghost = '  // was once "ALLOWED_ORIGINS": "https://ghost.example.com" — removed\n';
    const { code, out } = run(tree({ extraComment: ghost }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /ghost\.example\.com/);
  });

  test('FAILS a comment-only origin that the config no longer really lists', () => {
    // The mirror of the above: the origin is REQUIRED by the catalogue and
    // present only in prose. A grep would call this covered.
    //
    // ⏱ The fixture changed with [ADR 075] — it used to ghost a second app on
    // its own subdomain (`https://ghost.nikatru.com`), which the apex limb now
    // rejects before this limb is ever reached. The required origin it ghosts
    // is therefore the apex itself, which is the only derived origin left.
    const extraComment = `  // "${APEX}" used to be listed here\n`;
    const workers = { ...REAL, platform: `${RETIRED_SUBDOMAIN},${PAGES},${LOCAL}` };
    const { code, out } = run(tree({ workers, extraComment }));
    assert.equal(code, 1);
    assert.match(out, /services\/platform\/wrangler\.jsonc — missing "https:\/\/nikatru\.com"/);
  });

  // ── untaught scope ────────────────────────────────────────────────────────
  test('FAILS on a Worker it has never been taught about', () => {
    const { code, out } = run(tree({ workers: { ...REAL, 'mystery-worker': REAL[API] } }));
    assert.equal(code, 1);
    assert.match(out, /never been taught about services\/mystery-worker/);
    assert.match(out, /Name it services\/<slug>-api/);
  });

  // ── anti-vacuity [pipeline F-10] ──────────────────────────────────────────
  test('COVERAGE LOST on an empty catalogue', () => {
    const { code, out } = run(tree({ apps: [] }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — the catalogue yielded 0 origin\(s\)/);
    assert.match(out, /passes forever/);
  });

  test('COVERAGE LOST when the catalogue file is absent', () => {
    const { code, out } = run(tree({ apps: null }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — no catalogue at catalog\/apps\.json/);
  });

  test('COVERAGE LOST when fewer than two Worker configs are found', () => {
    const { code, out } = run(tree({ workers: { platform: REAL.platform } }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — found 1 Worker config\(s\)/);
  });

  // If the <slug>-api limb matches nothing, only the shared Worker is really
  // being checked and the tally still looks healthy. That must be loud.
  test('COVERAGE LOST when the <slug>-api derivation matches no Worker', () => {
    const other = { slug: 'other', name: 'Other', url: `${APEX}/other`, status: 'live' };
    const { code, out } = run(tree({ apps: [other] }));
    assert.equal(code, 1);
    assert.match(out, /the <slug>-api derivation matched 0 Worker\(s\)/);
  });

  test('COVERAGE LOST when a catalogue row has no url', () => {
    const { code, out } = run(tree({ apps: [{ slug: 'urlless', status: 'live' }] }));
    assert.equal(code, 1);
    assert.match(out, /row "urlless" has no `url`/);
  });
});
