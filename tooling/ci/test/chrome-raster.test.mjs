// ─────────────────────────────────────────────────────────────────────────────
// chrome-raster.test.mjs — render()'s scratch directory is created PRIVATE.
//
// CodeQL #96 (js/insecure-temporary-file, high): the working directory Chrome is
// pointed at (--user-data-dir, and the page it loads from file://) was
// join(tmpdir(), 'nk-raster-<8 hex>') created with mkdirSync({ recursive: true }),
// which silently ADOPTS a directory that already exists at that name and creates a
// new one 0755. mkdtempSync creates a fresh, owner-only directory and never adopts.
//
// HOW, without Chrome: a driver script patches node:fs in its own process (and
// syncs the ESM bindings) BEFORE importing chrome-raster.mjs, so every mkdirSync /
// mkdtempSync the module makes is recorded. CHROME_EXECUTABLE is node itself, which
// refuses Chrome's first flag and exits, so render() throws after doing exactly the
// directory work under test — and after its finally has removed the directory.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RASTER = resolve(HERE, '..', '..', 'store', 'chrome-raster.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-raster-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const DRIVER = [
  "import fs from 'node:fs';",
  "import { syncBuiltinESMExports } from 'node:module';",
  'const calls = [];',
  "for (const op of ['mkdirSync', 'mkdtempSync']) {",
  '  const real = fs[op];',
  '  fs[op] = function (...a) {',
  '    const made = real.apply(this, a);',
  "    calls.push({ op, arg: String(a[0]), made: op === 'mkdtempSync' ? made : String(a[0]) });",
  '    return made;',
  '  };',
  '}',
  'syncBuiltinESMExports();',
  'const { render } = await import(process.env.RASTER_URL);',
  'let threw = null;',
  'try {',
  "  render({ markup: '<svg xmlns=\"http://www.w3.org/2000/svg\"/>', ext: 'svg', out: process.env.RASTER_OUT, width: 4, height: 4 });",
  '} catch (e) {',
  '  threw = String(e && e.message).split(String.fromCharCode(10))[0];',
  '}',
  'process.stdout.write(JSON.stringify({ calls, threw }));',
].join('\n');

describe('chrome-raster · render() works in a fresh private directory (CodeQL #96)', () => {
  test('the scratch directory comes from mkdtempSync in the temp dir, is never mkdir-adopted, and is gone afterwards', () => {
    const shared = mkdtempSync(join(TMP, 'shared-tmp-'));
    const driver = join(TMP, 'driver.mjs');
    writeFileSync(driver, DRIVER);
    const r = spawnSync(process.execPath, [driver], {
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        TMPDIR: shared,
        TEMP: shared,
        TMP: shared,
        CHROME_EXECUTABLE: process.execPath,
        RASTER_URL: pathToFileURL(RASTER).href,
        RASTER_OUT: join(TMP, 'out', 'shot.png'),
      },
    });
    assert.equal(r.status, 0, `driver exit ${r.status}:\n${r.stdout}${r.stderr}`);
    const { calls, threw } = JSON.parse(r.stdout);
    assert.ok(threw, 'render() did not reach the stand-in Chrome, so the directory work was not exercised');
    const inShared = (p) => resolve(dirname(p)) === resolve(shared);
    const adopted = calls.filter((c) => c.op === 'mkdirSync' && inShared(c.arg) && basename(c.arg).startsWith('nk-raster-'));
    assert.deepEqual(adopted, [], 'the scratch directory was made with mkdirSync, which adopts an existing directory');
    const fresh = calls.filter((c) => c.op === 'mkdtempSync' && inShared(c.made));
    assert.equal(fresh.length, 1, `expected one mkdtempSync in the temp dir, saw: ${JSON.stringify(calls)}`);
    assert.match(basename(fresh[0].made), /^nk-raster-[A-Za-z0-9]{6}$/);
    assert.deepEqual(readdirSync(shared), [], 'the scratch directory was left behind');
  });
});
