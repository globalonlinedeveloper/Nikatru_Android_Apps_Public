#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-publish-steps-guarded.mjs — every publishing surface in a release job
// carries the dry-run guard, and the REGION IS THE JOB, not a pair of comments.
//
// Pipeline requirement: [10]D-9 / [9]R-4 — a rehearsal must not publish, and the
// check that proves it must not be able to grade nothing while reporting success.
//
// 🔴 WHY THIS FILE EXISTS AT ALL, MEASURED 2026-09-07. The check it replaces was
// an inline bash step in `.github/workflows/extensions.yml` that bounded itself
// with two COMMENT lines:
//
//     sed -n '/^# >>> RELEASE LANE >>>/,/^# <<< RELEASE LANE <<</p' extensions.yml
//
// PR #500 stripped prose comments out of the workflows. Both sentinels were
// comment lines, so both were deleted, and the region became EMPTY: on `main` at
// b61f15b6 the file carried ZERO `^# >>> RELEASE LANE >>>` lines (`grep -c`
// answers 0; the commit before #500 answers 2). The step's own floor then fires
// — "matched only 0 step boundaries" — so the first real tag push would have
// gone red at the check rather than published something ungraded. Fail-closed,
// and still a defect: the check's SUBJECT was deletable by an edit that had
// nothing to do with publishing, and nothing in the tree compared the two.
//
// The repair is not a third sentinel. It is to bound the region by the thing the
// runner itself bounds a job by — the YAML — through the ONE workflow parse this
// repository has (`workflow-scan.mjs` `parseWorkflow`), so that the region can
// only be emptied by deleting the job.
//
// ── WHAT IT GRADES ───────────────────────────────────────────────────────────
// Inside the named job, every step is read for two kinds of surface:
//   · a THIRD-PARTY ACTION (`uses:`) that is not on the exemption list, and
//   · a PUBLISHING COMMAND — a `run:` line that hands bytes to a store or to a
//     GitHub Release.
// Each such step must carry an `if:` CONTAINING the guard expression. The test
// is substring containment and can prove nothing about what the expression
// EVALUATES to, so the one shape that defeats containment is refused outright: a
// `||` anywhere in the `if:` is a disjunction that can satisfy it without the
// guard (`inputs.dry_run != true || true` was measured GUARDED, exit 0, in a
// scratch tree on 2026-08-27). No step in a release job legitimately needs one.
//
// ── ITS OWN FLOORS ───────────────────────────────────────────────────────────
// Two, because both zero-answers look exactly like a pass:
//   · fewer than MIN_STEPS step boundaries read → COVERAGE LOST. The job was
//     renamed, moved, or the parse stopped reaching it.
//   · zero publishing surfaces graded → FAIL. A scan that found nothing to grade
//     has proved nothing about what the workflow publishes, and the likely cause
//     is a publishing command respelled past the pattern.
// An exemption that no step uses is also a failure: an exemption outlives the
// step it was written for and then pre-authorises whatever takes that name next.
//
// Usage:
//   node tooling/ci/assert-publish-steps-guarded.mjs
//   node tooling/ci/assert-publish-steps-guarded.mjs --workflow <rel> --job <name>
//   node tooling/ci/assert-publish-steps-guarded.mjs --repo-root <path>
//
// Exit 0 = every publishing surface in the job is behind the guard. 1 = it is
// not, or the scan could not see enough of the job to be evidence.
//
// LANE-BOUND: extensions.yml — and the binding IS the repair rather than an oversight inside it.
// The check this file replaces was an inline step inside that one workflow, bounded by two comment
// lines in that one workflow, and the defect was precisely that its subject could be deleted by an
// unrelated edit. Binding it to the file it grades, by name, is what makes the subject
// undeletable-in-silence: point it at a workflow that is not there, or a job that is not there, and
// it exits COVERAGE LOST rather than clean. The binding is a DEFAULT and not a limit — the two
// options above take any lane, so the day a second release lane appears it is graded by this code
// and not by a second copy of it. Deriving the lane from tooling/channel-register.json was
// considered and refused: three channel rows name this workflow's `release` job, so a derivation
// would grade the same job three times and say nothing the default does not.
// ─────────────────────────────────────────────────────────────────────────────
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflow } from './workflow-scan.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const ROOT = resolve(opt('repo-root', join(dirname(fileURLToPath(import.meta.url)), '..', '..')));
const WORKFLOW = opt('workflow', '.github/workflows/extensions.yml');
const JOB = opt('job', 'release');

/** The guard expression a publishing step's `if:` must contain. One spelling,
 *  because two spellings is how a step ends up "guarded" by a condition nobody
 *  compared to the one the other steps use. */
const GUARD = 'inputs.dry_run != true';

/** Third-party actions a release job may use without the guard. Both fetch code
 *  into the runner and neither hands anything out of it. Anything else is a
 *  publishing surface until somebody says otherwise here, in this file, with the
 *  requirement that the exemption is actually USED. */
const ALLOWED_ACTIONS = ['actions/checkout', 'actions/setup-node'];

/** A `run:` line that hands bytes to something outside the run. Every alternative
 *  is a command or a host this repository actually reaches; a respelling that
 *  slips past it is what the "zero graded" floor below exists to catch. */
const PUBLISH_SURFACE = new RegExp(
  [
    'gh release (create|upload|edit|delete)',
    'web-ext (sign|submit)',
    'publish-(amo|cws|edge)\\.mjs',
    'chrome-webstore-(upload|api)',
    'https?://[A-Za-z0-9.-]*addons\\.mozilla\\.org',
    'https?://[A-Za-z0-9.-]*chromewebstore\\.googleapis\\.com',
    'https?://[A-Za-z0-9.-]*googleapis\\.com/upload',
    'https?://[A-Za-z0-9.-]*clients2\\.google\\.com/service/update2',
    'https?://[A-Za-z0-9.-]*addons\\.microsoftedge\\.microsoft\\.com',
  ].join('|'),
);

/** The step-count floor. The release job carried well over twenty steps when this
 *  guard was written; the floor is deliberately far below that, because its job
 *  is to catch a region that has COLLAPSED (a renamed job, a parse that stopped
 *  reaching the file), not to ratchet on every step somebody adds or removes. */
const MIN_STEPS = 10;

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-publish-steps-guarded: FAILED');
  process.exit(1);
}

const wf = parseWorkflow(ROOT, WORKFLOW);
if (wf === null) {
  coverageLost([
    `${WORKFLOW} does not exist under ${ROOT}.`,
    'Every check below quantifies over that file’s steps. With it gone the grade would range over an',
    'empty set and print a pass over a workflow nobody read.',
  ]);
}
const job = wf.jobs.get(JOB);
if (job === undefined) {
  coverageLost([
    `${WORKFLOW} declares no job "${JOB}" — it declares [${[...wf.jobs.keys()].join(', ')}].`,
    'The job IS the region this guard bounds. A job that is not there cannot be graded, and grading',
    'the rest of the file would sweep every CI step into a publishing check that has no business',
    'reading them.',
  ]);
}

// The steps of the job, split on the step bullet. The bullet is matched at the
// step indent — six spaces, under `jobs:` → `<job>:` → `steps:` — the same kind
// of anchor `parseWorkflow` uses for job keys at four.
const steps = [];
let current = null;
for (const line of job.lines) {
  const text = line.text;
  if (/^ {6}- /.test(text)) {
    current = { n: line.n, name: null, cond: null, uses: null, surface: null };
    steps.push(current);
  }
  if (current === null) continue;
  const bare = text.trim();
  if (bare === '') continue;
  let m;
  if (current.name === null && (m = bare.match(/^-?\s*name:\s*(.+)$/))) current.name = m[1].trim();
  if (current.cond === null && (m = bare.match(/^-?\s*if:\s*(.+)$/))) current.cond = m[1].trim();
  if (current.uses === null && (m = bare.match(/^-?\s*uses:\s*(\S+)/))) current.uses = m[1].split('@')[0];
  if (current.surface === null && PUBLISH_SURFACE.test(bare)) current.surface = bare;
}

if (steps.length < MIN_STEPS) {
  coverageLost([
    `${WORKFLOW} job "${JOB}" yielded ${steps.length} step boundaries and the floor is ${MIN_STEPS}.`,
    'The step bullet is the literal six-space "      - ", so a re-indent of the file, or a job that has',
    'been emptied into a reusable workflow, collapses this scan to nothing — which grades clean.',
    'Fix the boundary or point this guard at the job that now holds the steps; do not lower the floor.',
  ]);
}

const problems = [];
const usedExemptions = new Set();
let graded = 0;
let guarded = 0;

for (const step of steps) {
  const why = [];
  if (step.uses !== null) {
    if (ALLOWED_ACTIONS.includes(step.uses)) usedExemptions.add(step.uses);
    else why.push(`third-party action  ${step.uses}`);
  }
  if (step.surface !== null) why.push(`publishing surface  ${step.surface}`);
  if (why.length === 0) continue;

  graded++;
  const label = `${WORKFLOW}:${step.n} step ${JSON.stringify(step.name ?? '(unnamed)')}`;
  const cond = step.cond ?? '';
  if (cond.includes('||')) {
    problems.push(
      `UNGUARDED  ${why.join(' + ')}\n             ${label}\n             its if: carries a ||, a disjunction that can satisfy it without: ${GUARD}`,
    );
  } else if (cond.includes(GUARD)) {
    guarded++;
    console.log(`GUARDED    ${why.join(' + ')}\n             ${label}`);
  } else {
    problems.push(`UNGUARDED  ${why.join(' + ')}\n             ${label}`);
  }
}

for (const a of ALLOWED_ACTIONS) {
  if (usedExemptions.has(a)) continue;
  problems.push(
    `"${a}" is on this guard's exemption list and no step in ${WORKFLOW} job "${JOB}" uses it. ` +
      'An exemption outlives the step it was written for and then pre-authorises whatever takes that name next. Delete the line.',
  );
}

if (graded === 0) {
  console.error('');
  console.error(
    `FAIL ${WORKFLOW} job "${JOB}": ${steps.length} step boundaries read and NO publishing surface graded at all.`,
  );
  console.error('     ZERO IS NOT A PASS: a scan that finds nothing to grade has proved nothing about what this');
  console.error('     job publishes, and the likely cause is a publishing command respelled past the pattern in');
  console.error('     this guard. Fix the pattern; do not delete this check while the lane still publishes.');
  console.error('\nassert-publish-steps-guarded: FAILED');
  process.exit(1);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(p);
  console.error('');
  console.error(
    `FAIL ${problems.length} finding(s) above. A workflow_dispatch rehearsal would EXECUTE an unguarded publishing step.`,
  );
  console.error('\nassert-publish-steps-guarded: FAILED');
  process.exit(1);
}

console.log(`${steps.length} step boundaries read; ${graded} publishing-surface step(s), all ${guarded} behind an if:.`);
process.exit(0);
