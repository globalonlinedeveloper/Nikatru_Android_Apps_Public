// ─────────────────────────────────────────────────────────────────────────────
// money-dry-run.test.mjs — tooling/ops/money-dry-run.mjs must be able to FAIL.
//
// [5]M-2 · a notification is recorded VERBATIM, EXACTLY ONCE, BEFORE it is
// interpreted, and an OUT-OF-ORDER delivery cannot re-grant a refunded
// subscription.
//
// 🔴 WHY A REPLAY HARNESS NEEDS ITS OWN FAILING CASES MORE THAN MOST. It answers
// one question — "did every delivery order end in the same entitlement?" — and
// the answer is YES for the empty set, for a corpus of one, for a corpus that
// writes nothing, and for a corpus the shipped adapter silently could not read.
// Four different ways of proving nothing, all of which print the same green as
// the real thing. Each of the four is spawned below and must exit 2.
//
// The executable is spawned rather than imported, because "exits non-zero" is
// the property an operator and a CI step both actually depend on, and a module
// that throws inside a try block is not that.
//
// ⚠️ EVERY CASE BELOW POINTS `--corpus` AT A TEMP DIRECTORY AND PASSES THE REAL
// REPOSITORY AS THE ROOT ARGUMENT. The script needs services/platform to exist
// (it imports the real derivation from it); what is being withheld is the
// SUBJECT, not the code under test. Withholding both would prove only that a
// script cannot run in an empty directory.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
// Both spelled out, and the absolute path is bound to a literal ENDING in the
// file name rather than composed from the relative one: `exercisedBy` in
// assert-guard-coverage.mjs credits a test with RUNNING an executable only when
// the identifier it spawns was bound to an expression that ends in that name, so
// `join(ROOT, SCRIPT_REL)` would read as a test that merely mentions it.
const SCRIPT = join(ROOT, 'tooling/ops/money-dry-run.mjs');
const SCRIPT_REL = 'tooling/ops/money-dry-run.mjs';
const TYPES = join(ROOT, 'tooling/ops/money-dry-run.d.mts');
const CORPUS = join(ROOT, 'tooling/ops/fixtures/money-replay');
const WORKFLOW = join(ROOT, '.github/workflows/ci.yml');

/**
 * THE CORPUS, SPELLED OUT — the manifest half of the scan-vs-manifest pattern
 * assert-guards-refuse-empty.mjs uses against `git ls-files`.
 *
 * The script itself never reads this list: it walks the directory, exactly as it
 * must in order to work over an operator's own corpus. What the list is for is
 * the direction a walk cannot see. A fixture that LEAVES the tree takes its case
 * with it and the walk goes on printing ok over a smaller subject — the failure
 * this repository has already paid for twice (check-migrations.mjs silently
 * dropping from 5 files to 4 and reporting PASS). A fixture that arrives is
 * equally a change to what the ordering claim is made over, and it should be a
 * line in a diff rather than a directory that quietly grew.
 *
 * ⚠️ IT IS ALSO WHAT MAKES THESE FILES REACHABLE. tooling/scripts/assert-no-dead-files.mjs
 * resolves a tracked file by finding its name written somewhere else; a corpus
 * only ever opened by `readdirSync` is, to that guard, eight files nothing
 * reaches. Waiving them would have been the cheaper answer and the wrong one —
 * a waiver says "nothing reaches this and that is fine", where what is true is
 * that this test reaches all eight and fails if one goes missing.
 */
const CORPUS_MANIFEST = [
  '01-subscription-created-trialing.json',
  '02-trial-converts-to-active.json',
  '03-price-updated-not-our-subject.json',
  '04-renewal-extends-the-period.json',
  '05-cancelled-at-period-end.json',
  '06-past-due-is-not-a-revocation-yet.json',
  '07-paused-suspends-access-now.json',
  '08-chargeback-warning-moves-no-access.json',
];

/** Spawn the executable. Exit code and both streams, nothing interpreted. */
function run(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ROOT, ...args], { encoding: 'utf8', cwd: ROOT });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** A temp corpus directory holding exactly the fixture documents handed to it. */
function corpusOf(docs) {
  const dir = mkdtempSync(join(tmpdir(), 'money-replay-'));
  docs.forEach((doc, i) => writeFileSync(join(dir, `${i}.json`), JSON.stringify(doc, null, 2)));
  return dir;
}

const fixtureFiles = () => (existsSync(CORPUS) ? readdirSync(CORPUS).filter((f) => f.endsWith('.json')).sort() : []);
const fixtureDoc = (name) => JSON.parse(readFileSync(join(CORPUS, name), 'utf8'));

// ─────────────────────────────────────────────────────────────────────────────
// A provider label NO adapter is registered for — checked against the registry,
// not assumed.
//
// 🔴 IT USED TO BE THE LITERAL 'razorpay', AND ON 2026-09-12 THAT NAME BECAME
// REAL. Registering the Razorpay adapter silently changed what this case is
// about: the foreign row stopped falling down the "nothing is registered for
// this provider" branch and started falling down "the real razorpay adapter
// refused it" instead. The script still exited 2, so the case went on LOOKING
// like it held — `assert.equal(r.code, 2)` passed. Only the message assertion
// noticed, and it noticed as a red CI run on the pull request that registered
// the rail, which is a confusing place to learn it.
//
// The lesson is not "pick a name nobody will ever register". It is that a case
// about the ABSENCE of something has to READ the presence set rather than
// assume it, or the set moves underneath it. So: every `provider: '…'` label
// the MoR modules declare, and a refusal to run if the label handed out below
// is among them. The day a rail takes this name, this test says which line to
// change instead of drifting into a different case.
//
// ⚠️ The scan is deliberately crude — a plain literal match over raw source, so
// a `provider: '…'` written in PROSE counts too. That error runs one way only:
// a mention it should have ignored makes this test FAIL, loudly, naming the
// label. It can never make an absent rail look present-enough to pass.
// ─────────────────────────────────────────────────────────────────────────────
const MOR_DIR = join(ROOT, 'services/platform/src/lib/mor');
const UNREGISTERED_PROVIDER = 'no-such-rail';

function registeredProviderLabels() {
  if (!existsSync(MOR_DIR)) return new Set();
  const labels = new Set();
  for (const f of readdirSync(MOR_DIR).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(join(MOR_DIR, f), 'utf8');
    for (const m of src.matchAll(/provider:\s*'([^']+)'/g)) labels.add(m[1]);
  }
  return labels;
}

describe('the checked-in corpus is a real subject', () => {
  test('the fixture directory exists and holds at least two payloads', () => {
    const files = fixtureFiles();
    assert.ok(files.length >= 2, `${CORPUS} holds ${files.length} fixture(s); two is the floor for an ordering claim`);
  });

  test('the corpus on disk is EXACTLY the corpus this file names — no fixture arrived or left unnoticed', () => {
    assert.deepEqual(fixtureFiles(), CORPUS_MANIFEST);
  });

  test('every fixture is a JSON object naming a provider and carrying a payload', () => {
    for (const f of fixtureFiles()) {
      const doc = fixtureDoc(f);
      assert.equal(typeof doc.provider, 'string', `${f}: no 'provider'`);
      assert.ok(doc.payload !== undefined && doc.payload !== null, `${f}: no 'payload'`);
    }
  });

  test('no fixture carries a real-looking credential or a live provider secret prefix', () => {
    // The corpus is committed. A payload copied out of a live export would put a
    // customer's name and email address into a public repository, and a secret
    // prefix would put a rail in somebody else's hands.
    for (const f of fixtureFiles()) {
      const text = readFileSync(join(CORPUS, f), 'utf8');
      for (const forbidden of ['pdl_ntfset_', 'pdl_live_apikey_', 'pdl_sdbx_apikey_']) {
        assert.ok(!text.includes(forbidden), `${f} contains '${forbidden}'`);
      }
      const emails = text.match(/[\w.+-]+@[\w.-]+/g) ?? [];
      for (const e of emails) {
        assert.ok(e.endsWith('.invalid'), `${f} carries the address ${e}, which is not an RFC 2606 .invalid address`);
      }
    }
  });
});

describe('money-dry-run.mjs refuses every way of proving nothing', () => {
  test('a corpus directory that does not exist is COVERAGE LOST, not a clean run', () => {
    const r = run(`--corpus=${join(tmpdir(), 'money-replay-absent-on-purpose')}`);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('an EMPTY corpus directory is COVERAGE LOST', () => {
    const dir = corpusOf([]);
    try {
      const r = run(`--corpus=${dir}`);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /ZERO notification payloads/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a corpus of ONE event is COVERAGE LOST — a single event has no order', () => {
    const dir = corpusOf([fixtureDoc(fixtureFiles()[0])]);
    try {
      const r = run(`--corpus=${dir}`);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /Order-independence over a single event/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a corpus that moves NO entitlement is COVERAGE LOST, however many events it holds', () => {
    // Two events the rail stores and deliberately does not act on. Every order
    // agrees about an empty table, which is true and worthless.
    const inert = (id) => ({
      provider: 'paddle',
      payload: {
        event_id: `evt_inert${id}`,
        notification_id: `ntf_inert${id}`,
        event_type: 'price.updated',
        occurred_at: `2026-08-0${id}T00:00:00.000Z`,
        data: { id: `pri_inert${id}`, status: 'active' },
      },
    });
    const dir = corpusOf([inert(1), inert(2)]);
    try {
      const r = run(`--corpus=${dir}`);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /entitlement row\(s\) and 0 'applied' outcome\(s\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a payload the SHIPPED adapter cannot read is COVERAGE LOST, never a fixture that quietly leaves', () => {
    const good = fixtureDoc(fixtureFiles()[0]);
    const broken = JSON.parse(JSON.stringify(good));
    broken.payload.data.status = 'a_status_paddle_never_documented';
    const dir = corpusOf([good, broken]);
    try {
      const r = run(`--corpus=${dir}`);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /never reached the derivation/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a provider with no registered adapter is COVERAGE LOST, not an ignored row', () => {
    const registered = registeredProviderLabels();
    assert.ok(
      registered.size > 0,
      `${MOR_DIR} declares no provider labels at all — this case cannot tell a genuine absence from a directory it failed to read`,
    );
    assert.ok(
      !registered.has(UNREGISTERED_PROVIDER),
      `'${UNREGISTERED_PROVIDER}' is now a REGISTERED rail, so this case has quietly become a different one. Give it a label no adapter declares.`,
    );
    const doc = fixtureDoc(fixtureFiles()[0]);
    const foreign = { ...JSON.parse(JSON.stringify(doc)), provider: UNREGISTERED_PROVIDER };
    const dir = corpusOf([doc, foreign]);
    try {
      const r = run(`--corpus=${dir}`);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /no adapter is registered for provider/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('money-dry-run.mjs passes on the real corpus, and says what it proved', () => {
  test('the checked-in corpus replays green through the real derivation', () => {
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /delivery orders/);
    assert.match(r.out, /red control/);
  });

  test('the --json report names every order, and the red control DID go red', () => {
    const r = run('--json');
    assert.equal(r.code, 0, r.out);
    const report = JSON.parse(r.out);
    assert.equal(report.identical, true);
    assert.deepEqual(report.mismatches, []);
    // 🔴 THE ASSERTION THAT MAKES THE OTHERS MEAN ANYTHING. The script replays a
    // pair of events bearing the SAME provider clock, which the strict
    // `excluded.occurred_at > entitlements.occurred_at` comparison cannot
    // separate, and requires them to diverge. A run in which they did not is a
    // run whose comparison has stopped comparing.
    assert.equal(report.redControlWentRed, true);
    assert.ok(report.orders.length >= 4, `only ${report.orders.length} order(s) were replayed`);
    const names = report.orders.map((o) => o.name);
    for (const required of ['in-order', 'reversed', 'each-event-duplicated', 'interleaved-across-rails']) {
      assert.ok(names.includes(required), `the '${required}' delivery order was not replayed`);
    }
    assert.ok(report.fixtures >= 2, `${report.fixtures} fixture(s) replayed`);
    assert.ok(report.finalState.length > 0, 'the replay ended with no entitlement row at all');
  });

  test('a live provider_notifications export replays through --from, byte for byte', () => {
    // The `--from` path is the reason the verbatim store exists: `payload` is a
    // TEXT column, so an exported row carries the exact bytes the rail sent and
    // they are re-fed unchanged. Simulated here with an export shaped like
    // wrangler's `d1 execute --json`, built from the committed fixtures.
    const rows = fixtureFiles().map((f) => {
      const doc = fixtureDoc(f);
      return {
        provider: doc.provider,
        provider_event_id: doc.payload.event_id,
        payload: JSON.stringify(doc.payload),
      };
    });
    const dir = mkdtempSync(join(tmpdir(), 'money-replay-export-'));
    const file = join(dir, 'export.json');
    writeFileSync(file, JSON.stringify([{ results: rows }], null, 2));
    try {
      const r = run(`--from=${file}`, '--json');
      assert.equal(r.code, 0, r.out);
      assert.equal(JSON.parse(r.out).identical, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the harness is wired where it will actually run', () => {
  test('ci.yml runs tooling/ops/money-dry-run.mjs from a named step', () => {
    const yml = readFileSync(WORKFLOW, 'utf8');
    assert.ok(yml.includes(`node ${SCRIPT_REL}`), `${WORKFLOW} never invokes ${SCRIPT_REL}`);
    const lines = yml.split('\n');
    const i = lines.findIndex((l) => l.includes(`node ${SCRIPT_REL}`));
    assert.ok(i > 0, 'the invocation is the first line of the workflow, which cannot be right');
    assert.match(lines[i - 1], /^\s*- name: \S/, 'the step that runs it carries no `name:` stating the property');
  });

  test('the hand-written declaration beside it names every runtime export', () => {
    // The executable is plain ESM so it can run under bare `node` in a job with
    // no `npm ci`; services/platform/test/money-replay.test.ts imports it as
    // TypeScript. The `.d.mts` is what keeps that import type-checked instead of
    // cast away — the same arrangement contracts/entitlement/ already uses — and
    // it is hand-written, so it rots the moment an export is added and forgotten.
    const runtime = readFileSync(SCRIPT, 'utf8');
    const declared = readFileSync(TYPES, 'utf8');
    const exported = [...runtime.matchAll(/^export\s+(?:async\s+)?(?:const|function|class|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    assert.ok(exported.length > 5, `only ${exported.length} runtime export(s) were found; the matcher has stopped matching`);
    for (const name of exported) {
      assert.match(
        declared,
        new RegExp(`^export\\s+(?:declare\\s+)?(?:const|function)\\s+${name}\\b`, 'm'),
        `money-dry-run.d.mts does not declare '${name}'`,
      );
    }
  });

  test('the executable is on disk and refuses on an empty subject IN CODE', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    const code = source
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//'))
      .join('\n');
    assert.ok(code.includes('COVERAGE LOST'), 'the refusal marker exists only in a comment');
    assert.ok(code.includes('process.exit'), 'nothing in executable code exits');
  });
});
