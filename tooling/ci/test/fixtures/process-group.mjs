// ─────────────────────────────────────────────────────────────────────────────
// process-group.mjs — asking the OPERATING SYSTEM what a guard left running,
// from a test, without asking the guard.
//
// Two guards spawn `flutter` and have to survive a child that outlives its
// parent: assert-launcher-icons (`flutter create`) and assert-mutation-proofs
// (`flutter test`). Both run the child DETACHED so it leads its own process
// group, and both kill the group rather than the pid, because the thing that
// stalls a pipe-reading spawn is a GRANDCHILD holding the output.
//
// ⚠️ DELIBERATELY INDEPENDENT OF THE CODE UNDER TEST. A test that asked the
// guard what it had left running would be certifying the guard's own answer.
// These call `pgrep` and `kill(pid, 0)` directly, so the verdict comes from the
// kernel's process table.
//
// 🔴 WHY `goneWithin` AND NOT A NAME. On 2026-09-12 a CI run on main went red —
// and took the web deploy down with it, because a red ci-gate blocks the deploy
// — on this assertion in mutation-proofs.test.mjs:
//
//     assert.match(out, /still running in its process group, killed: .*sleep/);
//
// The fake `flutter` runs `sleep 40 &` and exits immediately. What the guard
// actually printed that morning was:
//
//     green control exit=0 (0s) — still running in its process group, killed: 36721 flutter
//
// 36721 IS the sleeper: the shell had forked it, and `execve("sleep")` had not
// landed yet, so the child still carried its parent's `comm` — the fake's own
// name, `flutter`. `pgrep -l` reports `comm`, so the survivor's NAME is decided
// by whether the scan falls inside the fork→exec window. It is a scheduling
// outcome, not a property of the guard, and the same code had passed twenty
// minutes earlier.
//
// So a process's NAME is not evidence. Its DEATH is: `goneWithin` polls the
// kernel until the pid is ESRCH, which is the property the name was standing in
// for — the orphan did not outlive the guard — and which no race can flip.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';

/** POSIX only — a process group is the mechanism these helpers observe, and
 *  Windows has none. Tests skip on it rather than assert something weaker. */
export const POSIX = process.platform !== 'win32';

/**
 * Every process still in `pgid`, as `pgrep -l` lists them (`<pid> <comm>`).
 *
 * ⚠️ The NAMES in here are diagnostic only — see the fork→exec note above.
 * Assert on membership or on `goneWithin`, never on what a member is called.
 */
export function groupMembers(pgid) {
  const r = spawnSync('pgrep', ['-l', '-g', String(pgid)], { encoding: 'utf8', timeout: 5_000 });
  if (r.error) return [`(pgrep unavailable: ${r.error.code})`];
  return (r.stdout ?? '').trim().split('\n').filter(Boolean);
}

/**
 * True once `pid` is gone, polling until `ms` elapses.
 *
 * It waits rather than checking once because a SIGKILLed orphan is reparented
 * before it is reaped, and for that window `kill(pid, 0)` still succeeds on the
 * zombie. Checking once would trade the name race for a reaping race.
 */
export function goneWithin(pid, ms) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (e) {
      if (e.code === 'ESRCH') return true;
    }
    if (Date.now() > end) return false;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
}
