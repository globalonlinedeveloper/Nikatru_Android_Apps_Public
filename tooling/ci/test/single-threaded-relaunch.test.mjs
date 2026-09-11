// ─────────────────────────────────────────────────────────────────────────────
// single-threaded-relaunch.test.mjs — the shared relaunch must pass the work
// through unchanged, and must never let "I could not look" read as a verdict.
//
// single-threaded-relaunch.mjs is how assert-launcher-icons.mjs,
// assert-elf-page-alignment.mjs, assert-listing-assets.mjs and
// assert-stamp-brand-assets.mjs do their work with V8 background tasks OFF, so
// that their exit cannot deadlock (nodejs/node#54918 — the hang that cancelled CI
// runs 34442894882 and 34553250403). Each of those guards pins the relaunch in
// its own test file ("V8 background tasks: OFF"). THIS file pins what the four
// share, against tiny scripts that import the module exactly as a guard does:
//
//   R1 the working process is --single-threaded, and the parent is not doing the work
//   R2 argv, execArgv and the exit STATUS pass through unchanged (0, 1 and 7)
//   R3 already single-threaded → no second relaunch
//   R4 the relaunch cannot start          → the caller's reporter, exit 2
//   R5 the working process is KILLED      → the caller's reporter, exit 2 (POSIX)
//
// Mutations run against the module (2026-09-11, predictions written first):
//   · the backstop `process.exit(2)` after a failed relaunch made `return` → R4b RED
//     (R4 stays green: its reporter exits by itself, which is why R4b exists)
//   · the `child.status === null` branch disabled                          → R5 RED
//   · `...process.argv.slice(2)` dropped from the relaunch                 → R2 RED
//
// Run:  node --test tooling/ci/test/single-threaded-relaunch.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HELPER = join(CI_DIR, 'single-threaded-relaunch.mjs');
const HELPER_URL = pathToFileURL(HELPER).href;
const POSIX = process.platform !== 'win32';

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-relaunch-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A guard-shaped script: imports the helper, relaunches, then does `body`.
 *  Its reporter prints COVERAGE LOST and exits 2, the way the guards' do —
 *  unless `returningReporter`, which models a reporter that forgets to exit. */
function script(body, { preamble = '', returningReporter = false } = {}) {
  const p = join(TMP, `s${seq++}.mjs`);
  writeFileSync(
    p,
    `import { relaunchSingleThreaded, isSingleThreaded } from ${JSON.stringify(HELPER_URL)};\n` +
      `function coverageLost(lines) {\n` +
      `  console.error('COVERAGE LOST: ' + lines.join(' | '));\n` +
      `  ${returningReporter ? '' : 'process.exit(2);'}\n` +
      `}\n` +
      `${preamble}\n` +
      `relaunchSingleThreaded(import.meta.url, coverageLost);\n` +
      `${body}\n`,
  );
  return p;
}

const run = (file, args = [], execArgv = []) => {
  const r = spawnSync(process.execPath, [...execArgv, file, ...args], { encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, signal: r.signal, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, error: r.error };
};

describe('single-threaded-relaunch', () => {
  test('R1 the work runs in a --single-threaded process, exactly once', () => {
    const f = script("console.log('WORK single=' + isSingleThreaded() + ' pid=' + process.pid);");
    const { code, out } = run(f);
    assert.equal(code, 0, out);
    const work = out.split('\n').filter((l) => l.startsWith('WORK'));
    assert.equal(work.length, 1, `the work must run once, in the child — got:\n${out}`);
    assert.match(work[0], /single=true/);
  });

  test('R2 argv, execArgv and the exit status pass through unchanged', () => {
    const f = script(
      "console.log('ARGS ' + JSON.stringify(process.argv.slice(2)));\n" +
        "console.log('EXECARGV ' + JSON.stringify(process.execArgv));\n" +
        'process.exit(Number(process.argv[2]));',
    );
    for (const status of [0, 1, 7]) {
      const { code, out } = run(f, [String(status), '--seed', 'a b'], ['--stack-size=900']);
      assert.equal(code, status, out);
      assert.match(out, new RegExp(`ARGS \\["${status}","--seed","a b"\\]`));
      assert.match(out, /EXECARGV \[[^\]]*"--single-threaded"[^\]]*"--stack-size=900"[^\]]*\]/);
    }
  });

  test('R3 a process that is already single-threaded is not relaunched again', () => {
    const f = script("console.log('WORK pid=' + process.pid);");
    const { code, out } = run(f, [], ['--single-threaded']);
    assert.equal(code, 0, out);
    assert.equal(out.split('\n').filter((l) => l.startsWith('WORK')).length, 1, out);
  });

  test('R4 a relaunch that cannot start is COVERAGE LOST, exit 2 — never 0, never 1', () => {
    // process.execPath is what the helper spawns; pointing it at nothing makes
    // the spawn itself fail, which is the case under test.
    const missing = JSON.stringify(join(TMP, 'no-such-node'));
    const f = script("console.log('WORK');", { preamble: `process.execPath = ${missing};` });
    const { code, out } = run(f);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST: could not relaunch with --single-threaded/);
    assert.doesNotMatch(out, /WORK/);
  });

  test('R4b the exit is 2 even if the caller\'s reporter forgets to exit', () => {
    const missing = JSON.stringify(join(TMP, 'no-such-node'));
    const f = script("console.log('WORK');", { preamble: `process.execPath = ${missing};`, returningReporter: true });
    const { code, out } = run(f);
    assert.equal(code, 2, out);
    assert.doesNotMatch(out, /WORK/);
  });

  // POSIX only: Windows has no signals to die by, so a killed child there
  // reports an exit status and is passed through as one.
  test('R5 a working process killed before its verdict is COVERAGE LOST, exit 2', { skip: POSIX ? false : 'POSIX signals only' }, () => {
    const f = script("console.log('PARTIAL');\nprocess.kill(process.pid, 'SIGKILL');");
    const { code, out } = run(f);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST: the working process was killed by SIGKILL before it delivered a verdict/);
  });
});
