// ─────────────────────────────────────────────────────────────────────────────
// app-yaml.test.mjs — the recorded failing cases for assert-app-yaml.mjs and the
// renderer it grades.
//
// [pipeline F-10] "Every guard carries a recorded failing case and a self-check
// that its own scan still reaches everything it claims to cover."
// `assert-guard-coverage.mjs` refuses a guard no test file names, in its own
// words: "It has only ever run against the real repo, which is valid input by
// definition, so nothing exercises its failing path."
//
// ── EVERY CASE MUTATES A REAL TREE AND SPAWNS THE REAL EXECUTABLES ───────────
// No mocks and no hand-written fixture catalogue. A fixture that models the
// renderer's own assumptions agrees with it about exactly the thing under test —
// this repository's recorded reason for `assert-clone-contract.mjs` parsing
// rather than grepping, and for `generate-apps-data.test.mjs` running the real
// script against a real temp tree.
//
// The tree each case runs against is the REAL repository's declaration, register
// and store trees, copied file by file. So the POSITIVE CONTROL below is the
// strongest statement available: the bytes a human wrote by hand into
// `catalog/apps.json` and into twenty-five listing files are EXACTLY what
// `apps/subly/app.yaml` renders to. If that ever stops holding, the declaration
// and the tree have parted company and every negative case below is about a
// tree nobody ships.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseYaml, YamlError } from '../../app-yaml/yaml.mjs';
import { validate, assertSchemaUnderstood, SchemaError } from '../../app-yaml/schema-validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-app-yaml.mjs');
const RENDER = join(REPO, 'tooling', 'app-yaml', 'render.mjs');

const APP_YAML = 'apps/subly/app.yaml';
const PRIVACY_YAML = 'apps/subly/privacy.yaml';
const CATALOGUE = 'catalog/apps.json';
const TITLE = 'apps/subly/store/windows-store/title.txt';

/* Never through a pipe, and never `$?` beside a command substitution: this
   corpus has had a failing command read as exit 0 three times that way. */
const spawn = (script, args) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { code: r.status === null ? 2 : r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

/** A copy of everything the guard and the renderer read, and nothing else. */
function tree() {
  const root = mkdtempSync(join(tmpdir(), 'app-yaml-'));
  for (const rel of ['apps/subly/app.yaml', 'apps/subly/privacy.yaml', 'catalog/apps.json', 'tooling/channel-register.json', 'tooling/legal/provider-register.json']) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  cpSync(join(REPO, 'apps/subly/store'), join(root, 'apps/subly/store'), { recursive: true });
  return root;
}
const put = (root, rel, text) => writeFileSync(join(root, rel), text);
const get = (root, rel) => readFileSync(join(root, rel), 'utf8');
const kill = (root) => rmSync(root, { recursive: true, force: true });

describe('assert-app-yaml — the declaration and its renderings', () => {
  test('POSITIVE CONTROL: the real tree is valid and every rendering is fresh', () => {
    const root = tree();
    try {
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 0, `the real declaration must grade clean:\n${out}`);
      assert.match(out, /byte-identical/);
    } finally { kill(root); }
  });

  test('POSITIVE CONTROL: --check is green and writes nothing on the real tree', () => {
    const root = tree();
    try {
      const before = get(root, CATALOGUE);
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.equal(code, 0, out);
      assert.equal(get(root, CATALOGUE), before, '--check must not write — it is a read-only assertion');
    } finally { kill(root); }
  });

  test('MUTATION: deleting `id` from the declaration is a FINDING, not a coverage loss', () => {
    // Exit 1 and not 2 is the assertion. Both are non-zero, and only one names
    // the repair: this guard exited 2 blaming its privacy limb until it learned
    // to stop at the declaration that would not parse.
    const root = tree();
    try {
      put(root, APP_YAML, get(root, APP_YAML).split('\n').filter((l) => !l.startsWith('id: ')).join('\n'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /required property "id" is absent/);
    } finally { kill(root); }
  });

  test('MUTATION: editing the tagline without re-rendering fails, and NAMES every stale file', () => {
    const root = tree();
    try {
      put(root, APP_YAML, get(root, APP_YAML).replace(/^tagline: .*$/m, 'tagline: Track every subscription in one calm place'));
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.equal(code, 1, out);
      assert.match(out, /catalog\/apps\.json/);
      // Five channels, one short-description each. A drift check that named only
      // the catalogue would leave the listing copy silently forked.
      const named = [...out.matchAll(/short-description\.txt/g)].length;
      assert.equal(named, 5, `expected all five channels named, got ${named}:\n${out}`);
      assert.equal(spawn(GUARD, [root]).code, 1);
    } finally { kill(root); }
  });

  test('MUTATION: editing the name without re-rendering names every title.txt', () => {
    const root = tree();
    try {
      put(root, APP_YAML, get(root, APP_YAML).replace(/^name: .*$/m, 'name: Subly Pro'));
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.equal(code, 1, out);
      assert.equal([...out.matchAll(/title\.txt/g)].length, 5, out);
    } finally { kill(root); }
  });

  test('MUTATION: a HAND EDIT to a listing file fails — the only thing that can catch one', () => {
    // `title.txt` holds nothing but the title a store shows, so it cannot carry
    // a "generated, do not edit" header. This comparison is the whole protection.
    const root = tree();
    try {
      put(root, TITLE, 'Subly — Best Subscription App\n');
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /windows-store\/title\.txt/);
    } finally { kill(root); }
  });

  test('MUTATION: a hand edit to catalog/apps.json fails', () => {
    const root = tree();
    try {
      put(root, CATALOGUE, get(root, CATALOGUE).replace('"status": "live"', '"status": "preview"'));
      assert.equal(spawn(GUARD, [root]).code, 1);
    } finally { kill(root); }
  });

  test('MUTATION: `listings.web` written by hand is refused — it is DERIVED', () => {
    const root = tree();
    try {
      put(root, APP_YAML, `${get(root, APP_YAML).replace(/^listings:$/m, 'listings:\n  web: https://elsewhere.example')}`);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /DERIVED from hosts\.web/);
    } finally { kill(root); }
  });

  test('MUTATION: a processor nobody has named is refused', () => {
    const root = tree();
    try {
      put(root, PRIVACY_YAML, get(root, PRIVACY_YAML).replace('  - id: cloudflare', '  - id: some-analytics-vendor'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /is not a row in tooling\/legal\/provider-register\.json/);
    } finally { kill(root); }
  });

  test('MUTATION: a network address in the privacy declaration is refused', () => {
    // C-NO-NETWORK-ADDRESS-COLUMN. This claim has already been false in
    // publication once, which is why the words are refused and not only the flag.
    const root = tree();
    try {
      put(root, PRIVACY_YAML, get(root, PRIVACY_YAML).replace('    type: Diagnostics', '    type: IP address'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /names a network address/);
    } finally { kill(root); }
  });

  test('MUTATION: `networkAddress: true` is refused by the schema itself', () => {
    const root = tree();
    try {
      put(root, PRIVACY_YAML, get(root, PRIVACY_YAML).replace('networkAddress: false', 'networkAddress: true'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /networkAddress/);
    } finally { kill(root); }
  });

  test('MUTATION: a retention period outside the locked set is refused', () => {
    // [ADR 045] / C-RETENTION-PERIODS: 400 / 730 / 1100 and nothing else, so a
    // convenience change cannot quietly extend how long personal data is kept.
    const root = tree();
    try {
      put(root, PRIVACY_YAML, get(root, PRIVACY_YAML).replace('retentionClass: 400', 'retentionClass: 3650'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /retentionClass/);
    } finally { kill(root); }
  });

  test('COVERAGE LOST: no declaration at all exits 2, never 0', () => {
    const root = tree();
    try {
      rmSync(join(root, APP_YAML));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, `a run that graded nothing must not share an exit code with a pass:\n${out}`);
      assert.match(out, /COVERAGE LOST/);
    } finally { kill(root); }
  });

  test('COVERAGE LOST: an unreadable channel register exits 2', () => {
    // The storefront key set AND every listing directory come from it. Without
    // it the rendered `listings` block silently loses keys and no listing file
    // is written at all — a run that would otherwise report the catalogue fresh.
    const root = tree();
    try {
      rmSync(join(root, 'tooling/channel-register.json'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, out);
      assert.match(out, /COVERAGE LOST/);
    } finally { kill(root); }
  });

  test('COVERAGE LOST: no privacy declaration anywhere exits 2', () => {
    const root = tree();
    try {
      rmSync(join(root, PRIVACY_YAML));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, out);
      assert.match(out, /privacy\.yaml/);
    } finally { kill(root); }
  });

  test('COVERAGE LOST: a declaration that renders ZERO listing files exits 2', () => {
    const root = tree();
    try {
      rmSync(join(root, 'apps/subly/store'), { recursive: true });
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, out);
      assert.match(out, /ZERO listing files/);
    } finally { kill(root); }
  });

  test('the renderer WRITES the repair it names, and is byte-stable across runs', () => {
    const root = tree();
    try {
      put(root, APP_YAML, get(root, APP_YAML).replace(/^tagline: .*$/m, 'tagline: Track every subscription in one calm place'));
      assert.equal(spawn(RENDER, [root]).code, 0);
      const first = get(root, CATALOGUE);
      assert.match(first, /one calm place/);
      assert.equal(get(root, TITLE), 'Subly\n', 'a tagline change must not touch the title');
      assert.equal(spawn(RENDER, [root]).code, 0);
      // A drift check over an unstable generator fails at random and gets
      // switched off within a week, taking the real protection with it.
      assert.equal(get(root, CATALOGUE), first, 'the renderer must be byte-stable across runs');
      assert.equal(spawn(GUARD, [root]).code, 0);
    } finally { kill(root); }
  });

  test('the renderer NEVER touches a sworn declaration or the editorial copy', () => {
    // assert-sworn-store-files.mjs limb 7 is the tripwire this respects:
    // "a template that carries answers makes app #2 swear to app #1's code".
    const untouchable = [
      'apps/subly/store/android-play/data-safety.json',
      'apps/subly/store/android-play/content-rating.json',
      'apps/subly/store/android-play/ads-declaration.json',
      'apps/subly/store/ios-appstore/privacy-manifest.json',
      'apps/subly/store/android-play/long-description.txt',
      'apps/subly/store/ios-appstore/keywords.txt',
      'apps/subly/store/windows-store/search-terms.txt',
    ];
    const root = tree();
    try {
      const before = new Map(untouchable.map((rel) => [rel, get(root, rel)]));
      assert.ok(before.size > 0 && [...before.values()].every((v) => v.length > 0), 'the fixture must actually carry the files it claims to protect');
      put(root, APP_YAML, get(root, APP_YAML).replace(/^name: .*$/m, 'name: Renamed'));
      assert.equal(spawn(RENDER, [root]).code, 0);
      for (const [rel, text] of before) assert.equal(get(root, rel), text, `${rel} must not be rewritten by the renderer`);
    } finally { kill(root); }
  });

  test('the renderer creates no store tree that was not already there', () => {
    // A missing tree on a deferred channel is an OWNER-GATED gap that
    // assert-store-metadata.mjs prints. A renderer that conjured one would turn
    // that print into a commitment nobody made.
    const root = tree();
    try {
      rmSync(join(root, 'apps/subly/store/linux-snap'), { recursive: true });
      assert.equal(spawn(RENDER, [root]).code, 0);
      assert.equal(existsSync(join(root, 'apps/subly/store/linux-snap')), false);
    } finally { kill(root); }
  });
});

describe('yaml.mjs — the subset REFUSES what it does not implement', () => {
  const refuses = [
    ['flow sequences', 'platforms: [web, android]\n'],
    ['flow mappings', 'hosts: {web: x.nikatru.com}\n'],
    ['anchors', 'a: &x 1\nb: *x\n'],
    ['tags', 'a: !!str 1\n'],
    ['a tab', 'a:\n\t- b\n'],
    ['odd indentation', 'a:\n   b: 1\n'],
    ['a duplicate key', 'a: 1\na: 2\n'],
    ['document markers', '---\na: 1\n'],
    ['an un-chomped folded scalar', 'a: >\n  text\n'],
    ['an un-chomped literal scalar', 'a: |\n  text\n'],
  ];
  for (const [what, text] of refuses) {
    test(`refuses ${what} rather than guessing`, () => {
      assert.throws(() => parseYaml(text), YamlError, `${what} was parsed instead of refused`);
    });
  }

  test('a `#` inside a quoted value is CONTENT, not a comment', () => {
    assert.deepEqual(parseYaml('a: "x # y"\n'), { a: 'x # y' });
  });

  test('a trailing comment outside quotes IS stripped', () => {
    assert.deepEqual(parseYaml('a: b # note\n'), { a: 'b' });
  });

  test('escapes in a double-quoted scalar survive, and an unknown one is refused', () => {
    assert.deepEqual(parseYaml('a: "he said \\"hi\\""\n'), { a: 'he said "hi"' });
    assert.throws(() => parseYaml('a: "\\q"\n'), YamlError);
  });

  test('a folded block scalar joins its lines with one space', () => {
    assert.deepEqual(parseYaml('a: >-\n  one\n  two\n'), { a: 'one two' });
  });

  test('a sequence of mappings parses, and so does one of scalars', () => {
    assert.deepEqual(parseYaml('rows:\n  - k: 1\n    j: 2\n  - k: 3\n'), { rows: [{ k: 1, j: 2 }, { k: 3 }] });
    assert.deepEqual(parseYaml('rows:\n  - a\n  - b\n'), { rows: ['a', 'b'] });
  });
});

describe('schema-validate.mjs — an unimplemented keyword is refused, never ignored', () => {
  test('an unknown keyword throws instead of silently not constraining', () => {
    // The whole design. A validator that skips what it does not understand turns
    // every schema typo into a constraint that reads as present and is not there.
    assert.throws(() => assertSchemaUnderstood({ type: 'array', minimumItems: 2 }), SchemaError);
  });

  test('additionalProperties:true is refused — every object schema closes its set', () => {
    assert.throws(() => assertSchemaUnderstood({ type: 'object', additionalProperties: true }), SchemaError);
  });

  test('a format with no implementation is refused', () => {
    assert.throws(() => assertSchemaUnderstood({ type: 'string', format: 'email' }), SchemaError);
  });

  test('the two shipped schemas are entirely understood by this validator', () => {
    for (const rel of ['tooling/app-yaml/schema/app.schema.json', 'tooling/app-yaml/schema/privacy.schema.json']) {
      const schema = JSON.parse(readFileSync(join(REPO, rel), 'utf8'));
      assert.equal(assertSchemaUnderstood(schema, rel), true, `${rel} carries a keyword nothing enforces`);
    }
  });

  test('it reports EVERY problem at once, not the first', () => {
    const schema = { type: 'object', additionalProperties: false, required: ['a', 'b'], properties: { a: { type: 'string' }, b: { type: 'string' } } };
    assert.equal(validate({ c: 1 }, schema).length, 3);
  });
});
