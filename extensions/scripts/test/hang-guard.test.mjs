/* hang-guard.test.mjs — does the ceiling actually fire, and does a normal run
   pass through untouched?
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node --test scripts/test/hang-guard.test.mjs

   🔴 THE PAIR THAT MATTERS IS (a) AND (b). A wrapper that never fires is
   indistinguishable from no wrapper at all, and a wrapper that fires on a
   healthy command turns every green run red — so both limbs are asserted, not
   just the interesting one. `scripts/lib/hang-guard.mjs` exists because a step
   that had printed its last line still hung for 25 minutes; a guard for that
   which was itself never proven to bite would be the same class of defect one
   level up.

   (c) is the limb that keeps the guard HONEST about failures: a command that
   exits 3 must come back as 3. If the wrapper collapsed every non-zero code to
   1 — or worse, to 124 — a real gate failure would arrive dressed as a hang and
   somebody would "fix" it by raising the ceiling.

   ON POSIX (b) also asserts that Node's diagnostic report LANDED. That file is
   the entire reason the guard signals before it kills: it carries the JS stack
   of every thread and the list of open libuv handles, which is the evidence a
   re-run destroys. Windows cannot be signalled for a report — Node's
   --report-on-signal is a no-op there — so the file assertion is skipped and
   only the 124 is required, which is exactly what the guard promises on that
   platform. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.resolve(HERE, '..', 'lib', 'hang-guard.mjs');
const POSIX = process.platform !== 'win32';

/* Each case gets its own report directory, so (b)'s assertion that a report
   exists cannot be satisfied by a file some earlier case left behind. */
function tmpdir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hang-guard-' + tag + '-'));
}

function runGuard(args, dir) {
  const res = spawnSync(process.execPath, [GUARD, '--report-dir', dir, ...args], {
    encoding: 'utf8',
    /* The guard inherits stdio, so its child's output arrives here as the
       guard's own. Captured rather than inherited: a case asserts on text. */
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

test('a command that exits 0 passes through with code 0', () => {
  const dir = tmpdir('ok');
  const r = runGuard(
    ['--seconds', '60', '--retries', '0', '--', process.execPath, '-e', 'console.log("hello from the child")'],
    dir
  );
  assert.equal(r.code, 0, 'expected 0, got ' + r.code + '\n--- output ---\n' + r.out);
  assert.match(r.out, /hello from the child/, 'the child\'s stdout must reach the log unchanged');
  assert.doesNotMatch(r.out, /::warning::hang-guard/, 'a healthy run must not warn about a ceiling it never reached');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a command that never exits is killed at the ceiling and reported as 124', () => {
  const dir = tmpdir('hang');
  const r = runGuard(
    /* setInterval with no unref is the smallest honest hang: the process is
       healthy, the loop simply never drains. --grace-seconds is cut to 2 so the
       case costs ~5s rather than ~13s; the production default stays 10. */
    ['--seconds', '2', '--retries', '0', '--grace-seconds', '2', '--',
     process.execPath, '-e', 'console.log("child is up"); setInterval(() => {}, 1000);'],
    dir
  );
  assert.equal(r.code, 124, 'expected 124, got ' + r.code + '\n--- output ---\n' + r.out);
  assert.match(r.out, /::warning::hang-guard: attempt 1 passed its 2s ceiling/,
    'the warning must name the attempt and the ceiling, or the log does not say which leg hung');
  assert.match(r.out, /::error::hang-guard: all 1 attempt/,
    'a run where every attempt hung must end in an error line, not a silent 124');

  if (POSIX) {
    const reports = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    assert.ok(reports.length > 0,
      'no diagnostic report was written to ' + dir + '. The report is the only evidence a hang leaves ' +
      'behind, and a guard that kills without collecting it has thrown away the reason it exists.\n' +
      '--- output ---\n' + r.out);
    const report = JSON.parse(fs.readFileSync(path.join(dir, reports[0]), 'utf8'));
    assert.ok(report.header, 'the report must parse as a Node diagnostic report');
    assert.ok(Array.isArray(report.libuv),
      'the report must carry the open-handle list — that is the half of it that names what kept the loop alive');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a command that exits 3 returns 3, not 1 and not 124', () => {
  const dir = tmpdir('three');
  const r = runGuard(
    ['--seconds', '60', '--retries', '0', '--', process.execPath, '-e', 'process.exit(3)'],
    dir
  );
  assert.equal(r.code, 3, 'expected 3, got ' + r.code + '\n--- output ---\n' + r.out);
  assert.doesNotMatch(r.out, /::warning::hang-guard/,
    'a command that failed fast has not hung, so it must not be retried or warned about');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('no `--` separator refuses rather than guessing', () => {
  const dir = tmpdir('nosep');
  const r = runGuard(['--seconds', '60', process.execPath, '-e', 'process.exit(0)'], dir);
  assert.equal(r.code, 2, 'a wrapper that cannot tell its flags from the command\'s must refuse, never run');
  assert.match(r.out, /CANNOT RUN/);
  fs.rmSync(dir, { recursive: true, force: true });
});
