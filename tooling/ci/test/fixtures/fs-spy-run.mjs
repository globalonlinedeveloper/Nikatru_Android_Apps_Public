// ─────────────────────────────────────────────────────────────────────────────
// fs-spy-run.mjs — TEST-ONLY. Run a script under fixtures/fs-spy-preload.mjs and return
// its exit, its output and the spy's verdict, so a test asserts on the verdict rather
// than re-implementing the spawn-and-parse. The preload itself is never imported: it is
// passed with --import to the CHILD, so the test process's own fs stays unpatched.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SPY = fileURLToPath(new URL('./fs-spy-preload.mjs', import.meta.url));

/** node --import <spy> ...args, recording only paths under 'under'. */
export function spiedRun(args, { cwd, under, env = process.env, timeout = 180_000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nikatru-fs-spy-'));
  const out = join(dir, 'verdict.json');
  try {
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(SPY).href, ...args], {
      cwd,
      encoding: 'utf8',
      timeout,
      env: { ...env, FS_SPY_OUT: out, FS_SPY_UNDER: under },
    });
    const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    let verdict = null;
    try {
      verdict = JSON.parse(readFileSync(out, 'utf8'));
    } catch (e) {
      throw new Error(`the spy wrote no verdict (exit ${r.status}, ${e.code ?? e.message}):\n${text.slice(-2000)}`);
    }
    return { code: r.status, text, verdict };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A path suffix in the form the spy records paths: forward slashes, lower-cased on Windows
 *  ONLY. Lower-casing everywhere would make a mixed-case suffix never match on Linux, and an
 *  assertion that nothing matched would then pass without looking. */
export const pathKey = (suffix) => (process.platform === 'win32' ? String(suffix).toLowerCase() : String(suffix));

/** Pairs on paths ending with 'suffix' (forward slashes), made within one function. */
export const racyOn = (verdict, suffix, { key = 'flagged', sameFunctionOnly = true } = {}) =>
  verdict[key].filter((x) => x.path.endsWith(pathKey(suffix)) && (!sameFunctionOnly || x.sameFunction));
