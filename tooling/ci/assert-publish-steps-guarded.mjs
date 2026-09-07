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
import { existsSync, readFileSync } from 'node:fs';
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

/** The register the publishing-script domain is derived from. */
const REGISTER_REL = 'tooling/channel-register.json';

/** Third-party actions a release job may use without the guard. Both fetch code
 *  into the runner and neither hands anything out of it. Anything else is a
 *  publishing surface until somebody says otherwise here, in this file, with the
 *  requirement that the exemption is actually USED. */
const ALLOWED_ACTIONS = ['actions/checkout', 'actions/setup-node'];

/** A host pattern that admits only real SUBDOMAINS of the given host, and ends at
 *  a path, port, query or fragment.
 *
 *  🔴 THE OBVIOUS SPELLING IS THE WRONG ONE, AND CodeQL SAID SO ON 2026-09-07.
 *  This started as `https?://[A-Za-z0-9.-]*addons\.mozilla\.org` — carried over
 *  verbatim from the bash step this guard replaces — and `js/regex/missing-regexp-anchor`
 *  flagged three of them as HIGH. The character class admits a hyphen and a dot
 *  with no boundary, so `https://evil-addons.mozilla.org.attacker.test` matches
 *  both ends of it. Here the consequence is over-matching in a scanner rather
 *  than a trust decision, so nothing was exploitable — but a host matcher that is
 *  wrong in a guard is a host matcher somebody copies into a place where it is a
 *  trust decision. Fixed at the source rather than dismissed. */
const host = (h) => `https?://(?:[A-Za-z0-9-]+\\.)*${h}(?:[/:?#]|$)`;

/** A `run:` line that hands bytes to something outside the run. Every alternative
 *  is a command or a host this repository actually reaches; a respelling that
 *  slips past it is what the "zero graded" floor below exists to catch. */
const PUBLISH_SURFACE_PARTS = [
    'gh release (create|upload|edit|delete)',
    'web-ext (sign|submit)',
    'chrome-webstore-(upload|api)',
    host('addons[.]mozilla[.]org'),
    host('chromewebstore[.]googleapis[.]com'),
    `${host('googleapis[.]com')}?upload`,
    host('clients2[.]google[.]com'),
    host('addons[.]microsoftedge[.]microsoft[.]com'),
];

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

/** THE PUBLISH SCRIPTS THIS LANE RUNS, DERIVED FROM THE REGISTER — never
 *  enumerated here.
 *
 *  🔴 THE ENUMERATION WAS A MEASURED HOLE, 2026-09-07. This constant used to be
 *  the literal alternation `publish-(amo|cws|edge)` + `.mjs`, written by hand
 *  beside the hosts. A fourth store's `publish-<x>.mjs` tests FALSE against it;
 *  the `graded === 0` floor below cannot fire, because the three existing
 *  surfaces keep `graded` at three; so the new store's submit step would be
 *  UNGRADED, this guard would exit 0, and a `workflow_dispatch` rehearsal would
 *  EXECUTE it. A guard whose domain is a hand-written list grows a hole every
 *  time the tree grows, silently, and in the one direction that matters.
 *
 *  The register already knows the answer. Every extension channel row carries
 *  `lane: { workflow, job }` — which is how it declares WHICH job emits its
 *  artifact — and now `publishScript`, the script that submits it. So the domain
 *  of this scan is exactly: the publish scripts of the rows whose lane names the
 *  workflow and job being graded. A new store lane is graded by the act of
 *  declaring its channel, and declaring a channel is already mandatory
 *  (`record-deployment.mjs` refuses to record a release for a row that does not
 *  exist).
 *
 *  TWO WAYS THIS CAN STILL BE WRONG, AND BOTH FAIL RATHER THAN PASS:
 *    · a register with no `publishScript` for this lane at all → COVERAGE LOST.
 *      Not "no publishing surfaces, therefore clean" — that is the exact shape
 *      the `graded === 0` floor exists to refuse, one level up.
 *    · a `publish-*.mjs` the JOB invokes that NO row declares → a finding. It is
 *      still graded (the generic pattern below catches the spelling), and it is
 *      reported, because a publishing script outside the register is a
 *      submission nothing records.
 */
function derivePublishScripts(root, workflowRel, jobName) {
  const abs = join(root, REGISTER_REL);
  if (!existsSync(abs)) {
    coverageLost([
      `${REGISTER_REL} does not exist under ${root}.`,
      'The set of publish scripts this lane runs is DERIVED from it. Without the file this guard would',
      'grade an empty set of scripts and lean entirely on the host patterns, which is a narrower check',
      'wearing the same "ok" line.',
    ]);
  }
  let register;
  try {
    register = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    coverageLost([`${REGISTER_REL} is not valid JSON — ${e.message}`, 'The publish-script domain cannot be derived from a file that does not parse.']);
  }
  const rows = (register.channels ?? []).filter(
    (c) => c?.lane?.workflow === workflowRel && c?.lane?.job === jobName && typeof c?.publishScript === 'string' && c.publishScript.trim() !== '',
  );
  const scripts = [...new Set(rows.map((c) => c.publishScript.trim()))].sort();
  if (scripts.length === 0) {
    coverageLost([
      `${REGISTER_REL} declares no channel with \`publishScript\` on lane ${workflowRel} · job "${jobName}".`,
      'This guard derives its publishing-script domain from those rows, so an empty derivation means it',
      'would grade only the host and `gh release` patterns while the lane still runs store submissions.',
      'Declare the script on the channel row it publishes; do not re-enumerate it here.',
    ]);
  }
  return scripts;
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

// ⚠ THE DERIVATION RUNS AFTER THE JOB LOOKUP, ON PURPOSE. A `--job` that does
// not exist would otherwise be diagnosed as "the register declares no publishScript
// on that lane", which is true and useless: the precise cause is the missing job,
// and a guard that names the wrong one of two simultaneous causes sends the next
// reader to the wrong file.
const PUBLISH_SCRIPTS = derivePublishScripts(ROOT, WORKFLOW, JOB);
// The alternation, built from the derived basenames. Every character class is a
// literal `[.]` rather than an escape, so this construction carries no backslash
// at all and cannot be mis-quoted by whatever writes it next; a basename with any
// other regex metacharacter is refused rather than escaped, because a publish
// script named with one is a naming mistake and not a case to support.
for (const p of PUBLISH_SCRIPTS) {
  if (!/^[A-Za-z0-9._-]+$/.test(p.split('/').pop())) {
    coverageLost([
      `${REGISTER_REL} declares publishScript ${JSON.stringify(p)}, whose basename carries a character this guard will not put in a pattern.`,
      'Rename the script to [A-Za-z0-9._-] or teach this guard the escape deliberately; silently escaping it',
      'is how a domain grows a member nobody can read back out of the pattern.',
    ]);
  }
}
const PUBLISH_SCRIPT_RE = new RegExp(PUBLISH_SCRIPTS.map((p) => p.split('/').pop().split('.').join('[.]')).join('|'));

/** Scripts under `extensions/scripts/` whose name starts `publish-` and which
 *  publish NOTHING. Each is a preflight or a token exchange that must be able to
 *  run on a rehearsal, so it is not a publishing surface — and each is written
 *  here BY NAME, with the reason, rather than being caught by a looser pattern.
 *  A `publish-*.mjs` that is neither declared on a channel row nor on this list
 *  is a finding, not a silent pass: that is the whole repair. */
const NON_PUBLISHING_SCRIPTS = new Map([
  ['publish-arming.mjs', 'the register preflight — it reads names out of the environment and prints a verdict; it makes no store call'],
  ['publish-cws-token.mjs', 'the OAuth refresh-token exchange — it obtains an access token and uploads nothing'],
  ['publish-cws-keepalive.mjs', 'the weekly keep-alive — it exercises the refresh token so Google does not revoke it for non-use'],
]);

const PUBLISH_SURFACE = new RegExp([...PUBLISH_SURFACE_PARTS, ...PUBLISH_SCRIPTS.map((p) => p.split('/').pop().split('.').join('[.]'))].join('|'));

/** Any `publish-<x>.mjs` a run line invokes, declared or not. Deliberately wider
 *  than PUBLISH_SURFACE so the two can DISAGREE — and the disagreement is the
 *  finding. */
// ⚠ THE WORD BOUNDARY IS NOT ENOUGH, AND THIS GUARD'S OWN NAME PROVES IT:
// `assert-publish-steps-guarded.mjs` contains `publish-steps-guarded.mjs`, and a
// hyphen is a non-word character, so /\bpublish-/ matched the guard invocation
// itself and reported it as an undeclared publisher (measured, 2026-09-07). The
// lookbehind requires the name to START at a path separator or whitespace.
const ANY_PUBLISH_SCRIPT = /(?<![A-Za-z0-9._-])publish-[A-Za-z0-9._-]+[.]mjs/g;

// The steps of the job, split on the step bullet. The bullet is matched at the
// step indent — six spaces, under `jobs:` → `<job>:` → `steps:` — the same kind
// of anchor `parseWorkflow` uses for job keys at four.
const steps = [];
const invokedScripts = new Map(); // basename -> first line it appears on
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
  // Every publish-*.mjs the job invokes, whatever this guard's derived domain
  // says. Compared against the register below.
  for (const m2 of bare.matchAll(ANY_PUBLISH_SCRIPT)) invokedScripts.set(m2[0], line.n);
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

// ── THE DOMAIN CHECK, IN THE DIRECTION THE ENUMERATION USED TO FAIL ─────────
// The steps above were graded against a domain DERIVED from the register. This
// limb asks the opposite question: does the job invoke a publish script the
// register has never heard of? Before 2026-09-07 the answer was invisible — the
// pattern was a hand-written alternation, a fourth store's script tested false,
// and the `graded === 0` floor could not fire because the first three kept the
// count non-zero. An undeclared publish script is not merely ungraded: it is a
// submission `record-deployment.mjs` will have no channel row to record.
const declaredBasenames = new Set(PUBLISH_SCRIPTS.map((p) => p.split('/').pop()));
for (const [basename, atLine] of invokedScripts) {
  if (declaredBasenames.has(basename)) continue;
  if (NON_PUBLISHING_SCRIPTS.has(basename)) continue;
  problems.push(
    `UNDECLARED publish script  ${basename}\n             ${WORKFLOW}:${atLine}, job \"${JOB}\"\n` +
      `             no channel row in ${REGISTER_REL} names it as its \`publishScript\` on this lane, and it is not on this ` +
      'guard list of publish-named scripts that publish nothing (NON_PUBLISHING_SCRIPTS). Declare the channel it submits to, or ' +
      'add it there with the reason — an undeclared submission is one nothing records.',
  );
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
