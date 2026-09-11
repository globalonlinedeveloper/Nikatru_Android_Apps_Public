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
// HOW IT IS USED — the first statements after a guard's imports:
//     const relaunched = relaunchSingleThreaded(import.meta.url, process.argv.slice(2), coverageLost);
//     if (relaunched !== null) process.exit(relaunched);
// In the process CI started, it spawns the same script with --single-threaded
// prepended (execArgv and the arguments passed through, stdio inherited) and
// returns the child's status for the guard to exit with; in that child it returns
// null at once and the guard runs. The
// relaunching parent imports but computes nothing, so it gives V8 nothing to
// compile in the background. It carries no timeout of its own: a second bound
// would have to be kept in step with each guard's own.
//
// ⚠️ THE RELAUNCHING PARENT IS NOT IMMUNE, AND THAT WAS MEASURED (2026-09-11).
// It still runs with background tasks on; it is safe only because it gives them
// nothing to do. With default flags its worker threads burned 0 CPU ticks on
// every measured run (elf 8/8, stamp 8/8). But run the guard as
// `node --stress-concurrent-allocation <guard>` and the flag lives in the
// PARENT's own startup too: the amplifier posts background allocation tasks to
// the idle parent (16-100 ticks), and that parent then hung at exit in 4 of 12
// and 1 of 24 elf runs, AFTER the single-threaded child had printed its whole
// verdict. The work itself, stressed on its own (`--single-threaded
// --stress-concurrent-allocation`), hung 0 of 12 for elf, stamp and listing.
// So the amplifier cannot prove the parent safe; the zero-tick measurement is
// the evidence it rests on. The shape with no parent at all is
// `node --single-threaded <guard>` in the workflow step, where this module
// returns at once.
//
// "I COULD NOT LOOK" IS EXIT 2, NEVER 0 AND NEVER 1. A relaunch that cannot start,
// or a working process killed by a signal before it delivered a verdict, is
// handed to the CALLER's COVERAGE LOST reporter, which frames it, and 2 is
// returned for the caller to exit with even if that reporter returns. This module
// prints nothing and exits nothing of its own.
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
 * Relaunch the calling script with --single-threaded unless it already is.
 *
 * Returns `null` in the process that should do the work (it is single-threaded),
 * and otherwise the exit status the CALLER must exit with: the child's own status,
 * or 2 when the relaunch could not run or the child ended without one.
 *
 * It never exits and never reads the process's arguments itself; the caller owns
 * both. That keeps it a library in the sense assert-guards-refuse-empty checks: that
 * guard classifies a file whose code exits or reads argv as a PROGRAM, runs it
 * against an empty tree, and on 2026-09-11 measured the first version of this module,
 * which did both, exiting 0 there with no output. A program that passes over nothing
 * is the defect that guard exists for, so the contract changed rather than the list.
 *
 * @param {string}   moduleUrl `import.meta.url` of the guard.
 * @param {string[]} args      the guard's own arguments, passed through unchanged.
 * @param {(lines: string[]) => void} onLost the guard's COVERAGE LOST reporter.
 *        Called when the relaunch cannot run or the working process ends without an
 *        exit status. 2 is returned whether or not it exits.
 * @returns {number|null}
 */
export function relaunchSingleThreaded(moduleUrl, args, onLost) {
  if (isSingleThreaded()) return null;
  const child = spawnSync(process.execPath, [SINGLE_THREADED, ...process.execArgv, fileURLToPath(moduleUrl), ...args], {
    stdio: 'inherit',
  });
  if (child.error) {
    onLost([
      `could not relaunch with ${SINGLE_THREADED}: ${child.error.message}`,
      'The work runs in a single-threaded child so that this process cannot deadlock at exit',
      '(nodejs/node#54918). With no child there is no verdict, and no verdict is not a pass.',
    ]);
    return 2;
  }
  if (child.status === null) {
    onLost([
      `the working process was killed by ${child.signal ?? 'an unknown signal'} before it delivered a verdict.`,
      'Whatever it printed above is incomplete; a check that did not finish checked nothing.',
    ]);
    return 2;
  }
  return child.status;
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
