#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// publish-amo.mjs — the Firefox (addons.mozilla.org) submission lane.
//
// 🔴 AMO IS THE ONE STORE WHOSE API CAN MAKE A FIRST SUBMISSION. [ADR 067]
// decision 8 puts one manual first publish in front of every store BECAUSE no
// store API allows one — except this one. `web-ext sign --channel listed`
// "creates a listing for your extension on AMO if --channel is set to listed and
// the extension isn't listed" (PRIMARY_SOURCES.webExtSign, fetched 2026-09-07).
// So the register row for `amo` is the only extension row that could honestly be
// armed before a human has touched a console — and it is still the register that
// decides, never this file.
//
// ── THE PIN IS EXACT AND THAT IS THE POINT ───────────────────────────────────
// `web-ext@10.6.0`, not `web-ext@10`. A range resolves at run time, so a
// rehearsal and the tag push that follows it can sign under different releases of
// the tool, and the rehearsal's green would be about a version the publish never
// ran. 10.6.0 is `latest` on the npm registry as of 2026-09-07 (published
// 2026-08-04). Renovate reaches this pin — assert-update-coverage.mjs is what
// says so — so pinning does not mean freezing.
//
// ⚠️ VERSION 8 CHANGED WHAT `sign` DOES AND VERSION 10 IS WHAT WE PIN. The
// command reference for v10 records that `--use-submission-api` was REMOVED (it
// was the v7 preview of listing-creation) and that `--channel` is now REQUIRED.
// Both facts are why the flags below are spelled out rather than defaulted.
//
// Usage:
//   node scripts/publish-amo.mjs --tool <id> --source-dir <dir> [--artifacts-dir <dir>]
//
// Exit 0 = published, or the register does not arm this channel and the owner
// step was printed. 1 = the channel is armed and something is missing or failed.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { laneVerdict, ArmingCoverageLost, REPO_ROOT } from './publish-arming.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// PRIMARY SOURCES — every remote fact this lane acts on, and where it came from.
// ALL FETCHED 2026-09-07. A fact whose URL is not written down here is a fact
// this script may not act on: an invented flag does not fail on a laptop, it
// fails against a live store account mid-submission.
// ─────────────────────────────────────────────────────────────────────────────
const PRIMARY_SOURCES = Object.freeze({
  webExtSign: 'https://extensionworkshop.com/documentation/develop/web-ext-command-reference/',
  webExtVersion: 'https://registry.npmjs.org/web-ext',
});

/**
 * The pinned tool. EXACT: see the header.
 *
 * ⏱ CORRECTED 2026-09-07 (store-lanes second pass) — THE PIN IS READ, NOT
 * RESTATED. It was the literal `'web-ext@10.6.0'` here and nowhere else, which
 * put it outside the domain of `tooling/ci/assert-update-coverage.mjs`: that
 * guard quantifies over the KEYS of `tooling/versions.json`, so its EXIT 0 was
 * silent about this pin while the unit's own acceptance recorded the green as
 * though it covered it. The version now lives in `tooling/versions.json`
 * (`web_ext`), a Renovate customManager extracts it, and this line reads it.
 *
 * 🔴 READING RATHER THAN COPYING IS THE POINT, and it is the opposite of the
 * gitleaks decision: there, `scan-secrets.mjs` keeps a literal precisely BECAUSE
 * it compares the pin against the installed binary, and reading it would make
 * that comparison compare a value with itself. Nothing here compares anything —
 * the pin IS the version to install — so a second copy could only drift.
 *
 * A missing or empty key is a REFUSAL, not a fallback to a range: falling back
 * would let a rehearsal and the tag push that follows it sign under different
 * releases of the tool, which is the exact failure the exact pin exists to stop.
 */
const WEB_EXT_PIN = (() => {
  const rel = 'tooling/versions.json';
  const abs = join(REPO_ROOT, rel);
  let v;
  try {
    v = JSON.parse(readFileSync(abs, 'utf8')).web_ext;
  } catch (e) {
    console.error(`FAIL ${rel} could not be read for the web-ext pin — ${e.message}`);
    console.error('     The pin is declared once, in that file, so that Renovate and assert-update-coverage can both');
    console.error('     see it. This lane will not fall back to a range: a range resolves at run time and a rehearsal');
    console.error('     would then be green about a version the publish never ran.');
    process.exit(1);
  }
  if (typeof v !== 'string' || !/^\d+\.\d+\.\d+$/.test(v)) {
    console.error(`FAIL ${rel} key \`web_ext\` is ${JSON.stringify(v)}; an exact three-part version is required.`);
    process.exit(1);
  }
  return `web-ext@${v}`;
})();

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const TOOL = opt('tool');
const SOURCE_DIR = opt('source-dir', 'dist/unpacked-firefox');
const ARTIFACTS_DIR = opt('artifacts-dir', 'dist/amo');

function die(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('\npublish-amo: FAILED');
  process.exitCode = 1;
}

if (TOOL === null || TOOL.trim() === '') {
  die(['FAIL --tool <id> is required. Without it this lane cannot say WHICH extension it would sign,',
    '     and a submission under the wrong add-on id is not recoverable.']);
} else {
  let result = null;
  try {
    // The tool is passed for the SAME reason the other two lanes pass it, and the
    // answer is different in kind rather than absent: AMO reads the add-on id from
    // the package manifest in --source-dir, so this lane addresses no id of its own.
    // Declaring it on the tool anyway keeps all three destinations readable in one
    // place and keeps the verdict shape identical across the three stores.
    result = laneVerdict('amo', { toolId: TOOL, ...(opt('repo-root') === null ? {} : { root: opt('repo-root') }) });
  } catch (e) {
    if (e instanceof ArmingCoverageLost) die(e.lines);
    else throw e;
  }

  if (result !== null) {
    for (const l of result.lines) console.log(l);
    if (result.verdict === 'refuse') {
      process.exitCode = 1;
    } else if (result.verdict === 'go') {
      if (!existsSync(SOURCE_DIR)) {
        die([
          `FAIL --source-dir ${SOURCE_DIR} does not exist.`,
          '     The pack step writes the unpacked Firefox tree that web-ext signs. With it absent this',
          '     would sign whatever the working directory happens to be, which is how the wrong bytes',
          '     reach a store.',
        ]);
      } else {
        console.log(`→    ${WEB_EXT_PIN} sign --channel listed --source-dir ${SOURCE_DIR}  (tool "${TOOL}")`);
        console.log(`     flags read from ${PRIMARY_SOURCES.webExtSign}; the pin is exact against ${PRIMARY_SOURCES.webExtVersion}`);
        const r = spawnSync(
          'npx',
          ['--yes', WEB_EXT_PIN, 'sign', '--channel', 'listed', '--source-dir', SOURCE_DIR, '--artifacts-dir', ARTIFACTS_DIR],
          {
            stdio: 'inherit',
            shell: process.platform === 'win32',
            env: {
              ...process.env,
              WEB_EXT_API_KEY: process.env.AMO_JWT_ISSUER,
              WEB_EXT_API_SECRET: process.env.AMO_JWT_SECRET,
            },
          },
        );
        if (r.status !== 0) {
          die([
            `FAIL ${WEB_EXT_PIN} sign exited ${r.status === null ? `on signal ${r.signal}` : r.status}.`,
            '     AMO is the one channel whose API creates the listing, so a failure here is a submission',
            '     that did not happen — not a listing left half-made. Read the tool output above.',
          ]);
        } else {
          console.log(`publish-amo: SUBMITTED — ${TOOL} signed and submitted for listing on addons.mozilla.org.`);
        }
      }
    }
  }
}
