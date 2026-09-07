// ─────────────────────────────────────────────────────────────────────────────
// extension-submission.test.mjs — the three extension store lanes, and the guard
// that keeps their steps behind the dry-run condition.
//
// TWO SUBJECTS, ONE FILE, because they are two halves of one claim:
//   · extensions/scripts/publish-arming.mjs — the register-driven verdict every
//     extension lane asks before it does anything. Its three answers (`go`,
//     `refuse`, `pending`) are the whole of the fail-closed rule, so each is
//     exercised against a fixture register rather than against the live one,
//     which today would only ever produce `pending`.
//   · tooling/ci/assert-publish-steps-guarded.mjs — the check that every
//     publishing surface in a release job carries `inputs.dry_run != true`.
//
// 🔴 EVERY MUTATION HERE HAS A GREEN CONTROL FIRST. A red that is red for the
// wrong reason is the failure mode these cases exist to avoid: `shell-16`
// records a guard copied out of tooling/ci dying on LOAD with exit 1, which
// reads exactly like the mutation being caught.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-publish-steps-guarded.mjs');
const ARMING = join(REPO, 'extensions', 'scripts', 'publish-arming.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-extsubmit-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
const write = (root, rel, body) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
  return p;
};

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — the arming verdict
// ─────────────────────────────────────────────────────────────────────────────

/** A fixture register carrying one extension row, with the two fields the arming
 *  rule reads. Deliberately minimal: `armingOf` takes rows, not files, and a
 *  fixture that mirrored the whole register would drift from it. */
function registerRoot({ served = false, submittable = false, lane = { workflow: '.github/workflows/extensions.yml', job: 'release' } } = {}) {
  const root = join(TMP, `reg${seq++}`);
  write(
    root,
    'tooling/channel-register.json',
    JSON.stringify({ channels: [{ id: 'amo', kind: 'store', surface: 'extension', served, submittable, lane }] }, null, 2),
  );
  return root;
}

async function verdict(root, env) {
  const mod = await import(`file:///${ARMING.split('\\').join('/')}`);
  return mod.publishVerdict({
    channelId: 'amo',
    secrets: [
      { name: 'FIXTURE_KEY', why: 'a fixture credential' },
      { name: 'FIXTURE_SECRET', why: 'a fixture credential' },
    ],
    ownerStep: 'the exact owner step',
    env,
    root,
  });
}

describe('publish-arming — the register decides, and the fail-closed case is the armed one', () => {
  test('GREEN CONTROL: armed row + every credential present → go', async () => {
    const r = await verdict(registerRoot({ submittable: true }), { FIXTURE_KEY: 'k', FIXTURE_SECRET: 's' });
    assert.equal(r.verdict, 'go');
    assert.match(r.lines.join('\n'), /ARMED and CREDENTIALLED/);
  });

  test('armed row + an EMPTY credential → refuse, naming the empty one and the owner step', async () => {
    const r = await verdict(registerRoot({ submittable: true }), { FIXTURE_KEY: 'k', FIXTURE_SECRET: '' });
    assert.equal(r.verdict, 'refuse');
    assert.deepEqual(r.missing, ['FIXTURE_SECRET']);
    const out = r.lines.join('\n');
    assert.match(out, /REFUSED/);
    assert.match(out, /FIXTURE_SECRET/);
    assert.match(out, /OWNER STEP: the exact owner step/);
  });

  test('a whitespace-only credential is EMPTY — a space is not a secret', async () => {
    const r = await verdict(registerRoot({ submittable: true }), { FIXTURE_KEY: '   ', FIXTURE_SECRET: 's' });
    assert.equal(r.verdict, 'refuse');
    assert.deepEqual(r.missing, ['FIXTURE_KEY']);
  });

  test('UNARMED row + an empty credential → pending, printing the owner step, NOT a failure', async () => {
    const r = await verdict(registerRoot({ submittable: false }), { FIXTURE_KEY: '', FIXTURE_SECRET: '' });
    assert.equal(r.verdict, 'pending');
    const out = r.lines.join('\n');
    assert.match(out, /PENDING MANUAL PUBLISH/);
    assert.match(out, /TRIPWIRE, NOT A WAIVER/);
    assert.match(out, /OWNER STEP: the exact owner step/);
  });

  test('`served: true` arms a row even with `submittable: false` — the two limbs are separate', async () => {
    const r = await verdict(registerRoot({ served: true, submittable: false }), { FIXTURE_KEY: '', FIXTURE_SECRET: '' });
    assert.equal(r.verdict, 'refuse');
  });

  test('`submittable: true` with NO lane is NOT armed — a row that emits nothing cannot ship', async () => {
    const r = await verdict(registerRoot({ submittable: true, lane: null }), { FIXTURE_KEY: '', FIXTURE_SECRET: '' });
    assert.equal(r.verdict, 'pending');
  });

  test('credentials present on an UNARMED row is pending, and says a secret is not an authorisation', async () => {
    const r = await verdict(registerRoot({ submittable: false }), { FIXTURE_KEY: 'k', FIXTURE_SECRET: 's' });
    assert.equal(r.verdict, 'pending');
    assert.match(r.lines.join('\n'), /A SECRET IS NOT AN AUTHORISATION/);
  });

  test('COVERAGE LOST when the register has no such row — an absent row is not an unarmed row', async () => {
    const root = join(TMP, `reg${seq++}`);
    write(root, 'tooling/channel-register.json', JSON.stringify({ channels: [] }));
    await assert.rejects(async () => verdict(root, {}), /COVERAGE LOST/);
  });

  test('COVERAGE LOST when no credential names are declared — an empty list is present by vacuity', async () => {
    const mod = await import(`file:///${ARMING.split('\\').join('/')}`);
    assert.throws(
      () => mod.publishVerdict({ channelId: 'amo', secrets: [], ownerStep: 'x', env: {}, root: registerRoot() }),
      /COVERAGE LOST/,
    );
  });

  test('the three live extension rows are declared in the lane table with a named owner step', async () => {
    const mod = await import(`file:///${ARMING.split('\\').join('/')}`);
    assert.deepEqual(Object.keys(mod.LANES).sort(), ['amo', 'chrome-webstore', 'edge-addons']);
    for (const [id, lane] of Object.entries(mod.LANES)) {
      assert.ok(lane.secrets.length > 0, `${id} declares no credential`);
      assert.ok(lane.ownerStep.length > 40, `${id} has no usable owner step`);
      for (const s of lane.secrets) assert.match(s.name, /^[A-Z][A-Z0-9_]+$/, `${id}: ${s.name}`);
    }
  });

  test('every lane credential is declared in the channel register — an unclassified secret cannot enter a lane', async () => {
    const mod = await import(`file:///${ARMING.split('\\').join('/')}`);
    const register = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
    const declared = new Set((register.ciSecretRegister?.nonSigning ?? []).map((e) => e.name));
    for (const lane of Object.values(mod.LANES)) {
      for (const s of lane.secrets) {
        assert.ok(declared.has(s.name), `${s.name} is used by a publish lane and is not in ciSecretRegister.nonSigning`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — assert-publish-steps-guarded
// ─────────────────────────────────────────────────────────────────────────────

const runGuard = (args) => {
  const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

/** A fixture workflow root. `steps` is a list of {name, if, uses, run}. */
function workflowRoot(steps, { job = 'release' } = {}) {
  const root = join(TMP, `wf${seq++}`);
  const body = [
    'name: Fixture',
    'on: { push: { tags: ["*"] } }',
    'jobs:',
    `  ${job}:`,
    '    runs-on: ubuntu-24.04',
    '    timeout-minutes: 10',
    '    steps:',
  ];
  for (const s of steps) {
    body.push(`      - name: ${s.name}`);
    if (s.if !== undefined) body.push(`        if: ${s.if}`);
    if (s.uses !== undefined) body.push(`        uses: ${s.uses}`);
    if (s.run !== undefined) body.push(`        run: ${s.run}`);
  }
  write(root, '.github/workflows/fixture.yml', `${body.join('\n')}\n`);
  return root;
}

/** Twelve ordinary steps plus whatever the case adds — enough to clear MIN_STEPS
 *  so that a case about GUARDING is not silently answered by the floor. */
const filler = (n = 12) => Array.from({ length: n }, (_, i) => ({ name: `filler ${i}`, run: `echo ${i}` }));
const EXEMPT = [
  { name: 'checkout', uses: 'actions/checkout@aaaaaaa' },
  { name: 'node', uses: 'actions/setup-node@bbbbbbb' },
];

describe('assert-publish-steps-guarded — the region is the job, and zero is not a pass', () => {
  test('GREEN CONTROL: the real extensions.yml release job passes and prints its tally', () => {
    const { code, out } = runGuard([]);
    assert.equal(code, 0, out);
    assert.match(out, /step boundaries read; \d+ publishing-surface step\(s\), all \d+ behind an if:/);
  });

  test('GREEN CONTROL: the real job grades at least four publishing surfaces (release, AMO, CWS, Edge)', () => {
    const { out } = runGuard([]);
    const m = out.match(/(\d+) publishing-surface step\(s\)/);
    assert.ok(m !== null, out);
    assert.ok(Number(m[1]) >= 4, `expected at least 4 publishing surfaces, read ${m[1]}\n${out}`);
  });

  test('GREEN CONTROL on a fixture: a guarded publish passes', () => {
    const root = workflowRoot([
      ...EXEMPT,
      ...filler(),
      { name: 'publish', if: "github.event_name == 'push' && inputs.dry_run != true", run: 'gh release create x' },
    ]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release']);
    assert.equal(code, 0, out);
  });

  test('an UNGUARDED publishing step FAILS', () => {
    const root = workflowRoot([...EXEMPT, ...filler(), { name: 'publish', run: 'gh release create x' }]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release']);
    assert.equal(code, 1, out);
    assert.match(out, /UNGUARDED {2}publishing surface/);
  });

  test('an `if:` carrying a `||` is refused even when it CONTAINS the guard', () => {
    const root = workflowRoot([
      ...EXEMPT,
      ...filler(),
      { name: 'publish', if: 'inputs.dry_run != true || true', run: 'gh release create x' },
    ]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release']);
    assert.equal(code, 1, out);
    assert.match(out, /carries a \|\|/);
  });

  test('an unguarded THIRD-PARTY action is a surface too', () => {
    const root = workflowRoot([...EXEMPT, ...filler(), { name: 'evil', uses: 'someone/else@ccccccc' }, { name: 'publish', if: 'inputs.dry_run != true', run: 'gh release create x' }]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release']);
    assert.equal(code, 1, out);
    assert.match(out, /third-party action {2}someone\/else/);
  });

  test('each of the three new store scripts is recognised as a publishing surface', () => {
    for (const script of ['publish-amo.mjs', 'publish-cws.mjs', 'publish-edge.mjs']) {
      const root = workflowRoot([...EXEMPT, ...filler(), { name: `submit via ${script}`, run: `node scripts/${script} --tool fullshot` }]);
      const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release']);
      assert.equal(code, 1, `${script} was not graded as a publishing surface\n${out}`);
      assert.match(out, /UNGUARDED {2}publishing surface/);
    }
  });

  test('the arming PREFLIGHT is deliberately NOT a publishing surface — a rehearsal must be able to run it', () => {
    const root = workflowRoot([...EXEMPT, ...filler(), { name: 'preflight', run: 'node scripts/publish-arming.mjs --channel amo' }, { name: 'publish', if: 'inputs.dry_run != true', run: 'gh release create x' }]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release']);
    assert.equal(code, 0, out);
    assert.match(out, /1 publishing-surface step\(s\)/);
  });

  test('ZERO publishing surfaces is NOT a pass', () => {
    const root = workflowRoot([...EXEMPT, ...filler()]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release']);
    assert.equal(code, 1, out);
    assert.match(out, /NO publishing surface graded at all/);
    assert.match(out, /ZERO IS NOT A PASS/);
  });

  test('a COLLAPSED region is COVERAGE LOST, not a clean sweep', () => {
    const root = workflowRoot([{ name: 'only one', if: 'inputs.dry_run != true', run: 'gh release create x' }]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release']);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /step boundaries and the floor is/);
  });

  test('a job that is not there is COVERAGE LOST — the job IS the region', () => {
    const root = workflowRoot([...EXEMPT, ...filler(), { name: 'publish', if: 'inputs.dry_run != true', run: 'gh release create x' }]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'nosuchjob']);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /declares no job "nosuchjob"/);
  });

  test('a workflow that is not there is COVERAGE LOST', () => {
    const { code, out } = runGuard(['--repo-root', TMP, '--workflow', '.github/workflows/absent.yml', '--job', 'release']);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
  });

  test('an EXEMPTION no step uses is a failure — it would pre-authorise whatever takes that name next', () => {
    const root = workflowRoot([
      { name: 'checkout', uses: 'actions/checkout@aaaaaaa' },
      ...filler(),
      { name: 'publish', if: 'inputs.dry_run != true', run: 'gh release create x' },
    ]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release']);
    assert.equal(code, 1, out);
    assert.match(out, /actions\/setup-node.*exemption list/s);
  });

  test('the old COMMENT-SENTINEL region is gone from extensions.yml — the defect this guard replaced', () => {
    const yml = readFileSync(join(REPO, '.github', 'workflows', 'extensions.yml'), 'utf8');
    assert.ok(!yml.includes('>>> RELEASE LANE >>>'), 'a comment sentinel is back; the region must be the job');
    assert.match(yml, /assert-publish-steps-guarded\.mjs/);
  });
});
