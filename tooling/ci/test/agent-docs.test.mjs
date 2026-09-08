// ─────────────────────────────────────────────────────────────────────────────
// agent-docs.test.mjs — tooling/scripts/check-agent-docs.mjs must be able to
// fail, must be able NOT to, and must fail LOUDLY the day its limbs promote.
//
// 🔴 WHY THIS FILE EXISTS AT ALL, and it is the same reason its sibling
// selection-record.test.mjs exists. The guard landed on 2026-09-08 in commit
// 9b4cd308 and `git grep -n check-agent-docs` returned nothing but the baseline
// file it writes itself: no workflow, no hook, no `enforcement-index` row, no
// test. All five of its limbs are in `CONFIG.warnLimbs` with
// `promoteOn: 2026-09-22`, so on that date somebody moves a limb id out of that
// array and the guard starts FAILING BUILDS — a guard that has never run in CI.
//
// That is the sequence this corpus keeps paying for: a guard nobody wired is a
// guard nobody trusts on the day it first goes red, and the cheapest response to
// a red guard nobody trusts is to unwire it again. The repair is a CI step and a
// test, not a deletion, and the two have to land together — `assert-guard-coverage`
// requires that a workflow-invoked script outside `tooling/ci/` be EXERCISED by a
// test file (spawned or imported), or `guard-meta` goes red naming it.
//
// ⚠️ THE FIXTURE IS A REAL GIT REPOSITORY, and it has to be. The guard reads the
// INDEX and never the working directory — `git ls-files --cached -s` then
// `git cat-file --batch` — which is a deliberate choice recorded in its header
// (a concurrent writer's untracked file must not redden another writer's commit).
// A fixture that wrote files without committing them would be testing a program
// that does not exist. It also resolves its own root by walking `CONFIG.rootUp`
// from its own location and refuses a tree missing any of `CONFIG.sentinels`, so
// the copy under test lives at `<fixture>/tooling/scripts/`.
//
// ⚠️ AND THE FIXTURE IS BIG ON PURPOSE. `CONFIG.floors` demands 1000 tracked
// files, 800 text blobs and 200 directory chains before the guard will call any
// run evidence. A smaller fixture would exercise nothing but the COVERAGE LOST
// branch — which is case 5 below, and is worth exactly one case rather than all
// of them.
//
// THE CASE THAT MATTERS MOST is 3: the same tree, read by the guard as shipped,
// exits 0 with `WARN`; read by the guard with one limb id removed from
// `warnLimbs`, exits 1 with `FAIL`. That is the promotion of 2026-09-22
// performed under test, today, so the date arrives on a guard whose failing path
// has been run.
//
// Run:  node --test "tooling/ci/test/agent-docs.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD_SRC = resolve(REPO, 'tooling', 'scripts', 'check-agent-docs.mjs');
const GUARD_REL = 'tooling/scripts/check-agent-docs.mjs';

/** The guard's own declared floors and limb ids, READ from the source rather than
 *  typed here. A fixture built below a floor would exercise the refusal branch
 *  while this file reported it as a finding, and a limb id typed twice is a limb
 *  id that drifts. */
function config() {
  const src = readFileSync(GUARD_SRC, 'utf8');
  const open = src.indexOf('const CONFIG = {');
  assert.notEqual(open, -1, 'check-agent-docs.mjs no longer declares `const CONFIG = {` — this file is reading the wrong thing');
  const close = src.indexOf('\n};', open);
  assert.notEqual(close, -1, 'the CONFIG object is not terminated by a line `};`');
  const json = src.slice(open + 'const CONFIG = '.length, close + 2);
  /* CONFIG is written as pure JSON on purpose (its own header says it is
     generated, never typed), so it parses without evaluating the guard. */
  return JSON.parse(json);
}
const CONFIG = config();
const FLOORS = CONFIG.floors;

let BASE, ROOT;

const git = (where, ...args) => {
  const r = spawnSync('git', ['-C', where, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture setup failed: git ${args.join(' ')} -> ${r.status} ${r.stderr}`);
  return r.stdout;
};

/** Run a guard file inside the fixture. The six redirecting git variables are
 *  stripped for the reason `repo-git.mjs` records at length: git EXPORTS them
 *  into every hook process and they BEAT `-C`, so a guard spawned from inside a
 *  commit would read the committing repository's index instead of this one's. */
function run(file = 'check-agent-docs.mjs', ...argv) {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  const r = spawnSync(process.execPath, [join(ROOT, 'tooling', 'scripts', file), ...argv], { cwd: ROOT, env, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** The guard with one limb id taken OUT of `warnLimbs` — which is exactly how its
 *  own header says a limb is promoted ("a one-line diff a reviewer can see"). This
 *  is the 2026-09-22 change, performed here so its consequence is measured before
 *  the date rather than discovered on it. */
function writePromotedMutant(limb) {
  const src = readFileSync(GUARD_SRC, 'utf8');
  const from = `    "${limb}",`;
  assert.ok(src.includes(from), `check-agent-docs.mjs no longer lists "${limb}" in warnLimbs — this file cannot build its mutant`);
  const mutant = src.replace(from, '');
  assert.notEqual(mutant, src, 'the mutation changed nothing');
  writeFileSync(join(ROOT, 'tooling', 'scripts', `mutant-promoted-${limb}.mjs`), mutant, 'utf8');
}

/** A root AGENTS.md over the BYTE cap and UNDER the line cap, so a case using it
 *  produces exactly ONE finding. Written few-long-lines rather than
 *  many-short-lines on purpose: `capFor` grades AGENTS.md on lines AND bytes, and
 *  a doc that breaks both records TWO findings for one limb+path — which would
 *  make the counts in the baseline case read as a bug rather than as two real
 *  findings. Measured: 150 lines of 162 bytes is 24300 bytes, over the 12288 cap
 *  and well under the 200-line one. */
function overByteCap(lines = 150) {
  return `# ${'x'.repeat(160)}\n`.repeat(lines);
}

/** Stage a tracked file for one case and take it out again. TRACKED, because the
 *  guard's subject is the index: an untracked file is invisible to it by design. */
function withTracked(rel, body, fn) {
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  git(ROOT, 'add', '--', rel);
  try {
    assert.ok(git(ROOT, 'ls-files', '--', rel).includes(rel), 'the file is not in the fixture index, so the guard will never see it');
    return fn();
  } finally {
    git(ROOT, 'rm', '-q', '-f', '--cached', '--', rel);
    rmSync(abs, { force: true });
  }
}

before(() => {
  BASE = mkdtempSync(join(tmpdir(), 'nikatru-agentdocs-'));
  ROOT = join(BASE, 'Fixture_Public');

  /* The three sentinels the guard refuses without, and a root AGENTS.md that is
     comfortably UNDER every cap so the clean case is genuinely clean. */
  mkdirSync(join(ROOT, 'apps'), { recursive: true });
  mkdirSync(join(ROOT, 'tooling', 'scripts'), { recursive: true });
  writeFileSync(join(ROOT, 'AGENTS.md'), '# fixture agents card\n\nSmall on purpose.\n');
  writeFileSync(join(ROOT, 'apps', 'placeholder.md'), 'fixture app tree\n');

  /* Enough tree to clear every floor: directory chains for `budgetChecked`,
     `.md` blobs for `bomScanned`, and files for `trackedFiles`. Derived from the
     floors read out of the guard, never from numbers typed here. */
  const dirs = Math.max(FLOORS.budgetChecked + 10, 1);
  const perDir = Math.max(Math.ceil((FLOORS.trackedFiles + 20) / dirs), Math.ceil((FLOORS.bomScanned + 20) / dirs), 1);
  let written = 0;
  for (let d = 0; d < dirs; d += 1) {
    const dir = join(ROOT, 'filler', `d-${d}`);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < perDir; i += 1) { writeFileSync(join(dir, `f-${i}.md`), `filler ${d}/${i}\n`); written += 1; }
  }

  git(ROOT, 'init', '-q');
  git(ROOT, 'config', 'user.email', 'fixture@example.test');
  git(ROOT, 'config', 'user.name', 'fixture');
  git(ROOT, 'config', 'commit.gpgsign', 'false');
  git(ROOT, 'add', '-A');
  git(ROOT, 'commit', '-q', '-m', 'fixture', '--no-gpg-sign');

  /* Copied in AFTER the commit and left UNTRACKED — the guard's subject is the
     index, so an untracked copy is not part of its own subject. */
  cpSync(GUARD_SRC, join(ROOT, 'tooling', 'scripts', 'check-agent-docs.mjs'));
  writePromotedMutant('A-SIZE');

  assert.ok(written >= FLOORS.trackedFiles, `the fixture wrote ${written} filler file(s), below the guard's own trackedFiles floor of ${FLOORS.trackedFiles}`);
});

after(() => { rmSync(BASE, { recursive: true, force: true }); });

test('a clean tree over every floor is exit 0, and says what it measured', () => {
  const r = run();
  assert.equal(r.code, 0, `a clean fixture must pass: ${r.out}`);
  assert.match(r.out, /ok {2}no new finding/);
  /* The counts are printed, not implied — a guard that says "ok" without saying
     what it read is the vacuous pass this corpus refuses. */
  assert.match(r.out, /scanned: \d+ tracked file\(s\), \d+ instruction doc\(s\), \d+ text blob\(s\), \d+ directory chain\(s\)/);
});

test('limb A-SIZE bites: an over-cap root AGENTS.md is reported', () => {
  const before = run();
  assert.equal(before.code, 0, `green control first, or the case below proves nothing: ${before.out}`);
  assert.doesNotMatch(before.out, /A-SIZE/);

  const abs = join(ROOT, 'AGENTS.md');
  const keep = readFileSync(abs, 'utf8');
  writeFileSync(abs, overByteCap());
  git(ROOT, 'add', '--', 'AGENTS.md');
  try {
    const r = run();
    assert.match(r.out, /WARN A-SIZE AGENTS\.md/, `the over-cap doc must be named: ${r.out}`);
    assert.match(r.out, /cap 12288/, `the finding must state the cap it broke: ${r.out}`);
    assert.equal((r.out.match(/A-SIZE AGENTS\.md/g) ?? []).length, 1, `one over-cap dimension must produce exactly one finding, or the baseline counts below are measuring the wrong thing: ${r.out}`);
  } finally {
    writeFileSync(abs, keep);
    git(ROOT, 'add', '--', 'AGENTS.md');
  }
  const after = run();
  assert.equal(after.code, 0, `restored, the fixture must be green again: ${after.out}`);
});

test('THE PROMOTION, performed under test: warn exits 0, the same tree on a promoted limb exits 1', () => {
  const abs = join(ROOT, 'AGENTS.md');
  const keep = readFileSync(abs, 'utf8');
  writeFileSync(abs, overByteCap());
  git(ROOT, 'add', '--', 'AGENTS.md');
  try {
    /* As shipped: A-SIZE is in warnLimbs, so a real finding is printed and the
       run still exits 0. That is deliberate and it is also why nobody would
       notice this guard breaking — it cannot fail today. */
    const warn = run();
    assert.equal(warn.code, 0, `a finding on a WARN limb must still exit 0 by design: ${warn.out}`);
    assert.match(warn.out, /WARN A-SIZE/);
    assert.match(warn.out, /still a WARNING, so this run exits 0 by design/);
    assert.ok(warn.out.includes(CONFIG.promoteOn), `the warn line must name the promotion date so a reader knows when this stops being free. Got: ${warn.out}`);

    /* Promoted — one limb id removed from warnLimbs, which is exactly the
       one-line diff the guard's header says promotion is. The finding is the
       same finding; only the verdict moves. */
    const failed = run('mutant-promoted-A-SIZE.mjs');
    assert.equal(failed.code, 1, `once A-SIZE is promoted the SAME tree must exit 1, or the promotion of 2026-09-22 lands on a guard that cannot fail: ${failed.out}`);
    assert.match(failed.out, /FAIL A-SIZE/);
    assert.match(failed.out, /new finding\(s\) on a promoted limb/);
  } finally {
    writeFileSync(abs, keep);
    git(ROOT, 'add', '--', 'AGENTS.md');
  }
  assert.equal(run().code, 0, 'the fixture must be green again after the case');
});

test('limb A-BOM bites: a UTF-8 BOM on a tracked text blob is reported', () => {
  assert.equal(run().code, 0, 'green control first');
  withTracked('filler/bommed.md', '﻿# a doc with a byte order mark\n', () => {
    const r = run();
    assert.match(r.out, /WARN A-BOM filler\/bommed\.md/, `the BOM'd file must be named: ${r.out}`);
  });
  assert.equal(run().code, 0, 'the fixture must be green again after the case');
});

test('a tree under the floors is COVERAGE LOST — exit 2, never a pass', () => {
  const thin = join(BASE, 'Thin_Public');
  mkdirSync(join(thin, 'apps'), { recursive: true });
  mkdirSync(join(thin, 'tooling', 'scripts'), { recursive: true });
  writeFileSync(join(thin, 'AGENTS.md'), '# tiny\n');
  git(thin, 'init', '-q');
  git(thin, 'config', 'user.email', 'fixture@example.test');
  git(thin, 'config', 'user.name', 'fixture');
  git(thin, 'config', 'commit.gpgsign', 'false');
  git(thin, 'add', '-A');
  git(thin, 'commit', '-q', '-m', 'thin', '--no-gpg-sign');
  cpSync(GUARD_SRC, join(thin, 'tooling', 'scripts', 'check-agent-docs.mjs'));

  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  const r = spawnSync(process.execPath, [join(thin, 'tooling', 'scripts', 'check-agent-docs.mjs')], { cwd: thin, env, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  assert.equal(r.status, 2, `a tree with no subject in it must REFUSE, not pass: ${out}`);
  assert.match(out, /COVERAGE LOST/);
  assert.match(out, /trackedFiles \d+ < \d+/, `the refusal must name the floor it missed and by how much: ${out}`);
});

test('the baseline freezes a finding, and freezing is per limb+path rather than per message', () => {
  const abs = join(ROOT, 'AGENTS.md');
  const keep = readFileSync(abs, 'utf8');
  writeFileSync(abs, overByteCap());
  git(ROOT, 'add', '--', 'AGENTS.md');
  try {
    /* Freeze it, then GROW the same file. The finding's message changes; its
       limb+path key does not; and the run stays green. That asymmetry is the
       whole design of the baseline, and a test that only froze and re-ran would
       not have measured it. */
    const wrote = run('check-agent-docs.mjs', '--write-baseline');
    assert.equal(wrote.code, 0, `--write-baseline must succeed: ${wrote.out}`);
    assert.match(wrote.out, /wrote .*\.agentdocs\.baseline\.json with 1 frozen finding\(s\)/);

    writeFileSync(abs, overByteCap(170));
    git(ROOT, 'add', '--', 'AGENTS.md');
    const r = run();
    assert.equal(r.code, 0, `a baselined finding must not fail the run: ${r.out}`);
    assert.match(r.out, /BASELINE A-SIZE AGENTS\.md/);
    assert.doesNotMatch(r.out, /WARN A-SIZE/, 'a frozen finding must not also be reported as new');

    /* And the promoted mutant agrees: a frozen finding is frozen for a promoted
       limb too, or the baseline would be a warning-only courtesy rather than the
       record it claims to be. */
    const promoted = run('mutant-promoted-A-SIZE.mjs');
    assert.equal(promoted.code, 0, `a baselined finding must stay green even once its limb is promoted: ${promoted.out}`);
  } finally {
    rmSync(join(ROOT, '.agentdocs.baseline.json'), { force: true });
    writeFileSync(abs, keep);
    git(ROOT, 'add', '--', 'AGENTS.md');
  }
  assert.equal(run().code, 0, 'the fixture must be green again after the case');
});

test('the guard is WIRED — a workflow actually invokes it', () => {
  /* The defect this whole file was written for. On 2026-09-08 this assertion
     would have failed: the guard existed and nothing ran it. Reading the
     workflows rather than a register, because the register is DERIVED from
     them — asking the derived artefact would be asking the same source twice. */
  const wf = join(REPO, '.github', 'workflows');
  const hits = [];
  for (const f of ['ci.yml']) {
    const p = join(wf, f);
    if (!existsSync(p)) continue;
    if (readFileSync(p, 'utf8').includes(GUARD_REL)) hits.push(f);
  }
  assert.ok(hits.length > 0, `no workflow invokes ${GUARD_REL}. A guard nobody runs is a guard that is not enforcing anything, and its promoteOn date (${CONFIG.promoteOn}) would arrive on a step that has never executed in CI.`);
});

test('the fixture guard file is the committed one, byte for byte', () => {
  assert.equal(
    readFileSync(join(ROOT, 'tooling', 'scripts', 'check-agent-docs.mjs'), 'utf8'),
    readFileSync(GUARD_SRC, 'utf8'),
    'the copy under test has drifted from the guard in the tree, so every case above is about a file nothing ships',
  );
});
