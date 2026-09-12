// ─────────────────────────────────────────────────────────────────────────────
// retired-names-live.test.mjs — check-retired-names-live.mjs must catch the
// thing the tree check structurally cannot, and must refuse to grade an account
// it did not read.
//
// 🔴 THE STATE IT WAS WRITTEN FOR, 2026-09-12: every config in the tree was
// clean of `subly` and assert-retired-names.mjs was green, while the account
// still held a `subly` Pages project with 271 deployments and a `subly_db` D1
// database. The first case below is that exact inventory.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { judge, readInventory, RESOURCE_KINDS, CouldNotLook } from '../../ops/check-retired-names-live.mjs';
import { retiredIn, squash, tokensFrom } from '../retired-identity.mjs';

const TOKENS = ['subly'];

/** The account as it actually was on 2026-09-12, before the two deletions. */
const LIVE_THEN = [
  { kind: 'Pages project', name: 'subly' },
  { kind: 'Pages project', name: 'nikatru' },
  { kind: 'Pages project', name: 'subscriptiontracker' },
  { kind: 'D1 database', name: 'subly_db' },
  { kind: 'D1 database', name: 'subscriptiontracker_db' },
  { kind: 'Worker script', name: 'platform' },
];

/** The account as it is after them — the shape that must pass. */
const LIVE_NOW = [
  { kind: 'Pages project', name: 'rajasekarselvam' },
  { kind: 'Pages project', name: 'nikatru' },
  { kind: 'Pages project', name: 'subscriptiontracker' },
  { kind: 'Pages project', name: 'ratel' },
  { kind: 'D1 database', name: 'subscriptiontracker_db' },
  { kind: 'D1 database', name: 'platform_db' },
  { kind: 'Worker script', name: 'platform' },
  { kind: 'Worker script', name: 'subscriptiontracker-api' },
  { kind: 'KV namespace', name: 'platform-config' },
  { kind: 'KV namespace', name: 'platform-jwks' },
  { kind: 'KV namespace', name: 'nikatru-signups' },
  { kind: 'R2 bucket', name: 'nikatru-backups' },
  { kind: 'R2 bucket', name: 'ratel-media' },
];

describe('judge — a retired name may not still BE something in the account', () => {
  test('🔴 the real state: the Pages project and the D1 database the tree had stopped naming', () => {
    const v = judge({ tokens: TOKENS, inventory: LIVE_THEN });
    assert.equal(v.ok, false);
    assert.deepEqual(
      v.findings.map((f) => `${f.kind}:${f.name}`),
      ['Pages project:subly', 'D1 database:subly_db'],
    );
    // The message has to say why a GREEN tree check is not a contradiction, or
    // the next reader closes this as a duplicate.
    assert.match(v.line, /the tree check cannot see it/);
    assert.match(v.line, /Cloudflare dashboard/);
  });

  test('the account as it is after the deletions passes, and says what it compared', () => {
    const v = judge({ tokens: TOKENS, inventory: LIVE_NOW });
    assert.equal(v.ok, true);
    assert.deepEqual(v.findings, []);
    assert.match(v.line, new RegExp(`${LIVE_NOW.length} live resource\\(s\\)`));
    assert.match(v.line, /5 kind\(s\)/);
  });

  // Each of these is a way of proving nothing while printing the same green.
  test('an EMPTY inventory is COULD NOT LOOK, never a clean account', () => {
    assert.throws(() => judge({ tokens: TOKENS, inventory: [] }), CouldNotLook);
  });

  test('NO retired tokens is COULD NOT LOOK, never a clean account', () => {
    for (const tokens of [[], null, undefined]) {
      assert.throws(() => judge({ tokens, inventory: LIVE_NOW }), CouldNotLook);
    }
  });

  test('the retired name wearing a suffix or different punctuation is still caught', () => {
    for (const name of ['subly-api', 'SUBLY_DB', 'Sub-Ly', 'subly.nikatru.com', 'my-subly-media']) {
      const v = judge({ tokens: TOKENS, inventory: [{ kind: 'R2 bucket', name }] });
      assert.equal(v.ok, false, `${name} should have been refused`);
    }
  });

  test('a name that merely resembles the token is not a finding', () => {
    for (const name of ['subscriptiontracker', 'sub', 'supply-db', 'subtly']) {
      const v = judge({ tokens: TOKENS, inventory: [{ kind: 'Pages project', name }] });
      assert.equal(v.ok, true, `${name} should not have been refused`);
    }
  });

  test('a second retired token is asked about with no edit to the check', () => {
    const v = judge({ tokens: ['subly', 'oldname'], inventory: [{ kind: 'Worker script', name: 'oldname-api' }] });
    assert.equal(v.ok, false);
    assert.equal(v.findings[0].token, 'oldname');
  });
});

describe('readInventory — every kind, read the way that kind names things', () => {
  const answer = {
    'pages/projects': [{ name: 'nikatru' }],
    'd1/database': [{ name: 'platform_db' }],
    'workers/scripts': [{ id: 'platform' }],
    'storage/kv/namespaces': [{ id: '33e4e58abb644d0e917a159227c6c134', title: 'platform-config' }],
    'r2/buckets': { buckets: [{ name: 'nikatru-backups' }] },
  };
  const fakeApi = (over = {}) => {
    const table = { ...answer, ...over };
    return async (path) => {
      const key = Object.keys(table).find((k) => path.endsWith(`/${k}`));
      if (key === undefined) throw new CouldNotLook(`unexpected path ${path}`);
      const value = table[key];
      if (value instanceof Error) throw value;
      return value;
    };
  };

  test('asks for every kind the account can name, under the account id', async () => {
    const asked = [];
    const api = async (path) => {
      asked.push(path);
      return fakeApi()(path);
    };
    const inv = await readInventory({ accountId: 'acct', token: 't' }, api);
    assert.equal(asked.length, RESOURCE_KINDS.length);
    assert.ok(asked.every((p) => p.startsWith('/accounts/acct/')));
    assert.deepEqual(
      inv.map((r) => r.name),
      ['nikatru', 'platform_db', 'platform', 'platform-config', 'nikatru-backups'],
    );
  });

  // 🔴 A KV NAMESPACE'S NAME IS `title`; ITS `id` IS A UUID. Reading `id` would
  // compare the retired token against 32 hex characters and pass for ever while
  // looking exactly like a check.
  test("a KV namespace is read by its title, never by its uuid", async () => {
    const inv = await readInventory({ accountId: 'a', token: 't' }, fakeApi());
    const kv = inv.find((r) => r.kind === 'KV namespace');
    assert.equal(kv.name, 'platform-config');
    assert.ok(!inv.some((r) => /^[0-9a-f]{32}$/.test(r.name)), 'a uuid reached the comparison');
  });

  test('an R2 answer is unwrapped from its `buckets` envelope', async () => {
    const inv = await readInventory({ accountId: 'a', token: 't' }, fakeApi());
    assert.deepEqual(
      inv.filter((r) => r.kind === 'R2 bucket').map((r) => r.name),
      ['nikatru-backups'],
    );
  });

  // ⚠️ ONE UNREADABLE KIND STOPS THE CHECK. Reading four of five and printing ok
  // would make this check's coverage depend on which scopes the token happens to
  // hold that day — silently, and differently each run.
  test('a kind the token cannot read is COULD NOT LOOK, not four-fifths of a pass', async () => {
    for (const kind of Object.keys(answer)) {
      await assert.rejects(
        () => readInventory({ accountId: 'a', token: 't' }, fakeApi({ [kind]: new CouldNotLook('HTTP 403') })),
        CouldNotLook,
        `a refused ${kind} listing should have stopped the check`,
      );
    }
  });

  test('a listing that is not an array is COULD NOT LOOK, not an empty kind', async () => {
    await assert.rejects(
      () => readInventory({ accountId: 'a', token: 't' }, fakeApi({ 'pages/projects': { nope: true } })),
      CouldNotLook,
    );
  });

  test('a row with no name is COULD NOT LOOK, never a row that compared clean', async () => {
    await assert.rejects(
      () => readInventory({ accountId: 'a', token: 't' }, fakeApi({ 'd1/database': [{ uuid: 'x' }] })),
      CouldNotLook,
    );
  });
});

describe('the matching rule has ONE home, shared with the tree check', () => {
  test('squash removes case and every separator', () => {
    assert.equal(squash('SUBLY_DB'), 'sublydb');
    assert.equal(squash('Sub-Ly.nikatru.com'), 'sublynikatrucom');
  });

  test('tokensFrom reads the register shape, and drops blanks', () => {
    assert.deepEqual(tokensFrom({ retiredIdentityTokens: { tokens: ['subly', '', '  '] } }), ['subly']);
    assert.deepEqual(tokensFrom({}), []);
    assert.deepEqual(tokensFrom(null), []);
  });

  test('retiredIn returns WHICH token matched, so the message can name it', () => {
    assert.equal(retiredIn(['subly', 'oldname'], 'oldname_db'), 'oldname');
    assert.equal(retiredIn(['subly'], 'nikatru'), null);
  });
});
