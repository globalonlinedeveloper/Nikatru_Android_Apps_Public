// gen-start-here.mjs — WRITE `START-HERE.md`, this repository's entry card.
//
// WHAT IT IS FOR. A cold session in this repo used to be told to read
// `Private/platform-state/` whole and `Private/TRAPS.md` before running anything.
// Measured on 2026-09-08 with `stat -c%s`, that mandated path is 434,324 bytes,
// about 108,581 tokens at bytes/4 — more than half of a 200K window spent before
// the first line of work, on facts a query answers in forty lines. This card is
// the replacement: what this repo IS, where things live, what the gate enforces,
// and the handful of rules that bite. Everything else is fetched by name.
//
// WHY GENERATED, AND NOT WRITTEN. `AGENTS.md` is 13 KiB and nothing measured it
// until 2026-09-08; the corpus's hand-written entry page (`NOW.md`) went a day
// stale and wrong about two of its own numbers before it was retired. A file a
// human types accumulates the day's story. So every count in this card is read
// off the tree on the line that prints it, and `--check` fails on a diff — a
// hand edit is a red guard, not a second copy of a measurement.
//
// EXIT CODES, the corpus convention: 0 green, 1 a finding (`--check` saw a diff),
// 2 COVERAGE LOST — the guard did not see enough to be evidence, which is
// deliberately NOT a pass.
//
//   node tooling/scripts/gen-start-here.mjs           write the card
//   node tooling/scripts/gen-start-here.mjs --check   fail on a diff
//   code=$?
//   echo "EXIT"
//   echo "$code"

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflow } from '../ci/workflow-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const s of ['AGENTS.md', 'tooling', 'apps', '.github']) {
  if (!existsSync(join(ROOT, s))) {
    console.error('x COVERAGE LOST — ' + ROOT + ' does not look like Nikatru_Platform_Public (missing ' + s + ').');
    process.exit(2);
  }
}

/* The INDEX, never the working directory: a concurrent writer's untracked file
   must not change what this card claims. Same reason check-agent-docs.mjs reads
   `ls-files --cached`. */
function git(args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', '-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error('x COVERAGE LOST — git ' + args.join(' ') + ' failed: ' + String(r.stderr || '').trim());
    process.exit(2);
  }
  return r.stdout;
}
const tracked = git(['ls-files', '--cached']).split('\n').filter(Boolean);

/* ── FLOORS ────────────────────────────────────────────────────────────────
   A card generated over an empty tree would be a confident, clean, wrong page.
   Each floor is a declared minimum; under it this run is not evidence. */
const topDirs = [...new Set(tracked.filter((p) => p.includes('/') && !p.startsWith('.')).map((p) => p.split('/')[0]))].sort();
const count = (re) => tracked.filter((p) => re.test(p)).length;
const guards = count(/^tooling\/ci\/[^/]+\.mjs$/);
const guardTests = count(/^tooling\/ci\/test\/[^/]+\.test\.mjs$/);
const workflows = count(/^\.github\/workflows\/[^/]+\.ya?ml$/);
const apps = [...new Set(tracked.filter((p) => /^apps\/[^/]+\//.test(p)).map((p) => p.split('/')[1]))].sort();
const pkgs = [...new Set(tracked.filter((p) => /^packages\/[^/]+\//.test(p)).map((p) => p.split('/')[1]))].sort();
const workers = [...new Set(tracked.filter((p) => /^services\/[^/]+\//.test(p)).map((p) => p.split('/')[1]))].length;
const sites = [...new Set(tracked.filter((p) => /^sites\/[^/]+\//.test(p)).map((p) => p.split('/')[1]))].length;
const exts = [...new Set(tracked.filter((p) => /^extensions\/[^/]+\//.test(p)).map((p) => p.split('/')[1]))].length;

/* The required check is not typed here either: it is the job id `ci-gate` in
   ci.yml, and its `needs:` list is how many jobs must be green before a merge.
   Read through the SHARED parser rather than a hand-rolled one — `needs:` has
   three spellings in this tree and a private regex has already read two of them
   wrongly (`workflow-scan.mjs` carries that history). A first draft of this file
   split on /\n {4}\w/ and stopped at `name:` before reaching `needs:`, which the
   floor below caught as gateNeeds 0. */
const gateJob = parseWorkflow(ROOT, '.github/workflows/ci.yml')?.jobs.get('ci-gate') ?? null;
const gateNeeds = gateJob ? gateJob.needs.length : 0;

const floors = { tracked: 1000, topDirs: 8, guards: 100, guardTests: 40, workflows: 10, apps: 1, pkgs: 4, gateNeeds: 3 };
const got = { tracked: tracked.length, topDirs: topDirs.length, guards, guardTests, workflows, apps: apps.length, pkgs: pkgs.length, gateNeeds };
const under = Object.entries(floors).filter(([k, min]) => got[k] < min);
if (under.length > 0) {
  console.error('x COVERAGE LOST — ' + under.map(([k, min]) => k + ' ' + got[k] + ' < ' + min).join('; '));
  console.error('  A floor is a declared minimum. Under it this run is not evidence, and it must not read as a pass.');
  process.exit(2);
}

/* ── THE CARD ──────────────────────────────────────────────────────────────
   Every number below is interpolated on the line that prints it. None of them
   can be typed wrongly, and none can age without `--check` going red.

   🔴 WHAT IS DELIBERATELY *NOT* IN THE CARD: the tracked-file COUNT. It is
   measured, printed on the run line and used as a floor — but a number that moves
   on every commit that adds a file would red `--check` on every such commit, and
   a guard that reds for a reason nobody cares about is a guard somebody unwires.
   Measured while writing this file: staging five new files moved it 2059 -> 2064
   and reddened the check. Every figure that IS in the card moves only when
   something structural moves — a guard, a workflow, an app, a package, a lane in
   the gate — which is exactly when a cold session's picture should be rewritten. */
const card = `# START HERE — \`Nikatru_Platform_Public\`

**GENERATED by \`node tooling/scripts/gen-start-here.mjs\`. Never hand-edit it; \`--check\`
fails on a diff.** Capped at 4 KiB by \`check-agent-docs\` limb A-SIZE.

## What this repo is

The **live code and CI repo** of the NIKATRU app factory: a Flutter app factory publishing to
six platforms, a build-free browser-extension factory, and two static sites. Its \`origin\` is
PUBLIC and stays public — the free GitHub-hosted CI minutes depend on it, and every build runs
on GitHub-hosted runners.

**It is one product, not the whole business.** Decisions, the spec, runbooks and the knowledge
set are the sibling private corpus, cited as the stable logical prefix \`Private/...\`. The
legal and tax identity is a third repo this one has no path to at all.

## The tree — ${topDirs.length} tracked top-level directories

${topDirs.map((d) => '`' + d + '`').join(' · ')}

${apps.length} app(s) (${apps.map((a) => '`' + a + '`').join(', ')}) · ${pkgs.length} shared Dart packages · ${workers} Cloudflare Worker(s) ·
${sites} static site(s) · ${exts} extension(s) · ${guards} guards in \`tooling/ci/\` with ${guardTests} test files.

🔴 **\`sites/\` is the live deploy source and the only copy.** Cloudflare Pages builds both
domains from this repo through a binding that lives in the Cloudflare dashboard, in no file in
any repo. Do not delete, move or de-duplicate anything under \`sites/\`, \`pnpm-workspace.yaml\`
or \`pnpm-lock.yaml\`.

## What the merge gate enforces

\`ci-gate\` is the ONE required check and it needs ${gateNeeds} job(s) green; \`.github/workflows/ci.yml\`
decides which lane runs what, across ${workflows} workflow(s). Reproduce it locally with
\`node tooling/scripts/preflight.mjs\` — verifying a subset, or outside CI's environment, passes
while CI fails. The **spec guards** run from the git hooks instead, because their subject is
the private corpus and no CI job can read it: \`node tooling/scripts/spec-guards.mjs --fast\`.

## The rules that bite

- **Capture every exit code on its own line** (\`code=$?\` on the NEXT line). A \`$?\` after a pipe
  is the last stage's status and one printed beside \`$(basename …)\` is basename's; this project
  has read four false \`EXIT 0\`s that way.
- **\`0\` green, \`1\` a finding, \`2\` COVERAGE LOST** — which is deliberately not a pass. Never
  \`git checkout\` around it and never \`--no-verify\` past it.
- **A green guard after a refactor is evidence of nothing.** Moved code leaves a guard's domain
  by moving house: run the OLD guard against a mutation, green control first.
- **Any edit to a cited file shifts every \`<file>:NNNN\` citation below it** and most land on
  some other real line silently. Re-measure with \`grep -n\`, after the last edit.
- **Never run a \`flutter\` command in a subdirectory** — it rewrites the root \`pubspec.lock\`.
- **Never write a number into prose.** A fact goes to \`Private/platform-state/\` as
  \`{value, asOf, verify}\`; narrative that is dated belongs in git history and nowhere else.
- **Branch, PR, merge.** Cut every branch from an up-to-date \`main\`; \`git branch --merged\` lies
  in a squash-merge repo, so the PR state is the authoritative test.

## Query, do not read

    node ../Nikatru_Platform_Private/requirements/tooling/state.mjs <ID>       one row, with its verify
    node ../Nikatru_Platform_Private/requirements/tooling/state.mjs --next     what to pick up
    node ../Nikatru_Platform_Private/requirements/tooling/state.mjs --traps ci the traps for an area

\`Private/platform-state/\` is ~300 KiB of register and \`Private/TRAPS.md\` another 105 KiB.
Never read one whole. \`AGENTS.md\` (auto-loaded) holds the rest of the house rules;
\`Private/START-HERE.md\` and \`Private/platform-state/brief.md\` are the corpus's own two cards.
`;

const OUT = join(ROOT, 'START-HERE.md');
const CHECK = process.argv.includes('--check');
const bytes = Buffer.byteLength(card, 'utf8');
console.log('gen-start-here — ' + tracked.length + ' tracked file(s), ' + topDirs.length + ' top dir(s), ' + guards + ' guard(s), ci-gate needs ' + gateNeeds + ' job(s)');
console.log('  START-HERE.md would be ' + bytes + ' bytes (cap 4096, enforced by check-agent-docs limb A-SIZE)');

if (CHECK) {
  const on = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
  if (on === card) { console.log('ok  START-HERE.md is what the tree generates.'); process.exit(0); }
  console.error('x START-HERE.md differs from what the tree generates. It is GENERATED — re-run without --check and commit the diff. Never hand-edit it.');
  process.exit(1);
}
writeFileSync(OUT, card, 'utf8');
console.log('wrote ' + OUT);
process.exit(0);
