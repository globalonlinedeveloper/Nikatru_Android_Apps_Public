// ─────────────────────────────────────────────────────────────────────────────
// app-naming.test.mjs — the recorded failing cases for assert-app-naming.mjs.
//
// [pipeline F-10] "Every guard carries a recorded failing case and a self-check
// that its own scan still reaches everything it claims to cover."
//
// ── THE FOUR REDS WERE PROVED ON THE REAL TREE FIRST ─────────────────────────
// Before any of this existed, each rule was mutated into `apps/subscriptiontracker/app.yaml`
// itself and the guard was run — green control, then four reds, then the file
// restored and re-hashed with sha256 to prove the restore was byte-exact. That
// is the evidence; these cases are what keeps it true, and they are written so
// that each differs from the passing fixture in exactly ONE dimension.
//
// ⚠️ THE FIXTURE COPIES THE REAL SCHEMA rather than writing one. The `name` cap
// is READ from `tooling/app-yaml/schema/app.schema.json` by the guard, so a
// hand-written fixture schema would let the two numbers disagree in exactly the
// place the guard exists to stop them disagreeing — and every cap case here
// would then be measuring the fixture.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { bannedIn, gradeNames, isGeneric, sharesToken } from '../assert-app-naming.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CI_DIR = resolve(HERE, '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-app-naming.mjs');
const SCHEMA_REL = 'tooling/app-yaml/schema/app.schema.json';

/* Never through a pipe, and never `$?` beside a command substitution: this
   corpus has had a failing command read as exit 0 three times that way. */
const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status === null ? 2 : r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

const DECL = ({ id = 'demo', name = 'Nikatru Subscription Tracker', shortName = 'Subscriptions' } = {}) =>
  [
    `id: ${id}`,
    `name: ${name}`,
    ...(shortName === null ? [] : [`shortName: ${shortName}`]),
    'tagline: Track every subscription in one place',
    'category: Productivity',
    'status: live',
    'hosts:',
    `  web: ${id}.nikatru.com`,
    'platforms:',
    '  - web',
    'listings:',
    'legal:',
    '  privacyPolicyUrl: https://nikatru.com/privacy',
    '  supportUrl: https://nikatru.com/contact',
    '',
  ].join('\n');

/** A root holding nothing but the real schema and the declarations named. */
function tree(apps) {
  const root = mkdtempSync(join(tmpdir(), 'app-naming-'));
  mkdirSync(join(root, dirname(SCHEMA_REL)), { recursive: true });
  cpSync(join(REPO, SCHEMA_REL), join(root, SCHEMA_REL));
  for (const app of apps) {
    const dir = join(root, 'apps', app.id ?? 'demo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'app.yaml'), DECL(app));
  }
  return root;
}
const kill = (root) => rmSync(root, { recursive: true, force: true });

describe('assert-app-naming — the real tree', () => {
  test('POSITIVE CONTROL: this repository grades clean', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, `the shipped names must pass, or every red below is about a tree nobody ships:\n${out}`);
    assert.match(out, /app\(s\) graded on five limbs/);
  });

  test('the real declaration really does declare both names — the control is not vacuous', () => {
    const { graded } = gradeNames(REPO);
    assert.ok(graded.length > 0, 'nothing was graded, so the positive control above is a pass over an empty set');
    for (const g of graded) {
      assert.ok(g.name, `${g.rel} declares no name`);
      assert.ok(g.shortName, `${g.rel} declares no shortName`);
      assert.notEqual(g.name, g.shortName, `${g.rel} uses one string for both, so no case here can tell them apart`);
    }
  });
});

describe('assert-app-naming — one mutation each', () => {
  test('GREEN CONTROL: the fixture as written passes', () => {
    const root = tree([{}]);
    try {
      const { code, out } = run(root);
      assert.equal(code, 0, out);
    } finally { kill(root); }
  });

  test('RED 1 — a name made entirely of category words', () => {
    const root = tree([{ name: 'Subscription Tracker', shortName: 'Subscriptions' }]);
    try {
      const { code, out } = run(root);
      assert.equal(code, 1, out);
      assert.match(out, /made entirely of category words/);
    } finally { kill(root); }
  });

  test('RED 2 — no shortName at all', () => {
    const root = tree([{ shortName: null }]);
    try {
      const { code, out } = run(root);
      assert.equal(code, 1, out);
      assert.match(out, /declares no `shortName`/);
    } finally { kill(root); }
  });

  test('RED 3 — a shortName that shares no word with the name', () => {
    const root = tree([{ shortName: 'Ledger' }]);
    try {
      const { code, out } = run(root);
      assert.equal(code, 1, out);
      assert.match(out, /shares no word with/);
      assert.match(out, /QA1892/);
    } finally { kill(root); }
  });

  test('RED 4 — two apps with the same shortName', () => {
    const root = tree([
      { id: 'one', name: 'Nikatru Subscription Tracker', shortName: 'Subscriptions' },
      { id: 'two', name: 'Nikatru Subscription Vault', shortName: 'Subscriptions' },
    ]);
    try {
      const { code, out } = run(root);
      assert.equal(code, 1, out);
      assert.match(out, /apps declare the same `shortName`/);
      assert.match(out, /apps\/one\/app\.yaml/);
      assert.match(out, /apps\/two\/app\.yaml/);
    } finally { kill(root); }
  });

  test('RED 4b — uniqueness is compared LOWERCASED, so a capital is not a second app', () => {
    const root = tree([
      { id: 'one', shortName: 'Subscriptions' },
      { id: 'two', shortName: 'SUBSCRIPTIONS' },
    ]);
    try {
      const { code, out } = run(root);
      assert.equal(code, 1, `a home screen does not distinguish these two either:\n${out}`);
      assert.match(out, /apps declare the same `shortName`/);
    } finally { kill(root); }
  });

  test('RED 5 — a shortName over the 15-character home-screen cap', () => {
    const root = tree([{ shortName: 'Subscriptions Pro Plus' }]);
    try {
      const { code, out } = run(root);
      assert.equal(code, 1, out);
      assert.match(out, /cap is 15/);
    } finally { kill(root); }
  });

  test('RED 6 — a ranking claim in the store title', () => {
    const root = tree([{ name: 'Nikatru Subscription Tracker Best' }]);
    try {
      const { code, out } = run(root);
      assert.equal(code, 1, out);
      assert.match(out, /contains "best"/);
    } finally { kill(root); }
  });

  test('RED 7 — an emoji in the icon label', () => {
    const root = tree([{ shortName: 'Subs 🔥' }]);
    try {
      const { code, out } = run(root);
      assert.equal(code, 1, out);
      assert.match(out, /an emoji/);
    } finally { kill(root); }
  });

  test('RED 8 — a name over the cap the SCHEMA declares, not one typed in the guard', () => {
    const root = tree([{ name: 'Nikatru Subscription Tracker Deluxe Edition' }]);
    try {
      const { code, out } = run(root);
      assert.equal(code, 1, out);
      assert.match(out, /the cap is 30, read from/);
    } finally { kill(root); }
  });
});

describe('assert-app-naming — it refuses rather than passing over nothing', () => {
  test('no apps/ directory is COVERAGE LOST, not ok', () => {
    const root = tree([]);
    try {
      const { code, out } = run(root);
      assert.equal(code, 2, out);
      assert.match(out, /COVERAGE LOST/);
    } finally { kill(root); }
  });

  test('an apps/ directory with no declaration in it is COVERAGE LOST', () => {
    const root = tree([]);
    try {
      mkdirSync(join(root, 'apps', 'empty'), { recursive: true });
      const { code, out } = run(root);
      assert.equal(code, 2, out);
      assert.match(out, /satisfies every limb without checking one name|quantifies over the declarations/);
    } finally { kill(root); }
  });

  test('the cap VANISHING from the schema is COVERAGE LOST, not "no cap to check"', () => {
    const root = tree([{}]);
    try {
      const schema = JSON.parse(readFileSync(join(root, SCHEMA_REL), 'utf8'));
      delete schema.properties.name.maxLength;
      writeFileSync(join(root, SCHEMA_REL), `${JSON.stringify(schema, null, 2)}\n`);
      const { code, out } = run(root);
      assert.equal(code, 2, out);
      assert.match(out, /no longer caps `name`/);
    } finally { kill(root); }
  });
});

describe('assert-app-naming — the clearance limb', () => {
  test('with no clearance engine in the tree the limb is PRINTED, not silently skipped', () => {
    const root = tree([{}]);
    try {
      const { code, out } = run(root);
      assert.equal(code, 0, out);
      assert.match(out, /clearance limb is NOT ARMED/);
    } finally { kill(root); }
  });

  test('the engine present and NO record for an app is a finding', () => {
    const root = tree([{}]);
    try {
      mkdirSync(join(root, 'tooling', 'store'), { recursive: true });
      writeFileSync(join(root, 'tooling', 'store', 'name-clearance.mjs'), '// stand-in for the mechanism\n');
      const { code, out } = run(root);
      assert.equal(code, 1, out);
      assert.match(out, /name-clearance\.json does not exist/);
    } finally { kill(root); }
  });

  test('a record whose verdict is BLOCKED is a finding', () => {
    const root = tree([{}]);
    try {
      mkdirSync(join(root, 'tooling', 'store'), { recursive: true });
      writeFileSync(join(root, 'tooling', 'store', 'name-clearance.mjs'), '// stand-in\n');
      writeFileSync(
        join(root, 'apps', 'demo', 'name-clearance.json'),
        `${JSON.stringify({ overall: 'BLOCKED', asOf: '2026-09-09', name: { value: 'Nikatru Subscription Tracker' } }, null, 2)}\n`,
      );
      const { code, out } = run(root);
      assert.equal(code, 1, out);
      assert.match(out, /overall BLOCKED/);
    } finally { kill(root); }
  });

  test('a record clearing a DIFFERENT string is not a clearance for this one', () => {
    const root = tree([{}]);
    try {
      mkdirSync(join(root, 'tooling', 'store'), { recursive: true });
      writeFileSync(join(root, 'tooling', 'store', 'name-clearance.mjs'), '// stand-in\n');
      writeFileSync(
        join(root, 'apps', 'demo', 'name-clearance.json'),
        `${JSON.stringify({ overall: 'CLEAR', asOf: '2026-09-09', name: { value: 'Subly' } }, null, 2)}\n`,
      );
      const { code, out } = run(root);
      assert.equal(code, 1, out);
      assert.match(out, /clears "Subly" and/);
    } finally { kill(root); }
  });

  test('a CLEAR record for this name passes and prints its date', () => {
    const root = tree([{}]);
    try {
      mkdirSync(join(root, 'tooling', 'store'), { recursive: true });
      writeFileSync(join(root, 'tooling', 'store', 'name-clearance.mjs'), '// stand-in\n');
      writeFileSync(
        join(root, 'apps', 'demo', 'name-clearance.json'),
        `${JSON.stringify({ overall: 'CLEAR', asOf: '2026-09-09', name: { value: 'Nikatru Subscription Tracker' } }, null, 2)}\n`,
      );
      const { code, out } = run(root);
      assert.equal(code, 0, out);
      assert.match(out, /clearance CLEAR, asOf 2026-09-09/);
    } finally { kill(root); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SHARED-TOKEN RULE EXISTS TWICE, IN TWO LANGUAGES, ON PURPOSE — the Dart
// one refuses a stamp spec before anything is written, this one is the gate. Two
// implementations are only safe while something compares them, so the rule's own
// boundary cases are asserted here AND the Dart source is checked for the one
// constant that decides them. A stem rule that quietly became exact equality in
// one of the two would let the stamp produce an app the gate refuses.
// ─────────────────────────────────────────────────────────────────────────────
describe('the shared-token rule', () => {
  test('a plural counts as the same word', () => {
    assert.equal(sharesToken('Subscriptions', 'Nikatru Subscription Tracker'), true);
  });
  test('an intra-word hyphen is part of the word', () => {
    assert.equal(sharesToken('E-Book Smoke', "Probe's E-Book & Co — 24/7 Smoke"), true);
  });
  test('a three-character stem is NOT enough — "Sub" would marry Subway to Submarine', () => {
    assert.equal(sharesToken('Sub Vault', 'Submarine Atlas'), false);
  });
  test('four characters is', () => {
    assert.equal(sharesToken('Subs Vault', 'Subscription Atlas'), true);
  });
  test('an unrelated word shares nothing', () => {
    assert.equal(sharesToken('Ledger', 'Nikatru Subscription Tracker'), false);
  });

  test('the Dart implementation still carries the same four-character stem rule', () => {
    const dart = readFileSync(join(REPO, 'tooling', 'bricks', 'app', 'hooks', 'pre_gen.dart'), 'utf8');
    assert.match(dart, /bool _sharesToken\(/, 'pre_gen.dart no longer implements the rule at all');
    assert.match(
      dart,
      /shorter\.length >= 4 && longer\.startsWith\(shorter\)/,
      'the Dart rule and the JS rule have diverged; a stamp could now produce an app this guard refuses',
    );
  });
});

describe('the generic and banned vocabularies', () => {
  test('one distinctive word is enough to stop a name being generic', () => {
    assert.equal(isGeneric('Subscription Tracker'), true);
    assert.equal(isGeneric('Nikatru Subscription Tracker'), false);
  });
  test('an empty name is not "generic" — that is the missing-name finding, not this one', () => {
    assert.equal(isGeneric(''), false);
  });
  test('banned words match on a WORD boundary, never as a substring', () => {
    assert.deepEqual(bannedIn('Freedom Planner'), []);
    assert.deepEqual(bannedIn('Free Planner'), ['free']);
  });
  test('an emoji anywhere is a hit', () => {
    assert.deepEqual(bannedIn('Subs 🔥'), ['an emoji']);
  });
});
