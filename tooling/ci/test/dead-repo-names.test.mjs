// ─────────────────────────────────────────────────────────────────────────────
// dead-repo-names.test.mjs — the mutation test for assert-no-dead-repo-names.
//
// THE GREEN CONTROL COMES FIRST, AND IT IS NOT A FORMALITY. A guard that exits 1
// on everything "catches" every mutation and is worthless; a guard that exits 1
// on nothing is worse, because it reads as a pass. So every case here builds a
// throwaway tree, proves the guard is GREEN on it, then changes exactly one
// thing and requires RED. Without the paired control, a red is evidence of
// nothing.
//
// The tree is synthetic on purpose. Running the guard against the real
// repository would make this test's verdict depend on whatever else is in
// flight — the very coupling that let a dead name sit in renovate.yml for a day.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, '..', 'assert-no-dead-repo-names.mjs');
const REAL_DECL = join(HERE, '..', '..', 'dead-repos.json');

/** The guard's data file, shrunk to what these cases need. Floors are lowered to
 *  match the fixture — the REAL floors are asserted separately below, against the
 *  real declaration, so lowering them here cannot quietly lower them there. */
const DECL = {
  repos: [
    { name: 'Nikatru_Extensions_Public', died: '2026-09-05', wentTo: 'Nikatru_Platform_Public/extensions/' },
    { name: 'Project_Cross_Platform_Apps', died: '2026-08-19', wentTo: 'Nikatru_Platform_Public' },
    { name: 'Project_Cross_Platform_Apps_Private', died: '2026-08-19', wentTo: 'Nikatru_Platform_Private' },
  ],
  allowedSuffixes: ['_GITHUB_PAT'],
  scan: { globs: ['.github/workflows/**/*.yml', 'tooling/**/*.json', 'renovate.json', '**/package.json', 'catalog/**/*.json'] },
  excludedPaths: ['tooling/ci/test/', 'tooling/dead-repos.json'],
  floors: { files: 3, repos: 3 },
};

let root;
const write = (rel, body) => {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
};
const run = () => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
/** Rebuild the clean tree. Every case starts from this exact state. */
const seed = (decl = DECL) => {
  if (root && existsSync(root)) rmSync(root, { recursive: true, force: true });
  root = mkdtempSync(join(tmpdir(), 'dead-repo-names-'));
  write('tooling/dead-repos.json', JSON.stringify(decl, null, 2));
  write('.github/workflows/ci.yml', 'name: ci\njobs:\n  a:\n    runs-on: ubuntu-latest\n');
  write('renovate.json', '{ "extends": ["config:recommended"] }\n');
  write('package.json', '{ "name": "fixture", "private": true }\n');
  write('tooling/some-register.json', '{ "rows": [] }\n');
  write('catalog/apps.json', '{ "apps": [] }\n');
};

before(() => seed());
after(() => { if (root && existsSync(root)) rmSync(root, { recursive: true, force: true }); });

describe('assert-no-dead-repo-names — the green control', () => {
  test('a tree naming no dead repository exits 0', () => {
    seed();
    const { code, out } = run();
    assert.equal(code, 0, `expected a clean tree to pass, got ${code}:\n${out}`);
    assert.match(out, /no live surface names a dead repository/);
  });
});

describe('assert-no-dead-repo-names — the mutations', () => {
  test('THE ORIGINAL DEFECT: a workflow naming a dead repo exits 1', () => {
    seed();
    assert.equal(run().code, 0, 'control must be green before the mutation');
    write('.github/workflows/renovate.yml',
      'name: renovate\njobs:\n  r:\n    steps:\n      - env:\n          RENOVATE_REPOSITORIES: |\n            globalonlinedeveloper/Nikatru_Extensions_Public\n');
    const { code, out } = run();
    assert.equal(code, 1, `a workflow naming a deleted repository must FAIL, got ${code}:\n${out}`);
    assert.match(out, /renovate\.yml/);
    assert.match(out, /Nikatru_Extensions_Public/);
    // The finding must carry the replacement, or the guard refuses without
    // being able to say what to write instead.
    assert.match(out, /Nikatru_Platform_Public\/extensions\//);
  });

  test('a dead name in a machine-read register exits 1', () => {
    seed();
    assert.equal(run().code, 0, 'control must be green before the mutation');
    write('tooling/some-register.json', '{ "rows": [{ "repo": "globalonlinedeveloper/Project_Cross_Platform_Apps" }] }\n');
    const { code, out } = run();
    assert.equal(code, 1, `a register naming a renamed-away repository must FAIL, got ${code}:\n${out}`);
    assert.match(out, /some-register\.json/);
  });

  test('a dead name in a package.json exits 1', () => {
    seed();
    write('services/x/package.json', '{ "repository": "github:globalonlinedeveloper/Nikatru_Extensions_Public" }\n');
    assert.equal(run().code, 1);
  });

  test('THE FALSE POSITIVE THAT WOULD GET THIS GUARD SWITCHED OFF: the vault key is not a repo reference', () => {
    seed();
    write('tooling/some-register.json', '{ "tokenKey": "Project_Cross_Platform_Apps_GITHUB_PAT" }\n');
    const { code, out } = run();
    assert.equal(code, 0, `\`Project_Cross_Platform_Apps_GITHUB_PAT\` is a live vault key, not a dead repo name — it must NOT fail:\n${out}`);
  });

  test('the longest dead name wins, so _Private is not reported as the shorter name', () => {
    seed();
    write('tooling/some-register.json', '{ "repo": "Project_Cross_Platform_Apps_Private" }\n');
    const { code, out } = run();
    assert.equal(code, 1);
    assert.match(out, /Project_Cross_Platform_Apps_Private/);
    assert.doesNotMatch(out, /`Project_Cross_Platform_Apps` \(died/);
  });

  test('prose is OUT OF SCOPE — a dead name in a README does not fail', () => {
    seed();
    write('README.md', 'This repository was called Nikatru_Extensions_Public until 2026-09-05.\n');
    const { code, out } = run();
    assert.equal(code, 0, `a dated record must not be rewritten by this guard:\n${out}`);
  });

  test('the glob metacharacters are ESCAPED — a near-miss filename is not scanned', () => {
    // Pinned because the first version of toRe() shipped an escape function that
    // was a no-op: `.` matched any character, so `catalog/appsXjson` would have
    // been scanned as if it were `catalog/apps.json`. Widening a scan set by
    // accident is the quiet half of the same defect as narrowing it.
    seed();
    write('catalog/appsXjson', '{ "repo": "Nikatru_Extensions_Public" }\n');
    const { code, out } = run();
    assert.equal(code, 0, `a file the globs do not name must not be scanned:\n${out}`);
    // ...and the file the glob DOES name is still scanned.
    write('catalog/apps.json', '{ "repo": "Nikatru_Extensions_Public" }\n');
    assert.equal(run().code, 1, 'the control: the real glob target is still scanned');
  });

  test('an excluded path is excluded, and the exclusion is PRINTED not hidden', () => {
    seed();
    write('tooling/ci/test/fixture-register.json', '{ "repo": "Nikatru_Extensions_Public" }\n');
    const { code, out } = run();
    assert.equal(code, 0);
    assert.match(out, /excluded \(dated records and fixtures, declared not hidden\)/);
    assert.match(out, /tooling\/ci\/test\//);
  });
});

describe('assert-no-dead-repo-names — it cannot be silenced quietly', () => {
  test('emptying the dead list is CANNOT RUN (2), not a pass', () => {
    seed({ ...DECL, repos: [] });
    const { code, out } = run();
    assert.equal(code, 2, `an empty list must refuse, not pass:\n${out}`);
    assert.match(out, /CANNOT RUN/);
  });

  test('emptying the scan set is CANNOT RUN (2), not a pass', () => {
    seed({ ...DECL, scan: { globs: [] } });
    const { code, out } = run();
    assert.equal(code, 2, `a guard with no subject must refuse:\n${out}`);
    assert.match(out, /no subject|CANNOT RUN/);
  });

  test('a row with no `wentTo` is CANNOT RUN (2) — a refusal must name the replacement', () => {
    seed({ ...DECL, repos: [{ name: 'Nikatru_Extensions_Public', died: '2026-09-05' }, ...DECL.repos.slice(1)] });
    const { code, out } = run();
    assert.equal(code, 2);
    assert.match(out, /wentTo/);
  });

  test('a missing declaration file is CANNOT RUN (2)', () => {
    seed();
    rmSync(join(root, 'tooling/dead-repos.json'));
    assert.equal(run().code, 2);
  });

  test('dropping the file floor below what the tree holds is CANNOT RUN (2)', () => {
    seed({ ...DECL, floors: { files: 999, repos: 3 } });
    const { code, out } = run();
    assert.equal(code, 2);
    assert.match(out, /did not prove it still scanned/);
  });
});

describe('assert-no-dead-repo-names — the REAL declaration', () => {
  test('the shipped dead-repos.json is well formed and every row carries its measurement', async () => {
    const { readFileSync } = await import('node:fs');
    const real = JSON.parse(readFileSync(REAL_DECL, 'utf8'));
    assert.ok(Array.isArray(real.repos) && real.repos.length >= 11,
      'the real list must not shrink — a name is never removed once declared dead');
    for (const r of real.repos) {
      assert.match(r.died, /^\d{4}-\d{2}-\d{2}$/, `${r.name}: \`died\` must be a date, not a shrug`);
      assert.ok(r.wentTo?.trim(), `${r.name}: must say where it went`);
      assert.ok(r.measured?.trim(), `${r.name}: must carry the measurement that established it is dead`);
    }
    assert.ok(real.floors?.files >= 8 && real.floors?.repos >= 11,
      'the real floors must not be lowered to make a run go green');
    for (const p of real.excludedPaths ?? []) {
      assert.ok(typeof p === 'string' && p.length, 'every exclusion must be a real path');
    }
    assert.ok(real._excludedPathsWhy?.trim(), 'the exclusion list must state its reasons');
  });
});
