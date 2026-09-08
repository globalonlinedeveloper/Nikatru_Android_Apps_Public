#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-public-citations.mjs — every citation in the PUBLIC tree resolves.
//
// 🔴 WHY THIS EXISTS. Nothing has ever checked a citation in the public tree.
// `assert-spec` limb 3 checks the spec's own `guard` fields, and
// `assert-adr-citations` is scoped to `Private/` — so a public file could point
// at anything at all and no build would notice. Measured 2026-08-17, before this
// guard existed: 205 lines across 95 tracked public files named
// `Private/company/` or `Private/knowledge/` (deleted in the 2026-08-15 flatten),
// including the opening line of sixteen JSON registers.
//
// This is the public half of ST-3 ("every pointer resolves"). The private half is
// `assert-index-complete` + `assert-adr-citations`.
//
// TWO CLASSES, BOTH CHECKED:
//
//   1. PRIVATE PATH REFERENCES — any `Private/...` path named in a public file
//      must exist on disk. These rot loudly at review time and silently at read
//      time, which is the wrong way round.
//
//   2. `[pipeline <ids>]` REQUIREMENT TAGS — 1,453 of them across the tree, the
//      densest citation class in the repo. They are NOT dead: the prose corpus
//      they were named for was deleted, but each id still resolves to an `origin`
//      field in `Private/requirements/*.json` (`[pipeline C-6]` -> origin
//      `[2]C-6`). So they are live pointers with a stale vocabulary, and the
//      correct treatment is to CHECK them, not to rewrite 1,453 tags.
//
// 🔴 A TAG IS NOT ONE ID. This is the whole reason the guard exists rather than a
// grep. A first pass at this with a naive `[A-Z]-[0-9]+` regex reported 55 of 157
// distinct tags unresolved; nearly all of those were the regex failing on real
// syntax the corpus uses — `[pipeline C-2/C-7]`, `[pipeline C-3, C-9]`,
// `[pipeline N-4 clause 7]`, `[pipeline F-5a, F-10]`, `[pipeline 2 C-11]`. A
// diagnostic is a claim and needs the same evidence as a finding, so this
// tokenises the tag body and resolves every id inside it.
//
// DISCLOSURE CONVENTIONS, HONOURED — the same two `assert-enforcers-exist` used,
// because this corpus deliberately keeps records of enforcement that was claimed
// and never built, and a naive guard would demand their deletion:
//   · `~~struck through~~`  — retracted text, not a live claim. Not checked.
//   · an absence annotated on the same line — `(does not exist)`, `(never
//     existed)`, `(deleted`, `(retired`, `(gone` — is a DISCLOSED absence and
//     passes. An UNDISCLOSED one fails. That asymmetry is the point.
//
// EXIT CODES:  0 = every citation resolves
//              1 = a citation does not resolve
//              2 = could not run (no corpus, no subject, or the spec unparseable)
//
// 🔴 `Private/` IS A LOGICAL PREFIX, NOT A SUBDIRECTORY (2026-08-18). The private
// corpus is moving out of this repo to the SIBLING directory
// `../Project_Cross_Platform_Apps_Private/`. The `Private/...` citations in the
// public tree (288 path refs measured on 2026-08-18, the run that made this
// change) are NOT rewritten for it. Rewriting them would trade a one-line
// resolver change for 288 chances to fumble a path, and would leave the corpus
// reading exactly the same to a human afterwards — no reader is helped. So
// `Private/` is now treated as a stable LOGICAL prefix and RESOLVED once, at the
// head of this file; see PRIVATE_CANDIDATES below. Nothing else changed shape.
//
// 🔴 AN ABSENT CORPUS IS NOW A REFUSAL, NOT A PASS (2026-08-18). This printed
// `⬜ NOT APPLICABLE` and exited 0 when the tree was missing. That is the vacuous
// pass this corpus has caught about ten times wearing a politer hat: the guard's
// entire claim is "every `Private/...` citation resolves", and with no corpus it
// has evaluated none of them. The move above is what forced the issue — the
// legacy path disappears on every checkout, so the vacuous branch was about to
// become the ONLY branch, and 288 citations would have gone unchecked under a
// green tick. It exits 2 and names the roots it tried.
//
// 🔴 THE ROOTS ARE FOUND BY ANCHORING NOW, NOT BY COUNTING LEVELS (2026-08-18, the
// SECOND note of that date — the one above is the morning's move and is left standing as
// the dated record it is, not edited to agree with this one).
//
// The tree moved TWICE on 2026-08-18. First the corpus became a sibling (above). Then the
// whole workspace was reorganised into a Store × Platform × Type tree, which pushed this
// repo THREE levels deeper — from `Projects/Project_Cross_Platform_Apps/` to
// `Projects/Google_Store/Google_Play_Store/Google_Play_Store_Apps/…_Android_Apps_Public/`.
//
// Every path derived by walking up a FIXED number of levels broke. The morning's own
// sibling rule broke in a quieter way: the repo picked up a `_Public` suffix, so
// `${basename(REPO)}_Private` composed `…_Android_Apps_Public_Private`, a directory that
// has never existed on any host. That REFUSED (exit 2) rather than passing vacuously —
// the refusal branch above doing exactly its job — but a guard that refuses on every run
// is checking as little as one that passes on every run, so it is a defect either way.
//
// 🔴 THE FIX IS DELIBERATELY NOT ANOTHER '..'. A level count is a bet on the depth of the
// tree, and this tree changed depth twice in one day with ~20 more repos coming at VARYING
// depths — so any number written here is wrong again the moment one of them moves. Nothing
// below counts levels. Two roots are SEARCHED FOR, walking upward from this file's own
// location, each by a property that describes ITSELF rather than its distance from here:
//
//   · THE WORKSPACE ANCHOR — the nearest ancestor holding BOTH `Projects/` and `nikatru/`
//     (today `C:/Users/localuserwin11/Documents/Claude`). That pair is the shape of the
//     WORKSPACE, not of any one product, so it survives any amount of re-nesting beneath
//     it. From it every other tree is addressable at any depth: `<anchor>/nikatru` (the
//     shared business brain) and `<anchor>/Projects` (the products root).
//   · THE REPO ROOT — the nearest ancestor holding `.git`. Same reasoning: `tooling/scripts`
//     is a stable place INSIDE the repo, but the distance from here to the workspace is
//     not, and only the repo BOUNDARY describes itself.
//
// If the anchor is not found this REFUSES and names every directory it walked. There is
// deliberately no fallback guess: a guessed root resolves ~290 citations against the wrong
// tree, and a confident wrong answer costs a reader more than a refusal does.
//
// 🔴 AND THE SIBLING NAME IS SWAPPED, NOT APPENDED — `<name>_Public` -> `<name>_Private`,
// with `_Private` appended only when there is no `_Public` suffix to swap. That one
// missing case is the whole afternoon failure, recorded here rather than quietly fixed.
//
// 🔴 IT LIVES IN tooling/scripts/, NOT tooling/ci/, AND THAT IS THE PRECEDENT NOT A
// PREFERENCE. `check-dod-sync.mjs` is the same shape — a guard whose SUBJECT is
// under `Private/`, which CI can never read — and it sits here for that reason.
// A guard in `tooling/ci/` is expected by `assert-guard-coverage.mjs` to be
// invoked by a workflow; this one would answer NOT APPLICABLE on every CI run,
// which is a check that always passes, i.e. exactly the vacuous pass it exists to
// catch. It was written into tooling/ci/ first and moved the same day, after
// `assert-guard-coverage` correctly reported it as an orphan.
//
// Usage:  node tooling/scripts/assert-public-citations.mjs
// ─────────────────────────────────────────────────────────────────────────────
/* 🔴 2026-09-07 — `git` IS NOT SPAWNED DIRECTLY FROM HERE ANY MORE, and the reason
   is the one defect that had been refusing every private commit on this machine.
   This guard runs in the pre-commit hook of the PRIVATE corpus as well as this
   repo — both are pointed at this repo `.githooks/` — and git EXPORTS
   `GIT_DIR` and `GIT_INDEX_FILE` into every hook process, where they BEAT `-C`.
   So `git -C <public repo> ls-files` inside a private commit enumerated the
   PRIVATE index: 567 files against this tree 2022, below `FILE_FLOOR` below, so
   this guard refused in 170 ms on a subject that was never its own. See
   `repo-git.mjs`, which deletes the six redirecting variables from the child
   environment and proves the root is its own repository before reading it. */
import { repoGit, RepoGitError, strippedNote } from './repo-git.mjs';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/* Walk upward from `from` until `test` accepts a directory, recording EVERY directory
   visited. The trail is not decoration: when this fails, the trail is the entire content
   of the refusal — a reader has to be able to see which ancestors were considered without
   re-deriving the walk in their head. Terminates at the filesystem root, where
   dirname(d) === d. */
function walkUp(from, test) {
  const trail = [];
  let d = resolve(from);
  for (;;) {
    trail.push(d);
    if (test(d)) return { found: d, trail };
    const up = dirname(d);
    if (up === d) return { found: null, trail };
    d = up;
  }
}

/* 🔴 THE WORKSPACE ANCHOR — see the 2026-08-18 anchoring note at the head. The nearest
   ancestor carrying BOTH `Projects/` and `nikatru/`. Requiring BOTH is what makes the
   probe specific: `Projects/` alone is a common enough directory name to match by
   accident on some other host, and `nikatru/` alone is the brain itself rather than the
   workspace containing it. Together they name this workspace and nothing else. */
const anchorWalk = walkUp(HERE, (d) => isDir(join(d, 'Projects')) && isDir(join(d, 'nikatru')));
const ANCHOR = anchorWalk.found;
if (!ANCHOR) {
  console.error('✗  public citations — REFUSING: workspace anchor not found, so NOTHING was checked.');
  console.error('   Looked for the nearest ancestor of this script containing BOTH `Projects/` and `nikatru/`.');
  console.error('   Walked, nearest first:');
  for (const d of anchorWalk.trail) console.error(`      ${d}`);
  console.error('   No fallback is attempted on purpose: a guessed root resolves every `Private/...`');
  console.error('   citation against the wrong tree, and a confident wrong answer is worse than none.');
  process.exit(2);
}
const NIKATRU = join(ANCHOR, 'nikatru');    // the shared business brain
const PRODUCTS = join(ANCHOR, 'Projects');  // the products root

/* The repo boundary, found the same way — `.git` describes itself, a level count does not.
   existsSync rather than isDir because a worktree/submodule checkout makes `.git` a FILE,
   and that is still the boundary. */
const repoWalk = walkUp(HERE, (d) => existsSync(join(d, '.git')));
const REPO = repoWalk.found;
if (!REPO) {
  console.error('✗  public citations — REFUSING: no repo root (.git) above this script, so NOTHING was checked.');
  console.error('   Walked, nearest first:');
  for (const d of repoWalk.trail) console.error(`      ${d}`);
  process.exit(2);
}
/* The anchor buys exactly one invariant, so it is worth asserting rather than assuming:
   a product repo lives under the products root. If it does not, this is not the tree this
   guard reasons about and every root below would be a guess. */
if (!resolve(REPO).startsWith(resolve(PRODUCTS) + '\\') && !resolve(REPO).startsWith(resolve(PRODUCTS) + '/')) {
  console.error('✗  public citations — REFUSING: repo root is not under the products root, so NOTHING was checked.');
  console.error(`      repo root:     ${REPO}`);
  console.error(`      products root: ${PRODUCTS}`);
  console.error(`      anchor:        ${ANCHOR}   (also carries the brain at ${NIKATRU})`);
  process.exit(2);
}

/* 🔴 THE SIBLING'S NAME IS DERIVED BY SWAPPING A SUFFIX, NOT BY APPENDING ONE. The repo
   gained a `_Public` suffix in the 2026-08-18 reorganisation, and the append-only rule
   written that morning composed `…_Android_Apps_Public_Private`. Swap the trailing
   `_Public` when it is there; append `_Private` only when there is nothing to swap, which
   keeps every pre-reorganisation repo name resolving exactly as it did before. */
const REPO_NAME = basename(REPO);
const SIBLING_NAME = /_Public$/.test(REPO_NAME)
  ? REPO_NAME.replace(/_Public$/, '_Private')
  : `${REPO_NAME}_Private`;

/* 🔴 THE ONE PLACE THAT SAYS WHERE THE PRIVATE CORPUS IS. A citation's `Private/`
   is a LOGICAL prefix; this turns it into a real root. Candidates, in order:

     1. $NIKATRU_PRIVATE_ROOT     — explicit override, for a host that keeps the
                                    corpus somewhere neither default reaches.
     2. <repo-dir>_Private (SIBLING) — where the corpus is (2026-08-18). Its PARENT is
                                    the repo's own parent, found by anchoring rather than
                                    by counting levels, so the pair travels together no
                                    matter how deep the Store × Platform × Type tree
                                    nests this repo — which is the whole point, since it
                                    moved three levels deeper on the day this was written.
     3. <repo>/Private  (LEGACY)  — where it lived before 2026-08-18. Kept only so an old
                                    checkout still resolves; it is the line to delete, not
                                    entry 2.

   Ordered new-first so the sibling wins the moment it is real.

   🔴 A ROOT ONLY COUNTS IF IT IS NON-EMPTY AND CARRIES `requirements/`, and that is
   load-bearing, not belt-and-braces: on 2026-08-18 the sibling directory ALREADY EXISTED
   and was EMPTY. A bare existsSync would have elected it, resolved every citation against
   nothing, and turned one un-run migration step into ~290 unresolved-citation failures —
   a true report of a false problem, which costs a reader more than a missing one.
   🔴 THAT TRAP GOT WIDER THE SAME DAY, NOT NARROWER. The reorganisation pre-created a
   `*_Private` shell beside EVERY planned product: measured 2026-08-18, ten of the twelve
   `*_Private` directories under the products root were completely empty, and only this
   repo's sibling carried `requirements/`. The emptiness test is therefore checked FIRST
   and reported by name, because "it exists but is a shell" is the single most likely
   wrong answer in this tree and the reader deserves to be told which one it was.
   `requirements/` remains the second probe because it is also the spec directory this
   guard reads its resolution table from — a root without it cannot answer either half. */
const PRIVATE_CANDIDATES = [
  process.env.NIKATRU_PRIVATE_ROOT ? resolve(process.env.NIKATRU_PRIVATE_ROOT) : null,
  join(dirname(REPO), SIBLING_NAME),
  join(REPO, 'Private'),
].filter(Boolean);

/* Returns null when the candidate IS the corpus, else the reason it is not — so the
   refusal below can say what was wrong with each root rather than just listing paths. */
function corpusReject(d) {
  if (!isDir(d)) return 'no such directory';
  let entries;
  try { entries = readdirSync(d); } catch (e) { return `unreadable (${e.code || e.message})`; }
  if (!entries.length) return 'EMPTY — a pre-created shell, never selected (see the note above)';
  if (!isDir(join(d, 'requirements'))) return `${entries.length} entr(ies) but no requirements/`;
  return null;
}

const rejected = [];
let PRIVATE = null;
for (const d of PRIVATE_CANDIDATES) {
  const why = corpusReject(d);
  if (!why) { PRIVATE = d; break; }
  rejected.push([d, why]);
}

/* 🔴 CHANGED 2026-08-18: WAS `⬜ NOT APPLICABLE` + exit 0, NOW A REFUSAL.
   The old branch borrowed the contract from tooling/scripts/spec-guards.mjs —
   don't fail a contributor's commit over a directory they are never given — and
   that half is still fair. The other half was not: this guard exists to assert
   that every `Private/...` citation in the public tree resolves, and with no
   corpus on disk it has checked none of them, so exiting 0 published that
   assertion on zero evidence. The corpus move made the branch load-bearing rather
   than rare, which is what turned a tolerable compromise into the exact defect
   named at the top of this file. Exit 2 (`could not run`), never 0: "I could not
   run" and "it passed" are different sentences and must not share an exit code. */
if (!PRIVATE) {
  console.error('✗  public citations — REFUSING: no private corpus found, so NOTHING was checked.');
  console.error(`      anchor:   ${ANCHOR}   (holds ${PRODUCTS} and ${NIKATRU})`);
  console.error(`      repo:     ${REPO}`);
  for (const [d, why] of rejected) console.error(`      tried:    ${d}\n                -> ${why}`);
  console.error('   `Private/` in a citation is a LOGICAL prefix and must resolve to one of the roots');
  console.error('   above; set NIKATRU_PRIVATE_ROOT if the corpus lives elsewhere on this host.');
  console.error('   This is non-zero on purpose: a citation guard that cannot find the corpus has');
  console.error('   verified nothing, and reporting that as a pass is the defect it exists to catch.');
  process.exit(2);
}
const SPEC = join(PRIVATE, 'requirements');

/* The domain is `git ls-files`, never a filesystem walk: the question is what the
   PUBLIC repository publishes, and an untracked file is not published. This also
   makes the guard's domain identical to the thing it is making a claim about. */
let lsOut;
try {
  lsOut = repoGit(REPO, 'ls-files');
} catch (e) {
  if (!(e instanceof RepoGitError)) throw e;
  console.error('✗  could not enumerate tracked files: ' + e.message);
  if (e.detail) console.error('   ' + e.detail.split('\n').join('\n   '));
  console.error('   The tracked manifest IS the subject. Without it this guard would report a clean');
  console.error('   empty tree, so this is exit 2 COVERAGE LOST and never a pass.');
  process.exit(2);
}
const files = lsOut.split('\n').map((s) => s.trim()).filter(Boolean);

/* 🔴 COVERAGE FLOOR. A guard that finds no subject and prints ok has checked
   nothing — the defect this corpus has found about ten times. The floor is set
   well below today's 1,210 so it survives ordinary growth and deletion, and well
   above zero so an enumeration that breaks fails loudly. */
const FILE_FLOOR = 800;
if (files.length < FILE_FLOOR) {
  console.error(`✗  only ${files.length} tracked file(s) — below the floor of ${FILE_FLOOR}.`);
  console.error('   Refusing: an empty or truncated subject list would pass every assertion below.');
  console.error(`   Enumerated at ${REPO}.`);
  /* Printed on THIS limb specifically, because this limb is where the 2026-09-07
     leak surfaced: a hook inherited environment redirected the enumeration at the
     other repository and the count arrived truncated rather than wrong-looking. The
     variables are deleted now, so the note normally reads "none set" — which is
     itself the evidence a reader of a future truncation needs. */
  console.error('   ' + strippedNote());
  process.exit(2);
}

/* 🔴 THE SPEC DIRECTORY IS NOT FLAT, AND A ONE-LEVEL `readdirSync` READ IT AS IF IT
   WERE (2026-09-08). The scan below was a single `readdirSync(SPEC)` taking `*.json`,
   which is exactly right for the layout that existed when it was written and silently
   wrong for the one the corpus is moving to. Private S1 phase 4 splits five registers
   — `lost-deliberately`, `invariants`, `not-built`, `ledger`, `gates` — into 37 shard
   files under `requirements/<register>/NN-<topic>.json`, declared in a `shards` block
   in `requirements/index.json`. MEASURED on that tree, with the sharding applied and
   green on all eleven private guards: this guard saw 6 files instead of 11, parsed
   233 origin refs against `ORIGIN_FLOOR` below, and refused at exit 2.

   THAT REFUSAL WAS THE FLOOR WORKING AND THE SCAN FAILING, which are different
   things, and only one of them is a defect. The floor exists so a thin resolution
   table cannot silently accept a dead citation; a one-level scan of a sharded
   directory produces exactly that thin table. So the floor STAYS at 300 and the scan
   is what changes: this guard now READS THE SHARDS rather than skipping them. A guard
   that refuses on the other repository's file layout is a guard people learn to
   bypass, and `--no-verify` is prohibited here — the cost of that refusal was a whole
   private phase built, verified and reverted (Private
   research/full-read-2026-09-08/S3-structure-apply-run2-2026-09-08.md, sections 2.2
   to 2.5).

   TWO SOURCES, AND THE DECLARATION IS THE AUTHORITATIVE ONE. The `shards` block is
   read first and every file it declares MUST exist: a declared shard that is not on
   disk is exit 2, never a smaller scan, because the register it belongs to would
   otherwise be resolved against a table missing a chunk of itself and nothing in the
   output would say so. That is the rule the two private guards apply to the same
   block. Then the directory is walked ONE LEVEL DEEPER anyway, declared or not, so a
   corpus with no `shards` block at all — or a shard on disk the block does not name —
   is still READ rather than skipped. Reading more than the declaration is safe here;
   reading less is the defect this note is about. */
const SPEC_INDEX = 'index.json';

/** The `<register>/<file>` list the `shards` block declares, or null when there is no
 *  block to read. `_`-prefixed keys (`_what`, `_rule`, `_guard`, `_generated`) are the
 *  block's own prose about itself and are not registers. A key whose value is not a
 *  non-empty array of strings is `malformed` rather than ignored: a declaration this
 *  guard cannot read is one it cannot honour, and honouring it is the whole point. */
function declaredShardFiles(specDir) {
  let idx;
  try { idx = JSON.parse(readFileSync(join(specDir, SPEC_INDEX), 'utf8')); } catch { return null; }
  if (!idx || typeof idx !== 'object' || Array.isArray(idx)) return null;
  const block = idx.shards;
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  const declared = [];
  const malformed = [];
  for (const [register, files] of Object.entries(block)) {
    if (register.startsWith('_')) continue;
    if (!Array.isArray(files) || !files.length || files.some((f) => typeof f !== 'string' || !f)) {
      malformed.push(register);
      continue;
    }
    for (const f of files) declared.push(`${register}/${f}`);
  }
  return { declared, malformed };
}

/* Every spec file to parse, relative to SPEC, deduplicated: the declaration and the
   walk below overlap by construction, and a file parsed twice inflates the count this
   guard prints for a reader to check. */
const specRels = [];
const seenSpecRel = new Set();
const addSpecRel = (rel) => { if (!seenSpecRel.has(rel)) { seenSpecRel.add(rel); specRels.push(rel); } };

/* The flat top level — the scan this guard has always done, unchanged. */
for (const f of readdirSync(SPEC)) {
  if (f.endsWith('.json')) addSpecRel(f);
}

/* Declared BEFORE the descent so that deleting the descent leaves this file valid and
   leaves it behaving exactly as it did before 2026-09-08. That is not a convenience:
   it is how the test mutates this guard back into the defect it closes. */
let shardDecl = null;

/* ── SHARD DESCENT BEGIN ─────────────────────────────────────────────────────── */
shardDecl = declaredShardFiles(SPEC);
if (shardDecl && shardDecl.malformed.length) {
  console.error(`✗  public citations — REFUSING: the \`shards\` block in ${join(SPEC, SPEC_INDEX)} is unreadable.`);
  for (const r of shardDecl.malformed) console.error(`      ${r}  ->  not a non-empty array of shard file names`);
  console.error('   A declaration this guard cannot read is one it cannot honour, and the registers it names');
  console.error('   would then be resolved against a table missing part of itself. Exit 2, never a pass.');
  process.exit(2);
}
if (shardDecl) {
  const missingShards = [];
  for (const rel of shardDecl.declared) {
    if (existsSync(join(SPEC, rel))) addSpecRel(rel);
    else missingShards.push(rel);
  }
  if (missingShards.length) {
    console.error(`✗  public citations — REFUSING: ${missingShards.length} of ${shardDecl.declared.length} declared shard(s) are not on disk.`);
    for (const rel of missingShards) console.error(`      ${join(SPEC, rel)}`);
    console.error(`   Declared by the \`shards\` block in ${join(SPEC, SPEC_INDEX)}. A register whose shards are only`);
    console.error('   partly present resolves citations against part of itself and prints nothing about it.');
    console.error('   Exit 2 COVERAGE LOST, which is deliberately not a pass.');
    process.exit(2);
  }
}
/* One level deeper, declared or not, so an undeclared shard is READ rather than
   skipped and a corpus carrying no `shards` block at all still resolves. Deeper than
   one level is not walked: the declared layout is `<register>/<shard>.json`, and a
   guard that recursed would start indexing `requirements/tooling/retired/`. */
for (const e of readdirSync(SPEC, { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  let inner;
  try { inner = readdirSync(join(SPEC, e.name)); } catch { continue; }
  for (const f of inner) {
    if (f.endsWith('.json')) addSpecRel(`${e.name}/${f}`);
  }
}
/* ── SHARD DESCENT END ───────────────────────────────────────────────────────── */

const declaredShardSet = new Set(shardDecl ? shardDecl.declared : []);

/* Every `origin` the spec knows, plus the frozen harvest in origins.lock.json —
   which is DATA, not a cache: the prose it came from no longer exists, so it can
   never be regenerated. Both are read because an id can be declared in one and
   cited from the other. */
const origins = new Set();
let specFiles = 0;
let shardsRead = 0;
for (const rel of specRels) {
  let j;
  try { j = JSON.parse(readFileSync(join(SPEC, rel), 'utf8')); } catch (e) {
    /* An UNDECLARED file that will not parse is skipped exactly as it always was —
       the top level carries schemas and notes this guard has never needed. A DECLARED
       shard that will not parse is a refusal: the declaration says its entries are in
       the table, so dropping it thins the table by a chunk the floor may not be low
       enough to notice. */
    if (declaredShardSet.has(rel)) {
      console.error(`✗  public citations — REFUSING: declared shard ${join(SPEC, rel)} could not be parsed.`);
      console.error(`   ${e.message}`);
      console.error('   A declared shard that is on disk and unreadable is not a smaller table, it is an');
      console.error('   unknown one. Exit 2 COVERAGE LOST.');
      process.exit(2);
    }
    continue;
  }
  specFiles++;
  if (declaredShardSet.has(rel)) shardsRead++;
  const walk = (v) => {
    if (typeof v === 'string') { if (/^\[\d+\][A-Za-z]/.test(v)) origins.add(v); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') { Object.values(v).forEach(walk); }
  };
  walk(j);
}
/* THE SHARD FLOOR IS THE DECLARATION'S OWN COUNT, never a typed number: a scan that
   reads fewer shards than the block declares is exit 2 in both private guards and it
   is exit 2 here. The two limbs above make it unreachable on any tree they have both
   run on, and it is carried anyway — it is the assertion that the two halves of this
   scan agree about how big the resolution table is. */
if (shardDecl && shardsRead !== shardDecl.declared.length) {
  console.error(`✗  public citations — REFUSING: read ${shardsRead} of the ${shardDecl.declared.length} declared shard(s).`);
  console.error('   The declaration and the scan disagree about the size of the resolution table.');
  process.exit(2);
}
/* 352 distinct origin refs on 2026-08-17: the union of every `origin` field in
   the spec arrays and the 221 `knownIds` + 204 `requirementHeadings` frozen in
   origins.lock.json. The floor sits below that with headroom, and it EARNED its
   place on the first run — it was initially written as 400, a number carried over
   from a throwaway measurement, and it refused rather than resolving 1,453
   citations against a table it could not justify. The number here is the measured
   one; the earlier one was a guess wearing a floor's clothes. */
const ORIGIN_FLOOR = 300;
if (origins.size < ORIGIN_FLOOR) {
  console.error(`✗  only ${origins.size} origin ref(s) parsed from ${specFiles} spec file(s) — below ${ORIGIN_FLOOR}.`);
  console.error(`   Read from ${SPEC}: ${specRels.length} path(s), of which ${shardsRead} declared shard(s)` +
    (shardDecl ? ` out of ${shardDecl.declared.length} declared.` : ', no `shards` block declared.'));
  console.error('   Refusing: a thin resolution table would silently accept a dead citation. If the corpus is');
  console.error('   sharded and the shard count above is 0, the scan did not descend and THAT is the defect,');
  console.error('   not the floor — see the SHARD DESCENT block above.');
  process.exit(2);
}
/* Public tags usually omit the leading stage number (`[pipeline C-6]` for
   `[2]C-6`), so resolve on the bare id as well as the full form. */
const bareOrigins = new Set([...origins].map((o) => o.replace(/^\[\d+\]/, '')));

/* The logical prefix every private citation is written with. RE_PRIVATE_PATH
   cannot match without it, so slicing it off a match is total, not a lucky case. */
const LOGICAL_PREFIX = 'Private/';
const RE_PRIVATE_PATH = /Private\/[A-Za-z0-9_.{}-]+(?:\/[A-Za-z0-9_.{}-]+)*/g;
const RE_PIPELINE_TAG = /\[pipeline ([^\]]{1,120})\]/g;
/* An id is a letter-block, a dash and a number, optionally sub-lettered: C-6,
   F-5a, N-4, S-12r. Extracted from ANYWHERE in the tag body, so `C-2/C-7`,
   `C-3, C-9` and `N-4 clause 7` each yield the ids they actually name. */
const RE_ID = /\b([A-Z]{1,2}-\d{1,3}[a-z]?)\b/g;

/** `requirements/<register>.json` -> `requirements/<register>/`, and only when the
 *  `shards` block declares that register AND the directory is on disk. The register
 *  set comes from the DECLARATION rather than from a hard-coded list, so the next
 *  register to be sharded needs no edit here. RE_PRIVATE_PATH only ever matches
 *  forward slashes, so there is nothing to normalise. */
const SHARD_PREFIX = 'requirements/';
const SHARD_SUFFIX = '.json';
const SHARDED_REGISTERS = new Set((shardDecl ? shardDecl.declared : []).map((rel) => rel.split('/')[0]));
function resolvesOntoShardDir(relFromPrivate) {
  if (!relFromPrivate.startsWith(SHARD_PREFIX) || !relFromPrivate.endsWith(SHARD_SUFFIX)) return false;
  const register = relFromPrivate.slice(SHARD_PREFIX.length, -SHARD_SUFFIX.length);
  if (!register || register.includes('/')) return false;
  if (!SHARDED_REGISTERS.has(register)) return false;
  return existsSync(join(SPEC, register));
}

const DISCLOSED = /\(\s*(?:does not exist|never existed|no longer exists|deleted|retired|gone|removed|absent)/i;

const failures = [];
let pathsChecked = 0, tagsChecked = 0, idsChecked = 0, filesScanned = 0;
let skippedStruck = 0, skippedDisclosed = 0;

for (const rel of files) {
  const abs = join(REPO, rel);
  let text;
  try { text = readFileSync(abs, 'utf8'); } catch { continue; }
  if (text.includes(' ')) {
    /* Three tracked guard sources carry literal NUL bytes, so they read as binary
       to grep. They are still TEXT and still carry citations, so they are scanned
       here rather than skipped — the NUL is stripped for matching only. */
    text = text.split(' ').join('');
  }
  filesScanned++;
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const disclosed = DISCLOSED.test(line);

    /* Strikethrough is retracted text. Strip the struck spans before matching so a
       retracted citation inside a live line is not checked, while the rest is. */
    let scan = line;
    if (scan.includes('~~')) {
      const stripped = scan.replace(/~~[^~]*~~/g, '');
      if (stripped !== scan) skippedStruck++;
      scan = stripped;
    }

    for (const m of scan.matchAll(RE_PRIVATE_PATH)) {
      const p = m[0].replace(/[.,;:)]+$/, '');
      if (p === 'Private' || p === 'Private/') continue;
      pathsChecked++;
      /* Swap the logical prefix for the resolved root, keeping the remainder. Was
         `join(REPO, p)` until 2026-08-18, which only worked while `Private/` was a
         real subdirectory of the repo; it is a logical prefix now — see
         PRIVATE_CANDIDATES at the head.
         (Written first with a literal example path here, which this guard then
         flagged against itself on the very next run — its own source is a tracked
         public file. Left recorded rather than quietly fixed: it is the negative
         test this edit needed, and it cost nothing to get.) */
      if (existsSync(join(PRIVATE, p.slice(LOGICAL_PREFIX.length)))) continue;
      /* THE SHARD TOMBSTONE, AND WHY THE PATH LIMB NEEDS ITS OWN (2026-09-08).
         The spec scan above taught the ORIGIN TABLE to read a sharded register. It
         did nothing for THIS limb, which resolves a cited PATH, and the two fail
         apart: with the sharding applied the origin table is complete and four public
         files still cite `Private/requirements/ledger.json` and `.../not-built.json` -
         a dated line in sites/_shared/README.md and three guard comments each naming a
         specific entry. Those registers moved into `<register>/NN-<topic>.json`; the
         bytes that cite them are dated records and comments, which ADR 053 rule 2 says
         are appended beside and never rewritten.
         MEASURED, and only visible once the origin fix landed: before it this guard
         exited 2 on the floor and never reached this loop, so the run S3 section 2.2
         recorded saw one defect where there were two.
         So a declared shard directory RESOLVES ITS OWN PRE-SHARD FILENAME. That does
         not weaken the limb. The register must still be there, as a directory the
         `shards` block declares and whose every shard was proven present above (exit 2
         otherwise). A path naming a register that was genuinely deleted still fails,
         because a deleted register is not in the block. */
      if (shardDecl && resolvesOntoShardDir(p.slice(LOGICAL_PREFIX.length))) continue;
      if (disclosed) { skippedDisclosed++; continue; }
      failures.push({ rel, line: i + 1, kind: 'path', what: p, text: line.trim().slice(0, 130) });
    }

    for (const m of scan.matchAll(RE_PIPELINE_TAG)) {
      tagsChecked++;
      const body = m[1];
      const ids = [...body.matchAll(RE_ID)].map((x) => x[1]);
      if (!ids.length) continue;   // `[pipeline 7]` — a bare stage, nothing to resolve
      for (const id of ids) {
        idsChecked++;
        if (bareOrigins.has(id) || origins.has(id)) continue;
        if (disclosed) { skippedDisclosed++; continue; }
        failures.push({ rel, line: i + 1, kind: 'tag', what: id, text: line.trim().slice(0, 130) });
      }
    }
  }
}

/* The resolution ROOT is printed, not just the counts. After 2026-08-18 `Private/`
   is a logical prefix with more than one possible answer, so a report that says
   how many citations resolved without saying what they resolved AGAINST is not a
   report a reader can check. */
const label = `${filesScanned} tracked file(s) · ${pathsChecked} Private/ path ref(s) ` +
  `resolved against ${PRIVATE} · ` +
  `${tagsChecked} [pipeline] tag(s) yielding ${idsChecked} id(s), resolved against ` +
  `${origins.size} origin(s) from ${specFiles} spec file(s)` +
  (shardDecl ? `, ${shardsRead} of them declared shard(s) under ${Object.keys(shardDecl.declared.reduce((a, r) => { a[r.split('/')[0]] = 1; return a; }, {})).length} sharded register(s)` : ' (no `shards` block declared)');

if (!failures.length) {
  console.log(`ok  public citations — every citation resolves. ${label}` +
    (skippedStruck || skippedDisclosed
      ? ` [${skippedStruck} struck-through span(s) and ${skippedDisclosed} disclosed absence(s) not checked, by convention]`
      : ''));
  process.exit(0);
}

/* Group by file so a 60-hit register reads as one problem, not sixty. */
const byFile = new Map();
for (const f of failures) {
  if (!byFile.has(f.rel)) byFile.set(f.rel, []);
  byFile.get(f.rel).push(f);
}
console.error(`✗  public citations — ${failures.length} unresolved citation(s) in ${byFile.size} file(s). ${label}\n`);
for (const [rel, hits] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.error(`  ${rel}  (${hits.length})`);
  for (const h of hits.slice(0, 6)) {
    console.error(`    :${h.line}  ${h.kind === 'path' ? 'no such path' : 'unknown requirement id'}  ${h.what}`);
  }
  if (hits.length > 6) console.error(`    … and ${hits.length - 6} more in this file`);
}
console.error('\n  A citation that still parses and no longer points at the right thing is this');
console.error('  corpus\'s most repeated defect. Repoint it, or disclose the absence on the same');
console.error('  line — `(deleted 2026-08-15)` — which this guard accepts and a reader can see.\n');
process.exit(1);
