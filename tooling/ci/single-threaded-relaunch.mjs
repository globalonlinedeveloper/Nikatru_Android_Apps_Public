// ─────────────────────────────────────────────────────────────────────────────
// single-threaded-relaunch.mjs — THE ONE WAY a guard in tooling/ci does its work
// with V8 background tasks OFF, so that its process can always EXIT.
//
// 🔴 WHY THIS EXISTS. assert-launcher-icons.mjs hung CI about twelve times AFTER
// printing its complete verdict (runs 34442894882 and 34553250403 cancelled at
// 25 min; 34556943131 caught by a test bound with `status: null` — the guard
// itself alive, not a descendant holding a pipe). It was stuck INSIDE
// `process.exit`: Node's shutdown joins the V8 worker threads while a concurrent
// Maglev/Sparkplug compile on one of them waits for a main-thread GC that can no
// longer run — nodejs/node#54918, open, reported on 24.18.1 4-vCPU CI runners. A
// natural exit (`exitCode`) deadlocks too. Reproduced on Linux: amplified with
// --stress-concurrent-allocation it hung 3 of 12 runs, every thread in
// futex_do_wait, no descendants. Evidence: research/launcher-icons-hang-2026-09-11.
//
// THE FIX IS A FLAG, NOT A TIMEOUT. With --single-threaded V8 posts no background
// compile or GC task at all, so the wait cycle has no second party. Pixel loops,
// zip inflation and ELF walks are exactly the hot code those background compiles
// exist for, so every guard that decodes images or archives is exposed — whether
// or not its hang has been seen yet. A hang that has not happened is the class.
//
// It was written INLINE in assert-launcher-icons.mjs first (#619, e29745f7) and
// was lifted here UNCHANGED IN BEHAVIOUR when the class sweep of 2026-09-11 found
// the same exposure in assert-elf-page-alignment.mjs, assert-listing-assets.mjs
// and assert-stamp-brand-assets.mjs. Four inline copies of a relaunch drift in
// the one way that cannot be seen from a green run: which of them still passes
// its arguments, its execArgv and its exit status through.
//
// HOW IT IS USED — the first statement after a guard's imports:
//     relaunchSingleThreaded(import.meta.url, coverageLost);
// In the process CI started, it spawns the same script with --single-threaded
// prepended (execArgv and argv passed through, stdio inherited) and exits with
// the child's status; in that child it returns at once and the guard runs. The
// relaunching parent imports but computes nothing, so it gives V8 nothing to
// compile in the background. It carries no timeout of its own: a second bound
// would have to be kept in step with each guard's own.
//
// "I COULD NOT LOOK" IS EXIT 2, NEVER 0 AND NEVER 1. A relaunch that cannot start,
// or a working process killed by a signal before it delivered a verdict, is
// handed to the CALLER's COVERAGE LOST reporter — the caller frames it and exits
// 2. This module prints nothing of its own and exits only as a backstop, if that
// reporter ever returns.
//
// Not a guard — it scans nothing and asserts nothing about any tree. Its failing
// cases are in tooling/ci/test/single-threaded-relaunch.test.mjs, and each guard
// that imports it pins the relaunch in its own test file: spawned exactly as CI
// runs it, the guard must report `V8 background tasks: OFF (--single-threaded)`.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SINGLE_THREADED = '--single-threaded';

/** True in the process that does the work. */
export const isSingleThreaded = () => process.execArgv.includes(SINGLE_THREADED);

/**
 * Relaunch the calling script with --single-threaded unless already so, and exit
 * with the child's status. Returns only in the single-threaded child.
 *
 * @param {string}   moduleUrl `import.meta.url` of the guard.
 * @param {(lines: string[]) => never} onLost the guard's COVERAGE LOST reporter;
 *        expected to exit 2. Called when the relaunch cannot run or the working
 *        process ends without an exit status.
 */
export function relaunchSingleThreaded(moduleUrl, onLost) {
  if (isSingleThreaded()) return;
  const child = spawnSync(
    process.execPath,
    [SINGLE_THREADED, ...process.execArgv, fileURLToPath(moduleUrl), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  if (child.error) {
    onLost([
      `could not relaunch with ${SINGLE_THREADED}: ${child.error.message}`,
      'The work runs in a single-threaded child so that this process cannot deadlock at exit',
      '(nodejs/node#54918). With no child there is no verdict, and no verdict is not a pass.',
    ]);
    process.exit(2);
  }
  if (child.status === null) {
    onLost([
      `the working process was killed by ${child.signal ?? 'an unknown signal'} before it delivered a verdict.`,
      'Whatever it printed above is incomplete; a check that did not finish checked nothing.',
    ]);
    process.exit(2);
  }
  process.exit(child.status);
}

/** The line a guard prints so its test can pin the relaunch. Read from this
 *  process's own start-up flags, never asserted: remove the relaunch and it says
 *  ON. */
export function backgroundTasksNote() {
  return (
    `V8 background tasks: ${isSingleThreaded() ? 'OFF (--single-threaded)' : 'ON'} — ` +
    'with them on, a background compile can deadlock this process at exit (nodejs/node#54918)'
  );
}
