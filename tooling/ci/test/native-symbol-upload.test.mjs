// ─────────────────────────────────────────────────────────────────────────────
// native-symbol-upload.test.mjs — tooling/ops/upload-native-symbols.mjs must be
// able to FAIL, and it must fail on every state in which `glitchtip-cli
// debug-files upload` exits 0 having stored nothing.
//
// 🔴 THE POINT OF THAT SCRIPT IS THAT THE CLI'S EXIT CODE IS NOT EVIDENCE.
// Read from glitchtip-cli v1.0.0 `src/commands/debug_files.rs`, three separate
// paths return `Ok(())`:
//   · `found.is_empty()` → prints "No debug information files found." and stops;
//   · the per-file loop counts failures into `errors` and prints them in its
//     "Upload complete" line without failing;
//   · `poll_assembly` gives up after 60 polls with "Assembly did not complete
//     within timeout." — and a per-file `"error"` state prints "Error: …" and
//     is likewise not fatal.
// A workflow step that only checked `$?` would be green in all three. Each one
// below is a case here, driven through the exported verdict.
//
// ── WHY HALF THESE CASES SPAWN AND HALF IMPORT ───────────────────────────────
// The refusals BEFORE the CLI is spawned — no token, no directory, an empty
// directory, an unparseable DSN — are driven by spawning the script for real,
// because that is the whole path a runner takes. The CLI-output contract is
// driven through the exported `readCliVerdict`, because the alternative is a
// fake `glitchtip-cli` on disk: a shebang script on Linux, a `.cmd` on Windows,
// and `spawnSync` runs neither the same way — the test would then be green on
// the runner and red on the laptop for a reason about `spawnSync` rather than
// about symbols. The split is stated in the script's own header.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(ROOT, 'tooling', 'ops', 'upload-native-symbols.mjs');

const { readCliVerdict } = await import(`file://${SCRIPT.split('\\').join('/')}`);

const DSN = 'https://abc123@glitchtip.example.com/2';

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-symupload-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** A split-debug-info directory with `files` non-empty files in it. */
function symbolsDir(files) {
  const d = join(TMP, `d${seq++}`);
  mkdirSync(d, { recursive: true });
  for (const n of files) writeFileSync(join(d, n), 'not really an ELF, but not empty either\n');
  return d;
}

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SENTRY_AUTH_TOKEN: 'tok', GLITCHTIP_DSN: DSN, ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** The CLI output a healthy upload of `n` files produces, verbatim in shape. */
const goodOutput = (n) =>
  `Found ${n} debug information file(s)\n` +
  `  Uploaded chunk for: app.linux-x64.symbols\n` +
  `  Assembly completed.\n` +
  `Upload complete: ${n} chunk(s) uploaded, 0 error(s).\n`;

describe('upload-native-symbols — the refusals that happen before the CLI runs', () => {
  test('GREEN CONTROL — every argument present and a non-empty directory reaches the CLI', () => {
    // The fake CLI path does not exist, so the script gets as far as spawning
    // and fails THERE. That is the proof the argument, credential and directory
    // limbs all passed: the failure names the spawn, not any of them.
    const dir = symbolsDir(['app.linux-x64.symbols']);
    const { code, out } = run(['--cli', join(TMP, 'no-such-cli'), '--dir', dir, '--org', 'nikatru', '--project', 'subscriptiontracker']);
    assert.equal(code, 1, out);
    assert.match(out, /1 debug file\(s\) in /);
    assert.doesNotMatch(out, /SENTRY_AUTH_TOKEN is empty/);
    assert.doesNotMatch(out, /is not a directory/);
  });

  test('FAILS CLOSED, naming GLITCHTIP_TOKEN, when the auth token is absent', () => {
    const dir = symbolsDir(['app.linux-x64.symbols']);
    const { code, out } = run(
      ['--cli', 'glitchtip-cli', '--dir', dir, '--org', 'nikatru', '--project', 'subscriptiontracker'],
      { SENTRY_AUTH_TOKEN: '' },
    );
    assert.equal(code, 1, out);
    assert.match(out, /SENTRY_AUTH_TOKEN is empty/);
    assert.match(out, /GLITCHTIP_TOKEN/);
    assert.match(out, /This is a REFUSAL, not a skip/);
  });

  test('FAILS when the split-debug-info directory does not exist — the build did not obfuscate', () => {
    const { code, out } = run([
      '--cli', 'glitchtip-cli', '--dir', join(TMP, 'never-written'), '--org', 'nikatru', '--project', 'subscriptiontracker',
    ]);
    assert.equal(code, 1, out);
    assert.match(out, /is not a directory/);
    assert.match(out, /the two values have drifted apart/);
  });

  test('FAILS when the directory exists and is EMPTY — the CLI would call that a green upload', () => {
    const dir = symbolsDir([]);
    const { code, out } = run(['--cli', 'glitchtip-cli', '--dir', dir, '--org', 'nikatru', '--project', 'subscriptiontracker']);
    assert.equal(code, 1, out);
    assert.match(out, /holds no non-empty file/);
    assert.match(out, /No debug information files found/);
  });

  test('FAILS on a DSN that does not parse, and does not print the value', () => {
    const dir = symbolsDir(['app.linux-x64.symbols']);
    const { code, out } = run(
      ['--cli', 'glitchtip-cli', '--dir', dir, '--org', 'nikatru', '--project', 'subscriptiontracker'],
      { GLITCHTIP_DSN: 'this-is-not-a-dsn' },
    );
    assert.equal(code, 1, out);
    assert.match(out, /did not parse into a server origin/);
    assert.doesNotMatch(out, /this-is-not-a-dsn/);
  });

  test('FAILS when a required flag is missing', () => {
    const dir = symbolsDir(['app.linux-x64.symbols']);
    const { code, out } = run(['--cli', 'glitchtip-cli', '--dir', dir, '--org', 'nikatru']);
    assert.equal(code, 1, out);
    assert.match(out, /--project is required/);
  });

  test('FAILS on a flag given no value — TRAPS shell-13, the eaten next argument', () => {
    const { code, out } = run(['--cli', 'glitchtip-cli', '--dir', '--org', 'nikatru', '--project', 'subscriptiontracker']);
    assert.equal(code, 1, out);
    assert.match(out, /--dir was given no value/);
  });
});

describe("upload-native-symbols — the CLI's three exit-0-having-stored-nothing states", () => {
  test('GREEN CONTROL — the output a healthy upload produces is accepted', () => {
    const v = readCliVerdict({ out: goodOutput(2), status: 0, fileCount: 2, cli: 'glitchtip-cli' });
    assert.equal(v.ok, true, JSON.stringify(v));
  });

  test('REFUSED — "No debug information files found." (the empty-set green)', () => {
    const v = readCliVerdict({
      out: 'No debug information files found.\n', status: 0, fileCount: 2, cli: 'glitchtip-cli',
    });
    assert.equal(v.ok, false);
    assert.match(v.lines.join(' '), /did not print how many debug information files it found/);
  });

  test('REFUSED — the CLI found FEWER files than are on disk', () => {
    const v = readCliVerdict({ out: goodOutput(1), status: 0, fileCount: 3, cli: 'glitchtip-cli' });
    assert.equal(v.ok, false);
    assert.match(v.lines.join(' '), /found 1 debug information file\(s\); this script counted 3/);
  });

  test('REFUSED — a chunk failed and the CLI still exited 0', () => {
    const out = goodOutput(2).replace('0 error(s).', '1 error(s).');
    const v = readCliVerdict({ out, status: 0, fileCount: 2, cli: 'glitchtip-cli' });
    assert.equal(v.ok, false);
    assert.match(v.lines.join(' '), /1 chunk upload\(s\) failed and the CLI still exited 0/);
  });

  test('REFUSED — fewer chunks uploaded than files on disk', () => {
    const out = `Found 2 debug information file(s)\n  Assembly completed.\nUpload complete: 1 chunk(s) uploaded, 0 error(s).\n`;
    const v = readCliVerdict({ out, status: 0, fileCount: 2, cli: 'glitchtip-cli' });
    assert.equal(v.ok, false);
    assert.match(v.lines.join(' '), /1 chunk\(s\) uploaded for 2 file\(s\) on disk/);
  });

  test('REFUSED — no "Upload complete" line at all, so the error count is unknown', () => {
    const v = readCliVerdict({
      out: 'Found 2 debug information file(s)\n  Assembly completed.\n', status: 0, fileCount: 2, cli: 'glitchtip-cli',
    });
    assert.equal(v.ok, false);
    assert.match(v.lines.join(' '), /did not print its "Upload complete" line/);
  });

  test('REFUSED — assembly timed out, which the CLI reports and then returns Ok over', () => {
    const out = goodOutput(2).replace('  Assembly completed.\n', '  Assembly did not complete within timeout.\n');
    const v = readCliVerdict({ out, status: 0, fileCount: 2, cli: 'glitchtip-cli' });
    assert.equal(v.ok, false);
    assert.match(v.lines.join(' '), /never reported the debug files as assembled/);
    assert.match(v.lines.join(' '), /"queued", never "stored"/);
  });

  test('REFUSED — a non-zero exit is still a failure, before any output is read', () => {
    const v = readCliVerdict({ out: goodOutput(2), status: 2, fileCount: 2, cli: 'glitchtip-cli' });
    assert.equal(v.ok, false);
    assert.match(v.lines.join(' '), /exited 2/);
  });
});
