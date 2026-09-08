// ─────────────────────────────────────────────────────────────────────────────
// start-here.test.mjs — tooling/scripts/gen-start-here.mjs must WRITE the card
// the tree implies, must REFUSE a hand edit, and must refuse a tree it cannot
// measure. Three things, and the third is the one that is normally missing.
//
// 🔴 WHY A NEGATIVE TEST AND NOT A SMOKE TEST. `START-HERE.md` is the first file
// a cold session reads and the ONLY orientation it gets, so its failure mode is
// not "the build breaks", it is "every session after this one believes something
// untrue". The two ways that happens are a hand edit and a stale regeneration,
// and `--check` is the guard against both — which makes `--check`'s ABILITY TO
// EXIT 1 the property worth testing. A test that only ran the generator and read
// the file would pass identically against a `--check` that returned 0 always.
//
// ⚠️ THE FIXTURE IS A REAL GIT REPOSITORY WITH REAL FLOORS CLEARED. The generator
// reads the INDEX (`git ls-files --cached`) and refuses with exit 2 under any of
// its declared floors, so a small fixture would exercise nothing but the refusal
// branch — which is worth exactly one case, and is the last one here. The floors
// are READ from the generator rather than typed, so a floor that moves moves this
// fixture with it.
//
// ⚠️ AND THE FIXTURE IS NOT THIS REPOSITORY. `--check` is read-only, but the
// write path is not, and `node --test` runs files concurrently: a case that wrote
// the real `START-HERE.md` would be racing every other suite in the run. Nothing
// here touches the tree it is checked into.
//
// Run:  node --test "tooling/ci/test/start-here.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GEN_SRC = resolve(REPO, 'tooling', 'scripts', 'gen-start-here.mjs');

/** The generator's declared floors, read out of its source. A fixture built from
 *  numbers typed here would drift silently the day a floor is raised, and would
 *  then be testing the COVERAGE LOST branch while reporting on the happy one. */
function floors() {
  const src = readFileSync(GEN_SRC, 'utf8');
  const m = src.match(/const floors = (\{[^}]*\});/);
  assert.ok(m, 'gen-start-here.mjs no longer declares `const floors = { … };` — this file is reading the wrong thing');
  const out = {};
  for (const pair of m[1].replace(/[{}]/g, '').split(',')) {
    const [k, v] = pair.split(':').map((x) => x.trim());
    if (k) out[k] = Number(v);
  }
  return out;
}
const FLOORS = floors();

let BASE, ROOT;

const git = (where, ...args) => {
  const r = spawnSync('git', ['-C', where, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture setup failed: git ${args.join(' ')} -> ${r.status} ${r.stderr}`);
  return r.stdout;
};

/** Six redirecting git variables stripped, for the reason `repo-git.mjs` records:
 *  git EXPORTS them into every hook process and they BEAT `-C`, so a generator
 *  spawned from inside a commit would read the committing repo's index. */
function run(where, ...argv) {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  const r = spawnSync(process.execPath, [join(where, 'tooling', 'scripts', 'gen-start-here.mjs'), ...argv], { cwd: where, env, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** A workflow with a `ci-gate` job whose `needs:` list clears the gateNeeds
 *  floor. Written in the BLOCK form on purpose: the generator reads it through
 *  the shared `workflow-scan.mjs`, and a fixture that used a form the shared
 *  parser handles differently would be testing a parser this repo does not use. */
function ciYml(needs) {
  const lines = ['name: ci', 'on: [push]', 'jobs:'];
  for (const n of needs) lines.push(`  ${n}:`, '    runs-on: ubuntu-24.04', '    steps:', '      - run: echo ok');
  lines.push('  ci-gate:', '    runs-on: ubuntu-24.04', '    needs:');
  for (const n of needs) lines.push(`      - ${n}`);
  lines.push('    steps:', '      - run: echo gate');
  return `${lines.join('\n')}\n`;
}

function buildFixture(root, { full = true } = {}) {
  mkdirSync(join(root, 'apps', 'demo'), { recursive: true });
  mkdirSync(join(root, 'tooling', 'scripts'), { recursive: true });
  mkdirSync(join(root, 'tooling', 'ci', 'test'), { recursive: true });
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, 'AGENTS.md'), '# fixture agents card\n');
  writeFileSync(join(root, 'apps', 'demo', 'app.md'), 'fixture app\n');

  const needs = Array.from({ length: Math.max(FLOORS.gateNeeds, 3) }, (_, i) => `lane-${i}`);
  writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), ciYml(needs));

  if (!full) return;

  for (let i = 0; i < FLOORS.workflows + 2; i += 1) {
    writeFileSync(join(root, '.github', 'workflows', `w-${i}.yml`), 'name: w\non: [push]\njobs:\n  j:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo ok\n');
  }
  for (let i = 0; i < FLOORS.guards + 5; i += 1) writeFileSync(join(root, 'tooling', 'ci', `assert-fixture-${i}.mjs`), '// fixture guard\n');
  for (let i = 0; i < FLOORS.guardTests + 5; i += 1) writeFileSync(join(root, 'tooling', 'ci', 'test', `fixture-${i}.test.mjs`), '// fixture test\n');
  for (let i = 0; i < Math.max(FLOORS.pkgs + 2, 6); i += 1) {
    mkdirSync(join(root, 'packages', `p-${i}`), { recursive: true });
    writeFileSync(join(root, 'packages', `p-${i}`, 'pubspec.yaml'), 'name: p\n');
  }
  /* topDirs counts non-dot top-level directories, so the fixture needs at least
     the floor's worth of them, and enough files overall to clear `tracked`. */
  const extraDirs = ['services', 'sites', 'extensions', 'contracts', 'catalog', 'docs', 'scripts'];
  for (const d of extraDirs) {
    mkdirSync(join(root, d, 'one'), { recursive: true });
    writeFileSync(join(root, d, 'one', 'f.md'), `fixture ${d}\n`);
  }
  let written = 0;
  const perDir = 60;
  for (let d = 0; written < FLOORS.tracked + 50; d += 1) {
    const dir = join(root, 'docs', `filler-${d}`);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < perDir; i += 1) { writeFileSync(join(dir, `f-${i}.md`), `filler ${d}/${i}\n`); written += 1; }
  }
}

before(() => {
  BASE = mkdtempSync(join(tmpdir(), 'nikatru-starthere-'));
  ROOT = join(BASE, 'Fixture_Public');
  buildFixture(ROOT);
  git(ROOT, 'init', '-q');
  git(ROOT, 'config', 'user.email', 'fixture@example.test');
  git(ROOT, 'config', 'user.name', 'fixture');
  git(ROOT, 'config', 'commit.gpgsign', 'false');
  git(ROOT, 'add', '-A');
  git(ROOT, 'commit', '-q', '-m', 'fixture', '--no-gpg-sign');

  /* The generator and the ONE module it imports, copied in after the commit. */
  cpSync(GEN_SRC, join(ROOT, 'tooling', 'scripts', 'gen-start-here.mjs'));
  cpSync(resolve(REPO, 'tooling', 'ci', 'workflow-scan.mjs'), join(ROOT, 'tooling', 'ci', 'workflow-scan.mjs'));
  cpSync(resolve(REPO, 'tooling', 'ci', 'tree-walk.mjs'), join(ROOT, 'tooling', 'ci', 'tree-walk.mjs'));
});

after(() => { rmSync(BASE, { recursive: true, force: true }); });

test('it WRITES a card, and the card is inside the 4 KiB the cap allows', () => {
  const r = run(ROOT);
  assert.equal(r.code, 0, `the generator must succeed over a tree above every floor: ${r.out}`);
  assert.match(r.out, /gen-start-here — \d+ tracked file\(s\), \d+ top dir\(s\), \d+ guard\(s\), ci-gate needs \d+ job\(s\)/);
  const card = readFileSync(join(ROOT, 'START-HERE.md'), 'utf8');
  assert.ok(Buffer.byteLength(card, 'utf8') <= 4096, `the card must fit the cap check-agent-docs enforces; it is ${Buffer.byteLength(card, 'utf8')} bytes`);
  /* The counts are INTERPOLATED, not narrated: the card must carry the same
     ci-gate figure the generator printed, or the two are reading different trees. */
  const needs = r.out.match(/ci-gate needs (\d+) job\(s\)/)[1];
  assert.ok(card.includes(`it needs ${needs} job(s) green`), `the card must carry the measured gate figure. Card:\n${card}`);
});

test('--check is GREEN on the card it just wrote', () => {
  const r = run(ROOT, '--check');
  assert.equal(r.code, 0, `green control, or the case below proves nothing: ${r.out}`);
  assert.match(r.out, /ok {2}START-HERE\.md is what the tree generates/);
});

test('--check EXITS 1 on a hand edit, and says the file is generated', () => {
  const abs = join(ROOT, 'START-HERE.md');
  const keep = readFileSync(abs, 'utf8');
  writeFileSync(abs, `${keep}\nA sentence somebody typed into a generated file.\n`);
  try {
    const r = run(ROOT, '--check');
    assert.equal(r.code, 1, `a hand edit must FAIL the check: ${r.out}`);
    assert.match(r.out, /differs from what the tree generates/);
    assert.match(r.out, /Never hand-edit it/);
  } finally {
    writeFileSync(abs, keep);
  }
  assert.equal(run(ROOT, '--check').code, 0, 'restored, the check must be green again');
});

test('--check EXITS 1 when the TREE moved and the card did not', () => {
  /* The other half, and the one a hand-edit test alone would miss: nobody typed
     into the file, the repository grew, and the card is now describing a tree
     that no longer exists. This is how `NOW.md` came to claim 73 rows over 107. */
  const abs = join(ROOT, 'START-HERE.md');
  const keep = readFileSync(abs, 'utf8');
  const added = join(ROOT, 'tooling', 'ci', 'assert-fixture-new-guard.mjs');
  writeFileSync(added, '// a guard that arrived after the card was written\n');
  git(ROOT, 'add', '--', 'tooling/ci/assert-fixture-new-guard.mjs');
  try {
    const r = run(ROOT, '--check');
    assert.equal(r.code, 1, `a card describing a stale tree must FAIL, or it can go stale silently: ${r.out}`);
    assert.match(r.out, /differs from what the tree generates/);
  } finally {
    git(ROOT, 'rm', '-q', '-f', '--cached', '--', 'tooling/ci/assert-fixture-new-guard.mjs');
    rmSync(added, { force: true });
    writeFileSync(abs, keep);
  }
  assert.equal(run(ROOT, '--check').code, 0, 'restored, the check must be green again');
});

test('a tree under the floors is COVERAGE LOST — exit 2, never a pass and never a card', () => {
  const thin = join(BASE, 'Thin_Public');
  buildFixture(thin, { full: false });
  git(thin, 'init', '-q');
  git(thin, 'config', 'user.email', 'fixture@example.test');
  git(thin, 'config', 'user.name', 'fixture');
  git(thin, 'config', 'commit.gpgsign', 'false');
  git(thin, 'add', '-A');
  git(thin, 'commit', '-q', '-m', 'thin', '--no-gpg-sign');
  cpSync(GEN_SRC, join(thin, 'tooling', 'scripts', 'gen-start-here.mjs'));
  mkdirSync(join(thin, 'tooling', 'ci'), { recursive: true });
  cpSync(resolve(REPO, 'tooling', 'ci', 'workflow-scan.mjs'), join(thin, 'tooling', 'ci', 'workflow-scan.mjs'));
  cpSync(resolve(REPO, 'tooling', 'ci', 'tree-walk.mjs'), join(thin, 'tooling', 'ci', 'tree-walk.mjs'));

  const r = run(thin);
  assert.equal(r.code, 2, `a tree it cannot measure must REFUSE, not write a confident wrong card: ${r.out}`);
  assert.match(r.out, /COVERAGE LOST/);
  assert.match(r.out, /A floor is a declared minimum/);
  assert.equal(existsSyncSafe(join(thin, 'START-HERE.md')), false, 'a refused run must not leave a card behind');
});

function existsSyncSafe(p) {
  try { readFileSync(p); return true; } catch { return false; }
}

test('a tree missing a sentinel is COVERAGE LOST — exit 2, and it names the sentinel', () => {
  const nope = join(BASE, 'NotThisRepo');
  mkdirSync(join(nope, 'tooling', 'scripts'), { recursive: true });
  mkdirSync(join(nope, 'tooling', 'ci'), { recursive: true });
  cpSync(GEN_SRC, join(nope, 'tooling', 'scripts', 'gen-start-here.mjs'));
  /* The two imported modules are copied in even though this tree is meant to be
     REJECTED, and the reason is a real property of ESM rather than tidiness: a
     static import is resolved before the first line of the module body, so a
     fixture without them dies with ERR_MODULE_NOT_FOUND and exit 1 — which looks
     nothing like the refusal this case is about, and would have been recorded as
     one. Measured while writing this file. */
  cpSync(resolve(REPO, 'tooling', 'ci', 'workflow-scan.mjs'), join(nope, 'tooling', 'ci', 'workflow-scan.mjs'));
  cpSync(resolve(REPO, 'tooling', 'ci', 'tree-walk.mjs'), join(nope, 'tooling', 'ci', 'tree-walk.mjs'));
  const r = run(nope);
  assert.equal(r.code, 2, `a tree that is not this repository must REFUSE: ${r.out}`);
  assert.match(r.out, /COVERAGE LOST/);
  assert.match(r.out, /does not look like Nikatru_Platform_Public \(missing/);
});
