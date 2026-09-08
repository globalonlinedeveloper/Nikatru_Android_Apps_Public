// ─────────────────────────────────────────────────────────────────────────────
// public-citations-shards.test.mjs — assert-public-citations.mjs must read a
// SHARDED private spec, and must still refuse when a declared shard is absent.
//
// 🔴 THE DEFECT, MEASURED BEFORE THIS FILE EXISTED. The guard built its citation
// resolution table with a ONE-LEVEL `readdirSync(Private/requirements)` taking
// `*.json`. Private S1 phase 4 splits five registers into 37 shard files under
// `requirements/<register>/NN-<topic>.json` and declares them in a `shards` block
// in `requirements/index.json`. Against that tree the one-level scan saw 6 files
// instead of 11 and parsed 233 origin refs against `ORIGIN_FLOOR` of 300, so the
// guard exited 2 — and because it runs in the PRIVATE repo's pre-commit hook, it
// refused every private commit until the sharding was reverted. A whole built,
// verified, eleven-guard-green phase was rolled back for it
// (Private research/full-read-2026-09-08/S3-structure-apply-run2-2026-09-08.md
// sections 2.2 to 2.5).
//
// ⚠️ THE FLOOR IS NOT THE DEFECT AND IS NOT TOUCHED. 300 stays. A thin resolution
// table silently accepts a dead citation, which is the thing this guard exists to
// make impossible; refusing over one is the floor WORKING. What was wrong is that
// the scan produced a thin table from a complete corpus. So the cases below prove
// two different sentences: the sharded corpus RESOLVES (exit 0, the floor cleared
// honestly), and a sharded corpus MISSING a declared shard still REFUSES (exit 2).
// A fix that only did the first would be a weakening wearing a fix's clothes.
//
// ── EVERY CASE CARRIES ITS OWN MUTANT ────────────────────────────────────────
// A fixture passing is not a guard working. Each case that asserts a pass runs a
// MUTATED COPY of the guard over the SAME fixture and requires it to fail, and
// each case that asserts a refusal runs the same fixture with the refusal's
// subject removed and requires it to pass. The mutation for the descent is a
// deletion of the `SHARD DESCENT BEGIN … END` region, which is written to be
// deletable precisely so this file can put the defect back and watch it bite.
//
// ⚠️ THE FIXTURE IS A REAL TREE, NOT A STUB. The guard resolves its own workspace
// anchor (`Projects/` + `nikatru/` side by side), its own repo root (`.git`), its
// own private corpus (the `_Public` → `_Private` sibling) and enumerates its
// subject with `git ls-files` against a floor of 800 tracked files. Every one of
// those is built here, because a fixture that bypassed them would be testing a
// different program. That is what the 810 filler files are for.
//
// Run:  node --test "tooling/ci/test/public-citations-shards.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..'); // tooling/ci/test -> repo root
const GUARD_SRC = resolve(REPO, 'tooling', 'scripts', 'assert-public-citations.mjs');
const GIT_HELPER_SRC = resolve(REPO, 'tooling', 'scripts', 'repo-git.mjs');

/* The guard's own floor. Read from the source rather than typed here, so that a
   future change to the floor cannot leave this file quietly building a fixture
   below it and reporting a refusal as if it were about sharding. */
const ORIGIN_FLOOR = (() => {
  const m = /const ORIGIN_FLOOR = (\d+);/.exec(readFileSync(GUARD_SRC, 'utf8'));
  assert.ok(m, 'assert-public-citations.mjs no longer declares `const ORIGIN_FLOOR = <n>;` — this file is reading the wrong thing');
  return Number(m[1]);
})();
const FILE_FLOOR = (() => {
  const m = /const FILE_FLOOR = (\d+);/.exec(readFileSync(GUARD_SRC, 'utf8'));
  assert.ok(m, 'assert-public-citations.mjs no longer declares `const FILE_FLOOR = <n>;`');
  return Number(m[1]);
})();

let BASE;      // the throwaway workspace
let PRODUCTS;  // <BASE>/Projects
let PUB;       // <BASE>/Projects/Fixture_Public — a real git repo, over the file floor
let PRIV;      // <BASE>/Projects/Fixture_Private — the corpus, rebuilt per case
let SPEC;      // <PRIV>/requirements

const git = (where, ...args) => {
  const r = spawnSync('git', ['-C', where, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture setup failed: git ${args.join(' ')} -> ${r.status} ${r.stderr}`);
  return r.stdout;
};

/** An entry carrying one `origin` in the shape the real registers use — `[2]C-6`
 *  — which is the only string in a spec file this guard looks at. */
const entry = (n) => ({ id: `INV-${n}`, claim: `fixture claim ${n}`, origin: `[2]C-${n}` });

/** Reset the corpus to nothing but an empty `requirements/`, so each case declares
 *  its whole layout and no case can pass on a leftover from the one before it. */
function freshSpec() {
  rmSync(PRIV, { recursive: true, force: true });
  mkdirSync(SPEC, { recursive: true });
}

const writeJson = (abs, value) => {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(value, null, 2), 'utf8');
};

/** THE FLAT LAYOUT — every register a single top-level file. This is what the
 *  corpus looks like today and what the one-level scan was written for. */
function buildFlatCorpus(originCount) {
  freshSpec();
  writeJson(join(SPEC, 'index.json'), { registers: { 'invariants.json': { kind: 'invariant', entries: originCount } } });
  writeJson(join(SPEC, 'invariants.json'), Array.from({ length: originCount }, (_, i) => entry(i + 1)));
}

/** THE SHARDED LAYOUT — the registers live one level down and the `shards` block
 *  declares them, exactly as the saved phase-4 patch writes it, `_`-prefixed prose
 *  keys and all. NOTHING is left at the top level except `index.json`, which is
 *  the whole point: a one-level scan of this tree parses ZERO origins. */
function buildShardedCorpus({ shardCount = 5, perShard = 80, register = 'invariants' } = {}) {
  freshSpec();
  const files = [];
  let n = 0;
  for (let s = 1; s <= shardCount; s += 1) {
    const name = `${String(s).padStart(2, '0')}-stage-${s}.json`;
    files.push(name);
    writeJson(join(SPEC, register, name), Array.from({ length: perShard }, () => entry(++n)));
  }
  writeJson(join(SPEC, 'index.json'), {
    registers: { [`${register}.json`]: { kind: 'invariant', entries: n, sharded: `${register}/` } },
    shards: {
      _what: 'REGISTER SHARDING, fixture. The key is the register; the value is its shard file list.',
      _rule: 'A shard file name is STABLE FOREVER.',
      _guard: 'assert-requirements-index.mjs limbs SHARD SIZE and SHARD UNIQUENESS read this block.',
      _generated: 'written by the fixture, never typed',
      [register]: files,
    },
  });
  return { register, files, origins: n };
}

/** Run a guard file against the fixture, from the fixture repo, with the caller's
 *  environment neutralised: `NIKATRU_PRIVATE_ROOT` is the guard's first candidate
 *  root and a copy of it inherited from the machine running the suite would point
 *  every case at the REAL corpus and pass over nothing. */
function runGuard(file = 'assert-public-citations.mjs') {
  const env = { ...process.env };
  delete env.NIKATRU_PRIVATE_ROOT;
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  const r = spawnSync(process.execPath, [join(PUB, 'tooling', 'scripts', file)], { cwd: PUB, env, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** The mutant: the guard with the SHARD DESCENT region deleted, which is the guard
 *  exactly as it stood before 2026-09-08. Written into the fixture repo beside the
 *  real one so it resolves the same roots and the same helper module. */
function writeDescentMutant() {
  const src = readFileSync(GUARD_SRC, 'utf8');
  const begin = src.indexOf('/* ── SHARD DESCENT BEGIN');
  const end = src.indexOf('SHARD DESCENT END', begin);
  assert.notEqual(begin, -1, 'the SHARD DESCENT BEGIN marker is gone from the guard — this file can no longer build its mutant, and every "the fix matters" case below would be asserting nothing');
  assert.notEqual(end, -1, 'the SHARD DESCENT END marker is gone from the guard');
  const endOfLine = src.indexOf('\n', end);
  const mutant = src.slice(0, begin) + src.slice(endOfLine + 1);
  assert.notEqual(mutant, src, 'the mutation changed nothing');
  assert.ok(!mutant.includes('declaredShardFiles(SPEC)'), 'the mutant still calls the shard reader, so the region deleted was not the one that does the work');
  writeFileSync(join(PUB, 'tooling', 'scripts', 'mutant-one-level.mjs'), mutant, 'utf8');
}

before(() => {
  BASE = mkdtempSync(join(tmpdir(), 'nikatru-shards-'));
  PRODUCTS = join(BASE, 'Projects');
  PUB = join(PRODUCTS, 'Fixture_Public');
  PRIV = join(PRODUCTS, 'Fixture_Private');
  SPEC = join(PRIV, 'requirements');

  // The workspace anchor the guard searches for: `Projects/` and `nikatru/` side by side.
  mkdirSync(join(BASE, 'nikatru'), { recursive: true });
  writeFileSync(join(BASE, 'nikatru', 'README.md'), 'the shared business brain, fixture\n', 'utf8');

  // A real repository, over the guard's tracked-file floor. The filler files carry no
  // `Private/` path and no `[pipeline]` tag, so a clean run finds zero failures and the
  // exit code is about the resolution table and nothing else.
  mkdirSync(join(PUB, 'filler'), { recursive: true });
  const tracked = FILE_FLOOR + 10;
  for (let i = 0; i < tracked; i += 1) writeFileSync(join(PUB, 'filler', `f-${i}.txt`), `filler ${i}\n`, 'utf8');
  git(PUB, 'init', '-q');
  git(PUB, 'config', 'user.email', 'fixture@example.test');
  git(PUB, 'config', 'user.name', 'fixture');
  git(PUB, 'config', 'commit.gpgsign', 'false');
  git(PUB, 'add', '-A');
  git(PUB, 'commit', '-q', '-m', 'fixture', '--no-gpg-sign');

  /* The guard and its git helper are copied in AFTER the commit and left UNTRACKED,
     on purpose: the guard's subject is `git ls-files`, so an untracked copy is not
     part of its own subject. Tracked, its header's own `Private/…` example paths
     would be scanned against the fixture corpus and every case would fail for a
     reason that has nothing to do with sharding. */
  mkdirSync(join(PUB, 'tooling', 'scripts'), { recursive: true });
  cpSync(GUARD_SRC, join(PUB, 'tooling', 'scripts', 'assert-public-citations.mjs'));
  cpSync(GIT_HELPER_SRC, join(PUB, 'tooling', 'scripts', 'repo-git.mjs'));
  writeDescentMutant();

  assert.equal(git(PUB, 'ls-files').split('\n').filter(Boolean).length, tracked, 'the fixture repo does not track the number of files this file thinks it does');
});

after(() => { rmSync(BASE, { recursive: true, force: true }); });

test('the FLAT corpus resolves, and the mutant agrees — the fixture repo and its floors are sound', () => {
  buildFlatCorpus(ORIGIN_FLOOR + 20);

  const real = runGuard();
  assert.equal(real.code, 0, `the flat corpus must resolve: ${real.out}`);
  assert.match(real.out, /every citation resolves/);

  // CONTROL, not a mutant: the pre-2026-09-08 guard behaves IDENTICALLY on a flat
  // corpus. If this went red, the change would have altered the layout it was
  // already correct for, which is a regression and not a fix.
  const old = runGuard('mutant-one-level.mjs');
  assert.equal(old.code, 0, `the one-level scan must still pass on a FLAT corpus — the change is not allowed to alter the layout that already worked: ${old.out}`);
});

test('the SHARDED corpus resolves, and the one-level scan proves it could not', () => {
  const built = buildShardedCorpus();
  assert.ok(built.origins > ORIGIN_FLOOR, 'the fixture must clear the floor when the shards ARE read, or a pass below would prove nothing');

  const real = runGuard();
  assert.equal(real.code, 0, `the sharded corpus must resolve: ${real.out}`);
  assert.match(real.out, /every citation resolves/);
  assert.match(real.out, new RegExp(`${built.files.length} of them declared shard\\(s\\)`), `the ok line must say how many declared shards were read, so a reader can check it. Got: ${real.out}`);

  // MUTANT — the same corpus, read by the guard with the descent deleted. This is
  // the measured defect rebuilt: a complete corpus, a thin table, exit 2.
  const old = runGuard('mutant-one-level.mjs');
  assert.equal(old.code, 2, `the one-level scan must REFUSE on a sharded corpus, or this case is not exercising the fix at all: ${old.out}`);
  assert.match(old.out, new RegExp(`below ${ORIGIN_FLOOR}`), 'the mutant refused for some reason other than the origin floor, so the reproduction is not the recorded one');
});

test('a DECLARED shard that is not on disk is exit 2, and it is the declaration that catches it', () => {
  const built = buildShardedCorpus();
  const victim = built.files[2];
  rmSync(join(SPEC, built.register, victim));

  const real = runGuard();
  assert.equal(real.code, 2, `a missing declared shard must be COVERAGE LOST, never a smaller scan: ${real.out}`);
  assert.match(real.out, /declared shard\(s\) are not on disk/);
  assert.ok(real.out.includes(victim), `the refusal must name the missing shard. Got: ${real.out}`);

  /* MUTANT — the SAME tree with the `shards` block removed. The remaining four
     shards are still found by the one-level-deeper walk and still clear the floor,
     so the guard passes: which proves the exit 2 above came from the DECLARATION
     being unsatisfied and not merely from a thinner table. */
  const idx = JSON.parse(readFileSync(join(SPEC, 'index.json'), 'utf8'));
  delete idx.shards;
  writeJson(join(SPEC, 'index.json'), idx);
  const undeclared = runGuard();
  assert.equal(undeclared.code, 0, `with no declaration the surviving shards must still be READ and must still clear the floor — otherwise the case above proves only that four shards are fewer than five: ${undeclared.out}`);
});

test('an UNDECLARED shard on disk is read, not skipped — a corpus with no `shards` block still resolves', () => {
  const built = buildShardedCorpus();
  const idx = JSON.parse(readFileSync(join(SPEC, 'index.json'), 'utf8'));
  delete idx.shards;
  writeJson(join(SPEC, 'index.json'), idx);

  const real = runGuard();
  assert.equal(real.code, 0, `an undeclared shard directory must be walked: skipping it is the same thin table by a different door: ${real.out}`);
  assert.match(real.out, /no `shards` block declared/, 'the ok line must say the block was absent, so "read 0 shards" and "there were none to read" are different sentences');

  // MUTANT — the one-level scan over the same tree cannot see any of it.
  const old = runGuard('mutant-one-level.mjs');
  assert.equal(old.code, 2, `the one-level scan must refuse here too: ${old.out}`);
  assert.ok(built.files.length > 0);
});

test('a declared shard that is on disk and will not parse is exit 2, never a silent skip', () => {
  const built = buildShardedCorpus();
  writeFileSync(join(SPEC, built.register, built.files[0]), '{ this is not json', 'utf8');

  const real = runGuard();
  assert.equal(real.code, 2, `an unparseable DECLARED shard must refuse: it is not a smaller table, it is an unknown one: ${real.out}`);
  assert.match(real.out, /could not be parsed/);

  /* MUTANT — the same broken bytes in an UNDECLARED file at the top level, which
     this guard has always skipped and must go on skipping: the top level carries
     schemas and notes it has never needed to parse. */
  buildShardedCorpus();
  writeFileSync(join(SPEC, 'not-a-register.json'), '{ this is not json', 'utf8');
  const tolerated = runGuard();
  assert.equal(tolerated.code, 0, `an undeclared unparseable file must stay tolerated — tightening that is a separate change and is not what this one claims: ${tolerated.out}`);
});

test('a `shards` block that is not readable as a declaration is exit 2', () => {
  buildShardedCorpus();
  const idx = JSON.parse(readFileSync(join(SPEC, 'index.json'), 'utf8'));
  idx.shards.invariants = 'invariants/';   // a string where the list belongs
  writeJson(join(SPEC, 'index.json'), idx);

  const real = runGuard();
  assert.equal(real.code, 2, `a malformed declaration must refuse rather than be ignored: ${real.out}`);
  assert.match(real.out, /is unreadable/);

  // MUTANT — the `_`-prefixed prose keys in the same block are NOT registers and
  // must never be read as one, or every real corpus refuses on its own comments.
  buildShardedCorpus();
  assert.equal(runGuard().code, 0, 'the `_what`/`_rule`/`_guard`/`_generated` keys the real block carries were read as registers');
});

test('the fixture guard file is the committed one, byte for byte', () => {
  assert.equal(
    readFileSync(join(PUB, 'tooling', 'scripts', 'assert-public-citations.mjs'), 'utf8'),
    readFileSync(GUARD_SRC, 'utf8'),
    'the copy under test has drifted from the guard in the tree, so every case above is about a file nothing ships',
  );
  assert.ok(existsSync(join(PUB, 'tooling', 'scripts', 'repo-git.mjs')), 'the git helper is missing from the fixture repo');
});
