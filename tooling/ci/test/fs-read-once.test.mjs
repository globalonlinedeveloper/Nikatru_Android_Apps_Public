// ─────────────────────────────────────────────────────────────────────────────
// fs-read-once.test.mjs — a scanner reads each file it scans without taking a
// separate look at the path first.
//
// CodeQL js/file-system-race (#79 #80 #81 #82 #299, 2026-09-11) flagged five
// tree walkers that did `statSync(p).isDirectory()` and then `readFileSync(p)`:
// two looks at one path, between which the file can change. The listing already
// says what each entry is (`listDir(d, { withFileTypes: true })`), so the second
// look is REMOVED rather than guarded. Two more walks in the same files had the
// identical shape without an alert — assert-purchase-path's route-resolver walk
// and assert-screen-set's lib walk — and are held here too, because the spy
// below watches behaviour, not the alert list.
//
// HOW. Each guard runs on the REAL tree under fixtures/fs-spy-preload.mjs, which
// records every check (exists/stat/lstat/access/open by path) and every use
// (read/write/append/open by path) and reports the pairs CodeQL's query flags.
// All five guards are read-only, so running them on the real tree writes nothing.
// Reads of `.mjs`/`.js` files are the module loader bringing the guard itself in,
// not the scan, and are left out of both counts.
//
// The CONTROL block comes first on purpose: "0 flagged pairs" is also exactly
// what a spy that recorded nothing would report, so the spy is shown seeing the
// racy shape before any green below is allowed to mean something.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const CI = resolve(HERE, '..');
const SPY = join(HERE, 'fixtures', 'fs-spy-preload.mjs');

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-fs-once-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** Run `args` under the spy, recording only paths below `under`. */
function spied(args, { cwd = REPO, under = REPO } = {}) {
  const out = join(TMP, `verdict-${seq++}.json`);
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(SPY).href, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, FS_SPY_OUT: out, FS_SPY_UNDER: under },
  });
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  let verdict = null;
  try {
    verdict = JSON.parse(readFileSync(out, 'utf8'));
  } catch (e) {
    assert.fail(`the spy wrote no verdict (exit ${r.status}, ${e.code ?? e.message}):\n${text.slice(-2000)}`);
  }
  return { ...verdict, code: r.status, text };
}

/** A throwaway script in its own directory; returns [scriptPath, dir]. */
function scratchScript(name, body) {
  const dir = mkdtempSync(join(TMP, 'ctl-'));
  const p = join(dir, name);
  writeFileSync(p, body);
  return [p, dir];
}
const onTarget = (v, key) => v[key].filter((x) => x.path.endsWith('/target.txt')).map((x) => `${x.check}->${x.use}`);

describe('CONTROL — the spy sees a check followed by a use', () => {
  test('existsSync, then writeFileSync on the same path, is flagged', () => {
    const [s, dir] = scratchScript(
      'racy-write.mjs',
      "import { existsSync, writeFileSync } from 'node:fs';\nconst p = process.argv[2];\nif (!existsSync(p)) writeFileSync(p, 'x');\n",
    );
    const v = spied([s, join(dir, 'target.txt')], { under: dir });
    assert.equal(v.code, 0, v.text);
    assert.deepEqual(onTarget(v, 'flagged'), ['existsSync->writeFileSync']);
  });

  test('statSync, then readFileSync on the same path, is flagged — the walker shape that was removed', () => {
    const [s, dir] = scratchScript(
      'racy-read.mjs',
      "import { statSync, readFileSync } from 'node:fs';\nconst p = process.argv[2];\nif (!statSync(p).isDirectory()) readFileSync(p, 'utf8');\n",
    );
    writeFileSync(join(dir, 'target.txt'), 'hello');
    const v = spied([s, join(dir, 'target.txt')], { under: dir });
    assert.equal(v.code, 0, v.text);
    assert.deepEqual(onTarget(v, 'flagged'), ['statSync->readFileSync']);
  });

  test('one read with ENOENT as the only miss, then a write, is a use and nothing flagged — the read-once shape', () => {
    const [s, dir] = scratchScript(
      'read-once.mjs',
      "import { readFileSync, writeFileSync } from 'node:fs';\nconst p = process.argv[2];\nlet before = null;\ntry { before = readFileSync(p, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }\nif (before !== 'x') writeFileSync(p, 'x');\n",
    );
    const v = spied([s, join(dir, 'target.txt')], { under: dir });
    assert.equal(v.code, 0, v.text);
    assert.deepEqual(onTarget(v, 'flagged'), []);
    assert.ok(v.uses.some((u) => u.endsWith('/target.txt')), `the spy recorded no use of target.txt: ${JSON.stringify(v.uses)}`);
  });

  test('existsSync, then readFileSync, is recorded as a pair but NOT flagged — the query does not report it', () => {
    const [s, dir] = scratchScript(
      'exists-read.mjs',
      "import { existsSync, readFileSync } from 'node:fs';\nconst p = process.argv[2];\nif (existsSync(p)) readFileSync(p, 'utf8');\n",
    );
    writeFileSync(join(dir, 'target.txt'), 'hello');
    const v = spied([s, join(dir, 'target.txt')], { under: dir });
    assert.equal(v.code, 0, v.text);
    assert.deepEqual(onTarget(v, 'pairs'), ['existsSync->readFileSync']);
    assert.deepEqual(onTarget(v, 'flagged'), []);
  });
});

const SCANNED = (p) => !/\.(?:mjs|cjs|js)$/.test(p);

/** The guard reads at least `atLeast` scanned files, and none after a check of its path. */
function assertReadOnce(guard, args, atLeast) {
  const v = spied([join(CI, guard), ...args]);
  const scanned = v.uses.filter(SCANNED);
  assert.ok(
    scanned.length >= atLeast,
    `COVERAGE LOST — the spy saw ${guard} read ${scanned.length} scanned file(s), expected at least ${atLeast} ` +
      `(exit ${v.code}):\n${v.text.slice(-2000)}`,
  );
  const racy = v.flagged.filter((x) => SCANNED(x.path));
  assert.equal(
    racy.length,
    0,
    `${guard}: ${racy.length} read(s) of a scanned file came after a separate look at its path:\n` +
      racy
        .slice(0, 10)
        .map((x) => `    ${x.check} -> ${x.use}  ${x.path}`)
        .join('\n'),
  );
}

describe('every scanned file is read without a separate look at its path first', () => {
  test('assert-no-hardcoded-strings.mjs — readDartTree (CodeQL #79)', () => {
    assertReadOnce('assert-no-hardcoded-strings.mjs', [], 100);
  });

  test('assert-package-boundaries.mjs — packageImports (CodeQL #80)', () => {
    assertReadOnce('assert-package-boundaries.mjs', [], 50);
  });

  test('assert-purchase-path.mjs — walkLib (CodeQL #81) and the route-resolver walk beside it', () => {
    assertReadOnce('assert-purchase-path.mjs', [REPO], 50);
  });

  test('assert-screen-set.mjs — readAll (CodeQL #82) and the lib walk beside it', () => {
    assertReadOnce('assert-screen-set.mjs', [], 10);
  });

  test('assert-no-store-bundle-copy.mjs — scan (CodeQL #299)', () => {
    assertReadOnce('assert-no-store-bundle-copy.mjs', [REPO], 20);
  });
});
