// ─────────────────────────────────────────────────────────────────────────────
// spec-guards-worktree.test.mjs — the pre-commit runner must run FROM A LINKED
// GIT WORKTREE, and must still refuse when the main checkout cannot answer either.
//
// 🔴 THE DEFECT, AND ITS COST IN BEHAVIOUR RATHER THAN IN OUTPUT. `.claude/` is
// gitignored IN FULL — it is the local credential vault — and `CLAUDE.md` is
// gitignored too, so NEITHER is ever checked out into a worktree: a worktree gets
// tracked files and nothing else. `assert-spec` walks the public repo it derives
// from the corpus and requires four top-level anchors, `CLAUDE.md` among them,
// before it will resolve the eight `invariants.json` and `gates.json` ENFORCEMENT
// rows that name `.claude/scripts/…`. And the runner named the private corpus from
// the WORKTREE'S OWN directory name, so `Projects/structure_Public` composed
// `Projects/structure_Private`, a corpus that has never existed, and the run died
// at `CANNOT RUN — the private corpus was not found` before reading a single guard.
//
// So a worktree could not commit at all without `--no-verify`, which is a root
// `AGENTS.md` prohibition. THREE AGENTS USED IT ANYWAY ON 2026-09-07, and a fourth
// abandoned a finished, staged, guard-green branch and re-applied it as a patch in
// the main checkout. Recorded in Private research/full-read-2026-09-08/
// S2-structure-apply-2026-09-08.md sections 9 and 12. A guard that cannot run
// where people work is a guard people learn to bypass, and a bypassed guard is
// worth less than no guard because it also carries the belief that something was
// checked.
//
// ⚠️ THE FIX MUST NOT BE A SKIP, AND THAT IS WHAT HALF THIS FILE IS FOR. The
// tempting shape — "no `.claude/` here, so treat those rows as not applicable" —
// is the vacuous pass this corpus keeps catching, and it would silently retire
// eight enforcement rows for every worktree commit forever. What the runner does
// instead is RESOLVE: `git rev-parse --git-common-dir` names the main checkout,
// and the pair is derived from THAT. Nothing is copied. The case
// `still fails when the main checkout is missing it too` is the one that proves
// the difference between resolving and skipping, and it is the case to keep
// pointing at if anyone ever proposes making this quieter.
//
// ── EVERY CASE CARRIES ITS OWN MUTANT ────────────────────────────────────────
// The mutants here are one-line edits to a COPY of the runner that put each half
// of the fix back into the defect: the sibling derived from the worktree's name
// again, and the "am I missing an anchor" probe answering no. Both must turn the
// green worktree run below back into `CANNOT RUN`. A source-text assertion could
// not do this — the whole defect is that the source looked right.
//
// ⚠️ THE FIXTURE IS A REAL REPOSITORY AND A REAL `git worktree add`. Anything less
// would not exercise `--git-common-dir`, which is the only thing the fix rests on.
// The guards themselves are STUBS, and two of them assert rather than pass: the
// `assert-spec` stub re-implements that guard's anchor limb (derive the `_Public`
// sibling from the corpus it lives in, refuse when an anchor is absent) and the
// `assert-public-citations` stub records the corpus it was handed. Stubbing the
// rest keeps this file about path resolution, which is the only thing that changed.
//
// Run:  node --test "tooling/ci/test/spec-guards-worktree.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync, renameSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..'); // tooling/ci/test -> repo root
const RUNNER_SRC = resolve(REPO, 'tooling', 'scripts', 'spec-guards.mjs');
const GIT_HELPER_SRC = resolve(REPO, 'tooling', 'scripts', 'repo-git.mjs');
const SOURCE = readFileSync(RUNNER_SRC, 'utf8');

/* The two paths the ENFORCEMENT rows need at the repo root, read out of the runner
   rather than typed here: if the list ever changes, this file must follow it or it
   is building a worktree that is missing the wrong things. */
const HOST_ANCHORS = (() => {
  const m = /const HOST_ANCHORS = \[([^\]]+)\];/.exec(SOURCE);
  assert.ok(m, 'spec-guards.mjs no longer declares `const HOST_ANCHORS = [...]` — this file is reading the wrong thing');
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
})();

/** Every guard the runner will try to locate, by its FIRST `rel` candidate — the
 *  corpus-relative one. Parsed from the table so a guard added tomorrow is stubbed
 *  tomorrow, instead of this fixture silently under-covering the runner. */
function firstRels(src) {
  const start = src.indexOf('const GUARDS = [');
  assert.notEqual(start, -1, 'the GUARDS table is gone');
  const table = src.slice(start, src.indexOf('\n];', start));
  const out = [];
  const re = /\{\s*name:\s*'([^']+)',[\s\S]*?rel:\s*\[\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(table)) !== null) out.push({ name: m[1], rel: m[2] });
  assert.ok(out.length >= 9, `parsed ${out.length} guard rows, expected at least 9 — the row shape changed and this fixture would stub nothing`);
  return out;
}
const GUARD_ROWS = firstRels(SOURCE);

let BASE;      // the throwaway workspace
let PUB;       // <BASE>/Projects/Fixture_Public   — the MAIN checkout
let WT;        // <BASE>/Projects/Fixturewt_Public — the linked worktree
let PRIV;      // <BASE>/Projects/Fixture_Private  — the corpus
let ENV_SEEN;  // where the assert-public-citations stub records what it was handed

const git = (where, ...args) => {
  const r = spawnSync('git', ['-C', where, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture setup failed: git ${args.join(' ')} -> ${r.status} ${r.stderr}`);
  return r.stdout;
};

const write = (abs, text) => { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text, 'utf8'); };

/** The `assert-spec` stub: the real guard's identity limb and nothing else. It
 *  derives the public repo the way the real one does — the corpus it lives in, with
 *  `_Private` swapped for `_Public` — and refuses with code 2 when an anchor is
 *  absent there. This is what makes "the main checkout is missing it too" a real
 *  failure rather than a sentence in a comment. */
const ANCHOR_STUB = `import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = resolve(HERE, '..', '..');
const n = basename(CORPUS);
const REPO = resolve(CORPUS, '..', n.endsWith('_Private') ? n.slice(0, -'_Private'.length) + '_Public' : n + '_Public');
const ANCHORS = ${JSON.stringify(HOST_ANCHORS)};
const missing = ANCHORS.filter((rel) => !existsSync(join(REPO, ...rel.split('/'))));
writeFileSync(join(CORPUS, 'assert-spec-saw.txt'), REPO + '\\n' + missing.join(','), 'utf8');
if (missing.length) {
  console.error('CANNOT RUN - ' + REPO + ' does not look like this repository root. Missing: ' + missing.join(', '));
  process.exit(2);
}
console.log('ok anchors resolved at ' + REPO);
process.exit(0);
`;

/** The `assert-public-citations` stub: records the corpus root it was handed, so the
 *  "the children are told which corpus was elected" half is asserted on a file
 *  rather than on the runner's own printed summary. */
const ENV_STUB = `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.FIXTURE_ENV_SEEN, String(process.env.NIKATRU_PRIVATE_ROOT ?? ''), 'utf8');
process.exit(0);
`;

function buildCorpus() {
  rmSync(PRIV, { recursive: true, force: true });
  // The corpus marker the runner probes for: a NON-EMPTY `requirements/`.
  write(join(PRIV, 'requirements', 'index.json'), '{}\n');
  for (const { name, rel } of GUARD_ROWS) {
    const body = name === 'assert-spec' ? ANCHOR_STUB
      : name === 'assert-public-citations' ? ENV_STUB
        : `process.exit(0);\n`;
    write(join(PRIV, rel), body);
  }
}

/** Run the runner from `where`, with a copy of the environment that cannot smuggle
 *  the answer in: the machine running this suite has a real corpus and may well have
 *  `NIKATRU_PRIVATE_ROOT` set, and git exports `GIT_DIR` into hooks. */
function runRunner(where, file = 'spec-guards.mjs') {
  const env = { ...process.env, FIXTURE_ENV_SEEN: ENV_SEEN };
  delete env.NIKATRU_PRIVATE_ROOT;
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  rmSync(ENV_SEEN, { force: true });
  const r = spawnSync(process.execPath, [join(where, 'tooling', 'scripts', file), '--fast'], { cwd: where, env, encoding: 'utf8' });
  return {
    code: r.status,
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    envSeen: existsSync(ENV_SEEN) ? readFileSync(ENV_SEEN, 'utf8') : null,
  };
}

/** A one-substitution copy of the runner, written beside it in both trees so it
 *  resolves the same helper module. Each mutation puts one half of the fix back
 *  into the defect it closes. */
function writeMutant(name, from, to) {
  assert.ok(SOURCE.includes(from), `cannot build the ${name} mutant — spec-guards.mjs no longer contains \`${from}\`, so the case using it is asserting nothing`);
  const mutant = SOURCE.replace(from, to);
  assert.notEqual(mutant, SOURCE, 'the mutation changed nothing');
  for (const tree of [PUB, WT]) write(join(tree, 'tooling', 'scripts', name), mutant);
}

before(() => {
  /* 🔴 CANONICALISED IMMEDIATELY. On this host `os.tmpdir()` answers in the 8.3 SHORT
     form (`C:/Users/LOCALU~1/...`) while git answers with the long one, so two spellings
     of ONE directory compare unequal and every path assertion below fails over a
     filename convention rather than over behaviour. repo-git.mjs carries the same note
     for the same reason. Done once, here, so nothing downstream has to remember it. */
  BASE = realpathSync.native(mkdtempSync(join(tmpdir(), 'nikatru-wt-')));
  const PRODUCTS = join(BASE, 'Projects');
  PUB = join(PRODUCTS, 'Fixture_Public');
  WT = join(PRODUCTS, 'Fixturewt_Public');
  PRIV = join(PRODUCTS, 'Fixture_Private');
  ENV_SEEN = join(BASE, 'env-seen.txt');

  // The workspace anchor: `Projects/` and `nikatru/` side by side.
  write(join(BASE, 'nikatru', 'README.md'), 'the shared business brain, fixture\n');

  // The main checkout. Only the runner and its git helper are TRACKED — which is
  // what puts them in the worktree and keeps everything else out of it.
  mkdirSync(PUB, { recursive: true });
  mkdirSync(join(PUB, 'tooling', 'scripts'), { recursive: true });
  cpSync(RUNNER_SRC, join(PUB, 'tooling', 'scripts', 'spec-guards.mjs'));
  cpSync(GIT_HELPER_SRC, join(PUB, 'tooling', 'scripts', 'repo-git.mjs'));
  git(PUB, 'init', '-q');
  git(PUB, 'config', 'user.email', 'fixture@example.test');
  git(PUB, 'config', 'user.name', 'fixture');
  git(PUB, 'config', 'commit.gpgsign', 'false');
  /* The real repo stores LF (`.gitattributes`: `* text=auto eol=lf`). This fixture has
     no `.gitattributes`, so on a machine with `core.autocrlf=true` the WORKTREE checkout
     would come back CRLF and the byte-identity case at the end would fail over line
     endings rather than over drift. Pinned here rather than worked around there. */
  git(PUB, 'config', 'core.autocrlf', 'false');
  git(PUB, 'config', 'core.eol', 'lf');
  git(PUB, 'add', '-A');
  git(PUB, 'commit', '-q', '-m', 'fixture', '--no-gpg-sign');

  /* The gitignored pair, created AFTER the commit and never tracked — which is
     exactly how they exist in the real repo, and the reason no worktree has them. */
  for (const rel of HOST_ANCHORS) write(join(PUB, ...rel.split('/')), 'fixture\n');

  git(PUB, 'worktree', 'add', '-q', '-b', 'fixture-wt', WT, 'HEAD');
  buildCorpus();
});

after(() => {
  try { git(PUB, 'worktree', 'remove', '--force', WT); } catch { /* the rm below is the real cleanup */ }
  rmSync(BASE, { recursive: true, force: true });
});

test('the fixture reproduces the defect: the worktree has the runner and neither gitignored anchor', () => {
  assert.ok(existsSync(join(WT, 'tooling', 'scripts', 'spec-guards.mjs')), 'the runner is not in the worktree, so nothing below runs from one');
  for (const rel of HOST_ANCHORS) {
    assert.equal(existsSync(join(WT, ...rel.split('/'))), false, `${rel} is present in the worktree — the fixture is not reproducing the condition every case below is about`);
    assert.equal(existsSync(join(PUB, ...rel.split('/'))), true, `${rel} is missing from the MAIN checkout, so the fixture cannot tell "resolved from the main checkout" from "found nowhere"`);
  }
  const common = git(WT, 'rev-parse', '--git-common-dir').trim();
  assert.equal(resolve(WT, common).replace(/\\/g, '/').toLowerCase(), join(PUB, '.git').replace(/\\/g, '/').toLowerCase(), 'git does not name the main checkout from this worktree, so the mechanism the fix rests on is not present in this fixture');
});

test('the runner runs from a linked worktree, resolving the anchors from the main checkout', () => {
  const r = runRunner(WT);
  assert.equal(r.code, 0, `the runner must run from a worktree: ${r.out}`);
  assert.match(r.out, /worktree mode/, 'the run must SAY it resolved elsewhere — a silent redirection is how a reader stops being able to check which tree was graded');
  assert.ok(r.out.includes(PUB), `the main checkout must be named in the output. Got: ${r.out}`);
  assert.match(r.out, new RegExp(`${GUARD_ROWS.length} guard\\(s\\) in`), `all ${GUARD_ROWS.length} guards must have run: ${r.out}`);

  const saw = readFileSync(join(PRIV, 'assert-spec-saw.txt'), 'utf8').split('\n');
  assert.equal(resolve(saw[0]).replace(/\\/g, '/').toLowerCase(), PUB.replace(/\\/g, '/').toLowerCase(), 'the spec guard was pointed at some tree other than the main checkout');
  assert.equal(saw[1], '', 'the spec guard still reported a missing anchor');

  assert.equal(resolve(r.envSeen).replace(/\\/g, '/').toLowerCase(), PRIV.replace(/\\/g, '/').toLowerCase(), 'the elected corpus was not passed to the child guards, so a guard that resolves the prefix for itself would land somewhere else');
});

test('NOTHING is copied into the worktree — the credential vault stays in the one checkout that has it', () => {
  const r = runRunner(WT);
  assert.equal(r.code, 0, r.out);
  for (const rel of HOST_ANCHORS) {
    assert.equal(existsSync(join(WT, ...rel.split('/'))), false, `${rel} appeared in the worktree. Copying a gitignored credential vault to satisfy a guard is the trade this fix exists to avoid, and a guard reading a copy is asserting about the copy.`);
  }
  assert.equal(existsSync(join(WT, '.claude')), false, 'a `.claude/` directory was created in the worktree');
});

test('MUTANT — the sibling named from the worktree instead of the main checkout: CANNOT RUN', () => {
  writeMutant('mutant-name-from-repo.mjs', 'const REPO_NAME = basename(HOST_ROOT);', 'const REPO_NAME = basename(REPO);');
  const r = runRunner(WT, 'mutant-name-from-repo.mjs');
  assert.equal(r.code, 2, `naming the pair from the worktree must refuse, or the case above proves nothing about WHERE the name came from: ${r.out}`);
  assert.match(r.out, /the private corpus was not found/);
  assert.match(r.out, /Fixturewt_Private/, 'the mutant refused for some reason other than composing the worktree-named sibling — the reproduction is not the recorded one');
});

test('MUTANT — the missing-anchor probe answering no: CANNOT RUN', () => {
  writeMutant('mutant-never-worktree.mjs', 'const ABSENT_HERE = absentHostAnchors(REPO);', 'const ABSENT_HERE = [];');
  const r = runRunner(WT, 'mutant-never-worktree.mjs');
  assert.equal(r.code, 2, `never entering worktree mode must refuse: ${r.out}`);
  assert.doesNotMatch(r.out, /worktree mode/, 'the mutant still entered worktree mode, so the probe is not what gates it');
});

test('CLAUDE.md present in the worktree and the vault absent still resolves — the probe is the SET, not one file', () => {
  write(join(WT, 'CLAUDE.md'), 'a hand-written copy, which the vault can never be\n');
  try {
    const r = runRunner(WT);
    assert.equal(r.code, 0, `one anchor present and one absent must still resolve: ${r.out}`);
    assert.match(r.out, /worktree mode/, 'a worktree missing only the VAULT stopped being treated as a worktree, which is the eight enforcement rows going unresolved again');
    assert.doesNotMatch(r.out, /this tree is missing CLAUDE\.md ,/, 'CLAUDE.md was reported absent while it was present');
  } finally {
    rmSync(join(WT, 'CLAUDE.md'), { force: true });
  }
});

test('it STILL FAILS when the main checkout is missing the file too — resolving is not skipping', () => {
  const victim = join(PUB, ...HOST_ANCHORS[0].split('/'));
  renameSync(victim, `${victim}.moved`);
  try {
    const r = runRunner(WT);
    assert.equal(r.code, 2, `with the anchor absent everywhere the run must refuse. If this is ever 0, the fix has become a skip and eight enforcement rows are being retired silently on every worktree commit: ${r.out}`);
    assert.match(r.out, /worktree mode/, 'the runner must still say it looked at the main checkout');
    assert.ok(r.out.includes('the main checkout is missing them too'), `the runner must name the diagnosis rather than let the guard\'s own refusal stand alone: ${r.out}`);
    assert.match(r.out, /could not run/, 'the refusal must be COVERAGE LOST, not a finding');

    const saw = readFileSync(join(PRIV, 'assert-spec-saw.txt'), 'utf8').split('\n');
    assert.equal(resolve(saw[0]).replace(/\\/g, '/').toLowerCase(), PUB.replace(/\\/g, '/').toLowerCase(), 'the guard did not even reach the main checkout, so this case is not the one it claims to be');
    assert.equal(saw[1], HOST_ANCHORS[0], 'the guard refused over the wrong anchor');
  } finally {
    renameSync(`${victim}.moved`, victim);
  }
});

test('the MAIN checkout is unchanged by all of this: no worktree mode, no override handed down', () => {
  const r = runRunner(PUB);
  assert.equal(r.code, 0, `the main checkout must keep passing: ${r.out}`);
  assert.doesNotMatch(r.out, /worktree mode/, 'a main checkout entered worktree mode — `--git-common-dir` resolves to itself there and nothing should change');
  assert.equal(r.envSeen, '', 'NIKATRU_PRIVATE_ROOT was handed to the children from a main checkout, where every guard already resolves the pair for itself');
  assert.match(r.out, new RegExp(`${GUARD_ROWS.length} guard\\(s\\) in`));
});

test('the fixture runner is the committed one, byte for byte', () => {
  assert.equal(readFileSync(join(WT, 'tooling', 'scripts', 'spec-guards.mjs'), 'utf8'), SOURCE, 'the copy under test has drifted from the runner in the tree');
});
