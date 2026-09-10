// ─────────────────────────────────────────────────────────────────────────────
// triage-failed-runs.test.mjs — the ledger's UNEXPLAINED count moves when the
// classifier loses a signature, and only then.
//
// 🔴 THE CLAIM UNDER TEST IS "UNEXPLAINED: 0 MEANS EVERY RUN WAS ACCOUNTED
// FOR", and a ledger that printed 0 over a fixture where nothing could match
// would be consistent with a classifier that explains everything by never
// looking. So the proof is a PAIR: the same fixture through the real signature
// table answers 0 (the green control), and through a table with ONE known
// signature removed — first in-process, then as a textual mutation of a COPY
// of the script — answers 1, naming the exact run that lost its group. The
// original file is asserted untouched afterwards: the mutation is restored by
// never having been applied to it.
//
// ⚠️ NOTHING HERE TOUCHES THE NETWORK OR GITHUB. Every CLI case runs through
// the fixture transport, which has no `fetch` in it. The one live-shaped case
// asserts only the "no credential" exit, driven by withholding the token and
// pointing the vault at an absent file.
//
// Run:  node --test tooling/ci/test/triage-failed-runs.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  NON_GREEN,
  GATE_STEP,
  SIGNATURES,
  CAUSES_REL,
  stripPrefix,
  scopeToStep,
  errorBlock,
  signatureOf,
  normalise,
  classifyRun,
  newerRunDuring,
  loadCauses,
  causeFor,
  proofFor,
  isExplained,
  groupRows,
  renderTable,
  parseArgs,
  ledger,
  fixtureApi,
} from '../../ops/triage-failed-runs.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const SCRIPT = join(REPO, 'tooling', 'ops', 'triage-failed-runs.mjs');
const SAFE_RERUN = join(REPO, 'tooling', 'ops', 'safe-rerun.mjs');

const temps = [];
function temp() {
  const d = mkdtempSync(join(tmpdir(), 'triage-failed-runs-'));
  temps.push(d);
  return d;
}
after(() => {
  for (const d of temps) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* a leaked temp dir must never fail a suite */
    }
  }
});

/** Run a script with an environment built FROM SCRATCH — same reason as
 *  await-pr-checks.test.mjs: the script falls back to the local vault for a
 *  token, so an inherited environment would mean "no credential" on CI and
 *  "a real credential" on the owner's laptop. */
function run(script, args, env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NIKATRU_VAULT: join(temp(), 'absent.env'),
      ...env,
    },
  });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE FIXTURE — four runs, four shapes, every one explained by the real table
// ═══════════════════════════════════════════════════════════════════════════
const CI = '.github/workflows/ci.yml';
const OPS = '.github/workflows/ops-watch.yml';
const T = (s) => `2026-09-09T${s}Z`;
const line = (ts, text) => `${T(ts)} ${text}`;

const step = (name, conclusion, a, b) => ({ name, conclusion, started_at: T(a), completed_at: T(b) });

function fixture(dir, { causes = CAUSES, signatureMutation = null } = {}) {
  const runs = [
    // R1 — a guard caught START-HERE drift on a feature branch, since merged.
    { id: 1001, path: CI, workflow_id: 1, head_branch: 'feat-a', head_sha: 'aaaaaaaa1', event: 'pull_request', conclusion: 'failure', created_at: T('10:00:00'), updated_at: T('10:06:00') },
    // R2 — ops-watch on main, the RED-SINCE livelock.
    { id: 1002, path: OPS, workflow_id: 2, head_branch: 'main', head_sha: 'bbbbbbbb2', event: 'schedule', conclusion: 'failure', created_at: T('11:00:00'), updated_at: T('11:03:00') },
    // R3 — cancelled by a newer push to the same ref while still running.
    { id: 1003, path: CI, workflow_id: 1, head_branch: 'feat-b', head_sha: 'cccccccc3', event: 'pull_request', conclusion: 'cancelled', created_at: T('12:00:00'), updated_at: T('12:03:00') },
    // R4 — the newer push: dart format, then fixed, then green (R5, in newest.json).
    { id: 1004, path: CI, workflow_id: 1, head_branch: 'feat-b', head_sha: 'dddddddd4', event: 'pull_request', conclusion: 'failure', created_at: T('12:01:00'), updated_at: T('12:07:00') },
  ];
  writeFileSync(join(dir, 'runs.json'), JSON.stringify(runs));
  writeFileSync(join(dir, 'repo.json'), JSON.stringify({ repo: 'fixture/fixture' }));

  // R1 jobs: one guard lane red at START-HERE, ci-gate red downstream.
  writeFileSync(
    join(dir, '1001.jobs.json'),
    JSON.stringify({
      total_count: 2,
      jobs: [
        { id: 51, name: 'Guards — platform, data and ops', conclusion: 'failure', steps: [step('Checkout', 'success', '10:00:10', '10:00:20'), step('The guards must be able to fail', 'success', '10:00:20', '10:01:00'), step('START-HERE.md is what the tree generates', 'failure', '10:01:00', '10:01:30')] },
        { id: 52, name: 'ci-gate', conclusion: 'failure', steps: [step('Require all lanes green', 'failure', '10:05:00', '10:05:10')] },
      ],
    }),
  );
  writeFileSync(
    join(dir, '1001.job-51.log'),
    [
      line('10:00:30.0000000', '  ✔ a NON-ZERO exit prints the guard output unfiltered — the filter drops every `✗` line (0.2ms)'),
      line('10:00:40.0000000', '  ✗ COVERAGE LOST — a fixture printed by a PASSING negative test, which must NOT be read as the failure'),
      line('10:01:05.0000000', 'gen-start-here — 2118 tracked file(s), 9 top dir(s), 165 guard(s), ci-gate needs 14 job(s)'),
      line('10:01:06.0000000', '  START-HERE.md would be 3713 bytes (cap 4096)'),
      line('10:01:07.0000000', '  START-HERE.md is STALE: regenerate it with node tooling/scripts/gen-start-here.mjs'),
      line('10:01:08.0000000', '##[error]Process completed with exit code 1.'),
    ].join('\n'),
  );
  writeFileSync(join(dir, '1001.job-52.log'), line('10:05:05.0000000', '##[error]One or more CI lanes failed'));

  // R2 jobs: the register reader.
  writeFileSync(
    join(dir, '1002.jobs.json'),
    JSON.stringify({
      total_count: 1,
      jobs: [{ id: 61, name: 'The register', conclusion: 'failure', steps: [step('The whole ops register — every duty, not just the heartbeat-backed ones', 'failure', '11:00:10', '11:02:00')] }],
    }),
  );
  writeFileSync(
    join(dir, '1002.job-61.log'),
    [
      line('11:01:00.0000000', '✗ tooling/ops/register.json — 1 problem(s):'),
      line('11:01:00.0000000', ''),
      line('11:01:00.0000000', '    duty.workflow.ops-watch.yml — RED SINCE 2026-09-09T09:58:00Z: ops-watch.yml on main run 34330000000 FAILED, and the newest SUCCESSFUL run on that branch is run 34320000000 at 2026-09-09T05:50:00Z, 4.1h EARLIER.'),
      line('11:01:01.0000000', '##[error]Process completed with exit code 1.'),
    ].join('\n'),
  );

  // R3 jobs: every lane cancelled a few seconds in, no logs at all.
  writeFileSync(
    join(dir, '1003.jobs.json'),
    JSON.stringify({
      total_count: 2,
      jobs: [
        { id: 71, name: 'Workspace gate', conclusion: 'cancelled', steps: [step('Run actions/checkout', 'cancelled', '12:00:10', '12:00:16')] },
        { id: 72, name: 'ci-gate', conclusion: 'failure', steps: [step('Require all lanes green', 'failure', '12:02:00', '12:02:05')] },
      ],
    }),
  );

  // R4 jobs: dart format.
  writeFileSync(
    join(dir, '1004.jobs.json'),
    JSON.stringify({
      total_count: 1,
      jobs: [{ id: 81, name: 'Workspace gate (melos analyze + test)', conclusion: 'failure', steps: [step('The shipping app is dart format-clean', 'failure', '12:03:00', '12:03:30')] }],
    }),
  );
  writeFileSync(
    join(dir, '1004.job-81.log'),
    [
      line('12:03:10.0000000', 'Changed apps/subly/lib/state/analytics_providers.dart'),
      line('12:03:11.0000000', 'Formatted 154 files (1 changed) in 0.69 seconds.'),
      line('12:03:12.0000000', '##[error]Process completed with exit code 1.'),
    ].join('\n'),
  );

  writeFileSync(
    join(dir, 'newest.json'),
    JSON.stringify({
      [`${CI}|feat-a`]: runs[0],
      [`${OPS}|main`]: { id: 1099, conclusion: 'success', created_at: T('13:00:00') },
      [`${CI}|feat-b`]: { id: 1005, conclusion: 'success', created_at: T('12:30:00') },
    }),
  );
  // R4 is R3's successor in the concurrency group — and it is what the API
  // answers for "runs of ci.yml on feat-b created while R3 lived".
  writeFileSync(join(dir, 'between-1003.json'), JSON.stringify([runs[3]]));
  writeFileSync(join(dir, 'branches.json'), JSON.stringify(['main', 'feat-b']));
  writeFileSync(join(dir, 'prs.json'), JSON.stringify({ 'feat-a': { number: 606, merged_at: T('17:53:54'), merge_commit_sha: '74bf73d4deadbeef' } }));
  writeFileSync(join(dir, 'causes.json'), JSON.stringify({ causes }));
  return { dir, runs };
}

const CAUSES = [
  { signature: 'start-here:drift', rootCause: 'START-HERE.md counted whole-tree files, so any branch adding a test drifted it.', fix: 'PR #606 74bf73d4' },
  { signature: 'ops-register:red-since:*', rootCause: 'The RED-SINCE verdict failed the gate its own remedy needed.', fix: 'PR #593 846d90a0' },
  { signature: 'cancelled:superseded-in-group', rootCause: 'A newer push to the same ref evicted the in-flight run (cancel-in-progress).', fix: 'not a defect; superseded by the newer run' },
  { signature: 'cancelled:by-hand-or-unknown', rootCause: 'Cancelled with no successor in its concurrency group.', fix: 'not a defect; no verdict rendered' },
  { signature: 'dart:format', rootCause: 'A Dart file in the PR was not format-clean; the log names it.', fix: 'superseded: fixed on the branch before merge' },
];

// ═══════════════════════════════════════════════════════════════════════════
describe('log reading', () => {
  test('stripPrefix removes the gh job/step prefix AND the bare API timestamp', () => {
    assert.equal(stripPrefix('ci-gate\tRequire all lanes green\t2026-09-09T10:00:00.1234567Z ##[error]x'), '##[error]x');
    assert.equal(stripPrefix('2026-09-09T10:00:00.1234567Z ✗ y'), '✗ y');
    assert.equal(stripPrefix('no prefix at all'), 'no prefix at all');
  });

  test('scopeToStep keeps only the lines inside the step window (API format)', () => {
    const lines = [line('10:00:40.0000000', '✗ earlier'), line('10:01:05.0000000', 'inside'), line('10:02:00.0000000', 'after')];
    const s = step('x', 'failure', '10:01:00', '10:01:30');
    assert.deepEqual(scopeToStep(lines, s).map(stripPrefix), ['inside']);
  });

  test('scopeToStep prefers the gh step-name prefix when present', () => {
    const lines = ['job\tother step\t2026-09-09T10:01:05Z ✗ no', 'job\tmine\t2026-09-09T10:01:06Z yes'];
    assert.deepEqual(scopeToStep(lines, { name: 'mine' }).map(stripPrefix), ['yes']);
  });

  test('scopeToStep of a step that never started is EMPTY, not the whole log', () => {
    assert.deepEqual(scopeToStep([line('10:00:00.0000000', 'x')], { name: 'never', started_at: null, completed_at: null }), []);
  });

  test('errorBlock: a ✔ line that MENTIONS ✗ is not the error; the ✗-at-start line is', () => {
    const eb = errorBlock(['  ✔ drops every `✗` line', '  ✗ COVERAGE LOST — real', '  detail']);
    assert.equal(eb.line, '✗ COVERAGE LOST — real');
    assert.match(eb.block, /detail/);
  });

  test('errorBlock: the generic exit line carries the three lines before it as context', () => {
    const eb = errorBlock(['a', 'b', 'Changed foo.dart', 'Formatted 3 files', '##[error]Process completed with exit code 1.']);
    assert.equal(eb.line, '##[error]Process completed with exit code 1.');
    assert.match(eb.block, /Changed foo\.dart/);
    assert.doesNotMatch(eb.block, /^a\n/);
  });

  test('errorBlock: a specific ##[error] beats a FAILED word that comes earlier', () => {
    const eb = errorBlock(['assert-x: FAILED', '##[error]API rate limit exceeded for installation']);
    assert.equal(eb.line, '##[error]API rate limit exceeded for installation');
  });

  test('errorBlock over nothing is "(no error line)"', () => {
    assert.equal(errorBlock([]).line, '(no error line)');
  });
});

describe('signatures', () => {
  test('the register header is NOT the signature — the duty on the next line is', () => {
    const block = '✗ tooling/ops/register.json — 2 problem(s):\n\n    duty.workflow.build-platforms.yml — RED SINCE 2026-09-08T00:00:00Z: …';
    assert.equal(signatureOf({ step: 'x', block }), 'ops-register:red-since:duty.workflow.build-platforms.yml');
  });

  test('an unregistered route groups per ROUTE', () => {
    const block = '✗ platform register — 1 problem(s):\n    GET /v1/entitlements/subject — MOUNTED by services/platform/src/routes/entitlements.ts and absent from the register.';
    assert.equal(signatureOf({ step: 'x', block }), 'platform-register:unregistered-route:GET /v1/entitlements/subject');
  });

  test('the shared quota 403 is one group whichever guard tripped on it', () => {
    assert.equal(signatureOf({ step: 'Analyze', block: '##[error]API rate limit exceeded for installation. If you reach out …' }), 'github-api:403-installation-quota');
    assert.equal(signatureOf({ step: 'weekly', block: '##[error]proof-fresh COVERAGE LOST — GitHub API returned 403 for /repos/x' }), 'github-api:403-installation-quota');
  });

  test('the alert-disposition 403 is its OWN group (it was graded as a finding, and that was the defect)', () => {
    const block = '✗ limb A — a declared firing history could not be enumerated: GitHub API returned 403 for /repos/x';
    assert.equal(signatureOf({ step: 'Every alerting firing has a recorded disposition', block }), 'ops-register:alert-disposition-403');
  });

  test('a step name alone can be the signature (START-HERE, OSV)', () => {
    assert.equal(signatureOf({ step: 'START-HERE.md is what the tree generates', block: 'gen-start-here — …' }), 'start-here:drift');
    assert.equal(signatureOf({ step: 'Known-vulnerable dependencies, INCLUDING the Dart ones', block: '| https://osv.dev/GHSA-x |' }), 'osv:known-vulnerable');
  });

  test('`<guard>: FAILED` groups per guard', () => {
    assert.equal(signatureOf({ step: 'x', block: 'assert-app-dod: FAILED' }), 'guard-failed:assert-app-dod');
  });

  test('nothing matched → `other:` carrying the normalised step and first line, so it can never be explained by accident', () => {
    const sig = signatureOf({ step: 'Some new step 42', block: 'boom at 2026-09-09T10:00:00Z in deadbeef12' });
    assert.match(sig, /^other:Some new step <n>:boom at <ts> in <sha>$/);
  });

  test('normalise folds shas, timestamps, durations and counts', () => {
    assert.equal(normalise('run 34330000000 at 2026-09-09T05:50:00Z, 4.1h EARLIER deadbeef1'), 'run <n> at <ts>, <dur> EARLIER <sha>');
  });

  test('every signature id is unique and every pattern is a RegExp', () => {
    const ids = SIGNATURES.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const s of SIGNATURES) assert.ok(s.re instanceof RegExp, s.id);
  });
});

describe('rows', () => {
  test('NON_GREEN is exactly the four conclusions the ledger ranges over', () => {
    assert.deepEqual([...NON_GREEN].sort(), ['cancelled', 'failure', 'startup_failure', 'timed_out']);
  });

  test('the aggregator is dropped when a real lane failed; alone, it is `gate-only`', () => {
    const run = { id: 1, path: CI, head_branch: 'b', head_sha: 'x', conclusion: 'failure', created_at: T('10:00:00'), updated_at: T('10:05:00') };
    const gate = { id: 2, name: 'ci-gate', conclusion: 'failure', steps: [step('Require all lanes green', 'failure', '10:04:00', '10:04:10')] };
    const lane = { id: 3, name: 'lane', conclusion: 'failure', steps: [step('START-HERE.md is what the tree generates', 'failure', '10:01:00', '10:01:30')] };
    assert.ok(GATE_STEP.test('Require all lanes green'));
    const withLane = classifyRun(run, [gate, lane], () => [line('10:01:05.0000000', 'gen-start-here — x')]);
    assert.equal(withLane.signature, 'start-here:drift');
    assert.equal(withLane.job, 'lane');
    const alone = classifyRun(run, [gate], () => [line('10:04:05.0000000', '##[error]One or more CI lanes failed')]);
    assert.equal(alone.signature, 'gate-only');
  });

  test('a cancelled run is `superseded-in-group` only when a newer run of the same workflow+ref began while it ran', () => {
    const a = { id: 1, path: CI, head_branch: 'b', created_at: T('10:00:00'), updated_at: T('10:03:00') };
    const during = { id: 2, path: CI, head_branch: 'b', created_at: T('10:01:00'), updated_at: T('10:08:00') };
    const later = { id: 3, path: CI, head_branch: 'b', created_at: T('10:30:00'), updated_at: T('10:38:00') };
    const otherRef = { id: 4, path: CI, head_branch: 'c', created_at: T('10:01:00'), updated_at: T('10:08:00') };
    assert.equal(newerRunDuring(a, [a, during]), true);
    assert.equal(newerRunDuring(a, [a, later]), false);
    assert.equal(newerRunDuring(a, [a, otherRef]), false);
    const run = { ...a, head_sha: 'x', conclusion: 'cancelled' };
    const job = { id: 9, name: 'lane', conclusion: 'cancelled', steps: [step('Run checkout', 'cancelled', '10:00:10', '10:00:16')] };
    assert.equal(classifyRun(run, [job], () => [], { newerRunExists: true }).signature, 'cancelled:superseded-in-group');
    assert.equal(classifyRun(run, [job], () => [], { newerRunExists: false }).signature, 'cancelled:by-hand-or-unknown');
  });

  test('a run with no failing job at all is `startup:<conclusion>` or a cancellation', () => {
    const run = { id: 1, path: CI, head_branch: 'b', head_sha: 'x', conclusion: 'startup_failure', created_at: T('10:00:00'), updated_at: T('10:00:01') };
    assert.equal(classifyRun(run, [], () => []).signature, 'startup:startup_failure');
    assert.equal(classifyRun({ ...run, conclusion: 'cancelled' }, [], () => []).signature, 'cancelled:by-hand-or-unknown');
  });

  test('several real lanes failing is ONE row, the others listed in alsoFailed', () => {
    const run = { id: 1, path: CI, head_branch: 'b', head_sha: 'x', conclusion: 'failure', created_at: T('10:00:00'), updated_at: T('10:05:00') };
    const j = (id, name, s) => ({ id, name, conclusion: 'failure', steps: [step(s, 'failure', '10:01:00', '10:01:30')] });
    const row = classifyRun(run, [j(1, 'A', 'Build windows'), j(2, 'B', 'Build macos'), j(3, 'C', 'Build linux')], () => []);
    assert.equal(row.job, 'A');
    assert.deepEqual(row.alsoFailed, ['B › Build macos', 'C › Build linux']);
  });
});

describe('causes and proof', () => {
  test('causeFor: exact beats prefix, longest prefix beats shorter', () => {
    const causes = [
      { signature: 'ops-register:*', rootCause: 'wide', fix: 'x' },
      { signature: 'ops-register:red-since:*', rootCause: 'narrow', fix: 'x' },
      { signature: 'ops-register:red-since:duty.workflow.e2e.yml', rootCause: 'exact', fix: 'x' },
    ];
    assert.equal(causeFor('ops-register:red-since:duty.workflow.e2e.yml', causes).rootCause, 'exact');
    assert.equal(causeFor('ops-register:red-since:duty.workflow.ci.yml', causes).rootCause, 'narrow');
    assert.equal(causeFor('ops-register:other', causes).rootCause, 'wide');
    assert.equal(causeFor('other:x', causes), null);
  });

  test('causeFor: a feature-branch-scoped cause never explains a red run ON main, and vice versa', () => {
    const causes = [
      { signature: 'dart:format', rootCause: 'fixed on the branch', fix: 'superseded', scope: 'feature-branches' },
      { signature: 'guard-test:*', rootCause: 'on main', fix: 'sha', scope: 'main' },
    ];
    assert.equal(causeFor('dart:format', causes, 'feat-x').rootCause, 'fixed on the branch');
    assert.equal(causeFor('dart:format', causes, 'main'), null);
    assert.equal(causeFor('guard-test:x', causes, 'main').rootCause, 'on main');
    assert.equal(causeFor('guard-test:x', causes, 'feat-x'), null);
  });

  test('a cancelled run with NO successor inside its window is by-hand, not superseded', () => {
    const { dir, runs } = fixture(temp());
    rmSync(join(dir, 'between-1003.json'));
    // R4 is itself in the non-green list; move it past R3's window so nothing
    // — neither the API answer nor the enumeration — started while R3 lived.
    runs[3].created_at = T('12:05:00');
    writeFileSync(join(dir, 'runs.json'), JSON.stringify(runs));
    const r = run(SCRIPT, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json')]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /cancelled:by-hand-or-unknown \| 1 \| /);
    assert.doesNotMatch(r.out, /cancelled:superseded-in-group/);
  });

  test('proofFor: later green > branch gone (with PR) > OPEN', () => {
    const row = { workflowPath: CI, workflow: 'ci.yml', branch: 'b' };
    const ctx = (newestRun, alive, pr) => ({ newest: new Map([[`${CI}|b`, newestRun]]), branches: new Set(alive ? ['b'] : []), prs: new Map(pr ? [['b', pr]] : []) });
    assert.equal(proofFor(row, ctx({ id: 9, conclusion: 'success', created_at: 't' }, true)).kind, 'later-green');
    const gone = proofFor(row, ctx({ id: 9, conclusion: 'failure', created_at: 't' }, false, { number: 12, merged_at: 't', merge_commit_sha: 'abcdef1234' }));
    assert.equal(gone.kind, 'branch-gone');
    assert.match(gone.text, /PR #12 merged abcdef12/);
    assert.match(proofFor(row, ctx({ id: 9, conclusion: 'failure', created_at: 't' }, false, { number: 13 })).text, /closed unmerged/);
    const open = proofFor(row, ctx({ id: 9, conclusion: 'failure', created_at: 't' }, true));
    assert.equal(open.kind, 'none');
    assert.match(open.text, /^OPEN/);
  });

  test('explained is a CONJUNCTION: a cause without proof is open, proof without a cause is unnamed', () => {
    const cause = { signature: 'x', rootCause: 'r', fix: 'f' };
    assert.equal(isExplained(cause, { kind: 'later-green' }), true);
    assert.equal(isExplained(cause, { kind: 'none' }), false);
    assert.equal(isExplained(null, { kind: 'later-green' }), false);
  });

  test('the REAL causes register parses and every entry names a signature, a root cause and a fix', () => {
    const causes = loadCauses();
    assert.ok(causes.length >= 20, `${CAUSES_REL} holds ${causes.length} cause(s)`);
    for (const c of causes) {
      // An id is the signature table's output verbatim: no surrounding
      // whitespace, a `*` only as the final character, never empty.
      assert.equal(c.signature, c.signature.trim(), c.signature);
      assert.doesNotMatch(c.signature, /\*./, `${c.signature}: a \`*\` is only readable as the last character`);
      assert.ok(c.rootCause.length > 20, c.signature);
      assert.ok(c.fix.length > 5, c.signature);
    }
    // A cause for `other:*` would explain the unexplainable. Refuse it.
    assert.equal(causes.find((c) => c.signature.startsWith('other')), undefined, 'no cause may claim the `other:` fallback');
  });

  test('renderTable marks a group with an unexplained member and a group without a cause', () => {
    const groups = [
      { signature: 's', count: 2, unexplained: 1, cause: { rootCause: 'r', fix: 'f' }, proofs: new Map([['p', 2]]) },
      { signature: 't', count: 1, unexplained: 1, cause: null, proofs: new Map([['q', 1]]) },
    ];
    const t = renderTable(groups);
    assert.match(t, /s \| 2 \(1 UNEXPLAINED\) \| r \| f \| p ×2/);
    assert.match(t, /t \| 1 \(1 UNEXPLAINED\) \| — NO CAUSE IN REGISTER — \| — \| q/);
  });
});

describe('the ledger, end to end (fixture transport, no network)', () => {
  test('GREEN CONTROL — the real signature table explains all four runs: exit 0, UNEXPLAINED: 0, and the arithmetic adds up', () => {
    const { dir } = fixture(temp());
    const r = run(SCRIPT, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json')]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /COVERAGE: 4 non-green run\(s\)/);
    assert.match(r.out, /ARITHMETIC: 4 total = 4 explained across 4 group\(s\) \+ 0 unexplained/);
    assert.match(r.out, /\nUNEXPLAINED: 0\n?$/);
    assert.match(r.out, /start-here:drift \| 1 \| /);
    assert.match(r.out, /ops-register:red-since:duty\.workflow\.ops-watch\.yml \| 1 \| /);
    assert.match(r.out, /cancelled:superseded-in-group \| 1 \| /);
    assert.match(r.out, /dart:format \| 1 \| /);
    assert.match(r.out, /later green: run 1099 @ 2026-09-09T13:00:00Z/);
    assert.match(r.out, /branch deleted; PR #606 merged 74bf73d4/);
  });

  test('MUTATION (in-process) — drop ONE signature from the table and exactly ONE run loses its group', async () => {
    const { dir } = fixture(temp());
    const api = fixtureApi(dir);
    const control = await ledger(api, { causes: CAUSES });
    assert.equal(control.unexplained.length, 0);
    const mutated = await ledger(api, { causes: CAUSES, signatures: SIGNATURES.filter((s) => s.id !== 'start-here:drift') });
    assert.equal(mutated.unexplained.length, 1);
    assert.equal(mutated.unexplained[0].id, 1001);
    assert.match(mutated.unexplained[0].signature, /^other:START-HERE/);
    assert.equal(mutated.unexplained[0].why, 'no cause in register');
  });

  test('MUTATION (CLI, a textual copy of the script) — the same fixture flips to exit 1 and names run 1001; the original is untouched', () => {
    const { dir } = fixture(temp());
    const original = readFileSync(SCRIPT, 'utf8');
    const needle = "{ id: 'start-here:drift', re: /^START-HERE\\.md is what the tree generates/ },";
    assert.ok(original.includes(needle), 'the mutation target must be the line as written, or this proves nothing');
    const mutated = original
      .replace(needle, "{ id: 'start-here:drift', re: /^THIS-LINE-NEVER-MATCHES-ANYTHING/ },")
      .replace("from './safe-rerun.mjs'", `from ${JSON.stringify(pathToFileURL(SAFE_RERUN).href)}`);
    assert.notEqual(mutated, original);
    const copy = join(dir, 'triage-failed-runs.mutated.mjs');
    writeFileSync(copy, mutated);
    const r = run(copy, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json')]);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, /\nUNEXPLAINED: 1\n?$/);
    assert.match(r.out, /run 1001 · ci\.yml · feat-a/);
    assert.match(r.out, /no cause in register/);
    assert.match(r.out, /ARITHMETIC: 4 total = 3 explained across 4 group\(s\) \+ 1 unexplained/);
    assert.equal(readFileSync(SCRIPT, 'utf8'), original, 'the real script must not have been touched');
  });

  test('a LATER GREEN that is missing turns a caused row into OPEN, and the exit is 1', () => {
    const { dir } = fixture(temp());
    writeFileSync(join(dir, 'newest.json'), JSON.stringify({ [`${CI}|feat-b`]: { id: 1004, conclusion: 'failure', created_at: T('12:01:00') } }));
    const r = run(SCRIPT, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json')]);
    assert.equal(r.code, 1, r.out + r.err);
    // feat-b is alive with a red newest: runs 1003 and 1004 are OPEN. main has no newest run recorded: 1002 is OPEN too.
    assert.match(r.out, /\nUNEXPLAINED: 3\n?$/);
    assert.match(r.out, /no later green and branch still alive/);
    assert.match(r.out, /OPEN — newest ci\.yml on feat-b is run 1004 \(failure\)/);
  });

  test('a run list CAPPED by the API is COVERAGE LOST (exit 2) even when every listed run is explained', () => {
    const { dir } = fixture(temp());
    writeFileSync(join(dir, 'capped.json'), JSON.stringify(['failure: 1000 of 1710']));
    const r = run(SCRIPT, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json')]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.out, /COVERAGE LOST — the run list was CAPPED by the API: failure: 1000 of 1710/);
    assert.match(r.out, /\nUNEXPLAINED: 0\n?$/);
    assert.match(r.err, /COVERAGE LOST — the enumeration was capped/);
  });

  test('a jobs page shorter than total_count is COVERAGE LOST (exit 2)', () => {
    const { dir } = fixture(temp());
    const jobs = JSON.parse(readFileSync(join(dir, '1004.jobs.json'), 'utf8'));
    jobs.total_count = 7;
    writeFileSync(join(dir, '1004.jobs.json'), JSON.stringify(jobs));
    const r = run(SCRIPT, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json')]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /reports 7 job\(s\) but one page carried 1/);
  });

  test('an EMPTY causes register is COVERAGE LOST, not a pass', () => {
    const { dir } = fixture(temp());
    writeFileSync(join(dir, 'causes.json'), JSON.stringify({ causes: [] }));
    const r = run(SCRIPT, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json')]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /carries no `causes` array/);
  });

  test('a missing fixture dir, and a fixture with no runs.json, are both COVERAGE LOST', () => {
    const d = temp();
    assert.equal(run(SCRIPT, ['--fixture-dir', join(d, 'nope')]).code, 2);
    const r = run(SCRIPT, ['--fixture-dir', d]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /fixture runs\.json is missing/);
  });

  test('--json writes every row and group', () => {
    const { dir } = fixture(temp());
    const out = join(dir, 'ledger.json');
    const r = run(SCRIPT, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json'), '--json', out]);
    assert.equal(r.code, 0, r.out + r.err);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(j.rows.length, 4);
    assert.equal(j.groups.length, 4);
    assert.deepEqual(j.unexplained, []);
  });
});

describe('CLI contract', () => {
  test('parseArgs refuses an unknown flag and a non-ISO --since', () => {
    assert.match(parseArgs(['--bogus']).error, /unrecognised argument/);
    assert.match(parseArgs(['--since', 'yesterday']).error, /ISO instant/);
    assert.equal(parseArgs(['--since', '2026-09-08T00:00:00Z', '--no-prs']).prs, false);
  });

  test('no credential, no fixture → exit 2 "COVERAGE LOST", and nothing is fetched', () => {
    const r = run(SCRIPT, ['--repo', 'fixture/fixture'], { GH_TOKEN: '', GITHUB_TOKEN: '' });
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /COVERAGE LOST — no GitHub credential/);
  });

  test('the script is not wired into any workflow — it is a reader that spends the shared quota', () => {
    const wf = join(REPO, '.github', 'workflows');
    const { readdirSync } = process.getBuiltinModule('node:fs');
    for (const f of readdirSync(wf)) {
      if (!/\.ya?ml$/.test(f)) continue;
      assert.doesNotMatch(readFileSync(join(wf, f), 'utf8'), /triage-failed-runs/, `${f} must not invoke the triage reader`);
    }
  });
});
