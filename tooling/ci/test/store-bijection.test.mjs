// ─────────────────────────────────────────────────────────────────────────────
// store-bijection.test.mjs — assert-store-bijection.mjs must be able to FAIL,
// in both directions, and must REFUSE rather than pass when a side is empty.
//
// Pipeline requirement: Private/requirements/ → C-6.
//
// 🔴 THE GREEN CONTROL COMES FIRST AND IT IS NOT A FORMALITY. Every mutation
// below is built by taking the control fixture and changing ONE thing, so a
// fixture that was red for an unrelated reason would make all of them "pass" for
// the wrong reason — the shape this repository has recorded a guard shipping
// with more than once. The control asserts exit 0 and the ok line; only then is
// a single edit applied per case.
//
// 🔴 AND THE FIXTURES ARE DERIVED FROM `DECLARED_STORES`, NEVER TYPED. The
// guard's table is the left-hand side of the relationship under test; a second
// copy of it here would drift, and the day it drifted every case would still be
// green while testing a bijection nobody ships.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DECLARED_STORES, flatten, compare, compareManifest } from '../assert-store-bijection.mjs';

const GUARD = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assert-store-bijection.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-storebij-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;

/** Every channel id the guard's own table maps to — the control's store rows. */
const declaredChannelIds = () => DECLARED_STORES.flatMap((e) => e.channels);

/** A root carrying a register. `channelIds` become `kind: "store"` rows; a `web`
 *  row rides along so "store rows" is a filter with something to exclude rather
 *  than the whole file. `register: null` writes no register at all. */
function fixture(channelIds, { manifestStores = undefined, register = 'write' } = {}) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  if (register === 'write') {
    const channels = [
      { id: 'web', kind: 'web' },
      ...channelIds.map((id) => ({ id, kind: 'store' })),
    ];
    writeFileSync(join(root, 'tooling/channel-register.json'), JSON.stringify({ channels }, null, 2));
  } else if (typeof register === 'string') {
    writeFileSync(join(root, 'tooling/channel-register.json'), register);
  }
  if (manifestStores !== undefined) {
    mkdirSync(join(root, 'Private', 'platform-state'), { recursive: true });
    writeFileSync(
      join(root, 'Private/platform-state/manifest.json'),
      JSON.stringify({ stores: manifestStores }, null, 2),
    );
  }
  return root;
}

const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [GUARD, root, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

// ── THE GREEN CONTROL ────────────────────────────────────────────────────────
describe('assert-store-bijection — the control', () => {
  test('every declared store maps onto a store channel: exit 0', () => {
    const { code, out } = run(fixture(declaredChannelIds()));
    assert.equal(code, 0, out);
    assert.match(out, /ok {3}store bijection/);
    assert.match(out, /every store channel is claimed/);
  });

  // The printed limit is a stated absence, not a pass — and it must SAY so, or
  // a reader takes the ok line above as agreement with a file never opened.
  test('with no corpus on the checkout, the drift limb PRINTS its limit', () => {
    const { code, out } = run(fixture(declaredChannelIds()));
    assert.equal(code, 0, out);
    assert.match(out, /DRIFT LIMB NOT RUN/);
    assert.match(out, /A stated limit, not a pass/);
  });

  test('the real repository is green, and only with the ok line', () => {
    const r = spawnSync(process.execPath, [GUARD], { encoding: 'utf8' });
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 0, out);
    assert.match(out, /ok {3}store bijection/);
  });
});

// ── DIRECTION A: the manifest is ahead of the register ───────────────────────
// This is the `apps-gov-in` defect itself: a store in the knowledge set with no
// channel row anywhere.
describe('assert-store-bijection — a declared store with no channel row FAILS', () => {
  for (const missing of ['apps-gov-in', 'android-play', 'macos-appstore']) {
    test(`the register loses "${missing}"`, () => {
      const { code, out } = run(fixture(declaredChannelIds().filter((c) => c !== missing)));
      assert.equal(code, 1, out);
      assert.match(out, new RegExp(`maps to channel "${missing}", which no`));
      assert.match(out, /assert-store-bijection: FAILED/);
    });
  }

  // 🔴 THE HALF-MAPPED STORE. `apple` maps to two channels; losing ONE of them
  // must fail exactly as losing the whole store does, or a many-to-one entry
  // becomes a way to hide a channel behind its sibling.
  test('a many-to-one store keeps one channel and loses the other', () => {
    const { code, out } = run(fixture(declaredChannelIds().filter((c) => c !== 'ios-appstore')));
    assert.equal(code, 1, out);
    assert.match(out, /store "apple" maps to channel "ios-appstore"/);
  });
});

// ── DIRECTION B: the register is ahead of the manifest ───────────────────────
describe('assert-store-bijection — a store channel no store claims FAILS', () => {
  test('a new store channel appears in the register alone', () => {
    const { code, out } = run(fixture([...declaredChannelIds(), 'huawei-appgallery']));
    assert.equal(code, 1, out);
    assert.match(out, /declares store channel "huawei-appgallery" and the platform manifest/);
  });

  // The direction that matters most and reads least like a bug: an agent arms a
  // channel the owner's knowledge set has never named.
  test('the message says WHY that direction is the dangerous one', () => {
    const { out } = run(fixture([...declaredChannelIds(), 'huawei-appgallery']));
    assert.match(out, /an agent could arm without the owner ever reading that it exists/);
  });
});

// ── COVERAGE LOST — never a pass, and never exit 1 either ────────────────────
describe('assert-store-bijection — an empty side REFUSES with exit 2', () => {
  test('no register at all', () => {
    const { code, out } = run(fixture([], { register: null }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /does not exist/);
  });

  test('an unparseable register', () => {
    const { code, out } = run(fixture([], { register: '{ not json' }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /not valid JSON/);
  });

  // A register with rows but no STORE rows: the right-hand side is empty and
  // every declared store would read as "missing" — a true sentence about a scan
  // that lost its subject, not a finding about the platform.
  test('a register with zero kind:"store" channels', () => {
    const { code, out } = run(fixture([]));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO `kind: "store"` channels/);
  });

  test('COVERAGE LOST on a subject-free tree — the shape assert-guards-refuse-empty spawns', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /COVERAGE LOST/);
  });
});

// ── THE DRIFT LIMB — the mirror versus the file it mirrors ───────────────────
describe('assert-store-bijection — the declared table is held to the real manifest', () => {
  const allIds = () => DECLARED_STORES.map((e) => e.store);

  test('control: an agreeing manifest adds an ok line, not a print', () => {
    const root = fixture(declaredChannelIds(), { manifestStores: allIds().map((id) => ({ id })) });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /ok {3}drift/);
    assert.doesNotMatch(out, /DRIFT LIMB NOT RUN/);
  });

  test('a store in the manifest and not in the table FAILS', () => {
    const root = fixture(declaredChannelIds(), {
      manifestStores: [...allIds(), 'samsung-galaxy-store'].map((id) => ({ id })),
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /lists store "samsung-galaxy-store" and this guard's declared table does not/);
  });

  test('a store in the table and not in the manifest FAILS', () => {
    const root = fixture(declaredChannelIds(), {
      manifestStores: allIds().filter((id) => id !== 'apps-gov-in').map((id) => ({ id })),
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /this guard declares store "apps-gov-in" and platform-state\/manifest.json does not list it/);
  });

  test('a manifest with an EMPTY stores[] is COVERAGE LOST, not seven findings', () => {
    const root = fixture(declaredChannelIds(), { manifestStores: [] });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /carries no `stores\[\]` array/);
  });

  // 🔴 ASKED-AND-COULD-NOT-LOOK IS NOT NOT-ASKED. `--manifest` naming a path
  // that is not there must refuse; the printed limit belongs only to the caller
  // who never asked.
  test('--manifest naming a missing file REFUSES', () => {
    const { code, out } = run(fixture(declaredChannelIds()), '--manifest', join(TMP, 'nope.json'));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /which does not exist/);
  });

  // The trap this argv parser exists for: a no-value flag binds `undefined` and
  // reads afterwards exactly like a flag nobody passed.
  test('--manifest with no value REFUSES rather than silently skipping', () => {
    const { code, out } = run(fixture(declaredChannelIds()), '--manifest');
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /given \(nothing\) as its value/);
  });

  test('--manifest swallowing the next flag REFUSES', () => {
    const { code, out } = run(fixture(declaredChannelIds()), '--manifest', '--verbose');
    assert.equal(code, 2, out);
    assert.match(out, /given --verbose as its value/);
  });
});

// ── THE TABLE'S OWN SHAPE — pure, no filesystem ──────────────────────────────
describe('assert-store-bijection — the declared table cannot be malformed quietly', () => {
  test('the shipped table is well formed and claims every channel exactly once', () => {
    const { duplicated, malformed, owner } = flatten(DECLARED_STORES);
    assert.deepEqual(malformed, []);
    assert.deepEqual(duplicated, []);
    assert.equal(owner.size, declaredChannelIds().length);
  });

  test('a many-to-one entry with no `why` is malformed', () => {
    const { malformed } = flatten([{ store: 'apple', channels: ['ios-appstore', 'macos-appstore'], why: null }]);
    assert.equal(malformed.length, 1);
    assert.match(malformed[0], /says nothing about WHY/);
  });

  test('a RENAME with no `why` is malformed too — the ids differ, so it is a netting', () => {
    const { malformed } = flatten([{ store: 'google-play', channels: ['android-play'], why: null }]);
    assert.equal(malformed.length, 1);
  });

  test('an identity entry needs no `why`', () => {
    const { malformed } = flatten([{ store: 'apps-gov-in', channels: ['apps-gov-in'], why: null }]);
    assert.deepEqual(malformed, []);
  });

  test('a store mapping to nothing is malformed, not merely empty', () => {
    const { malformed } = flatten([{ store: 'apple', channels: [], why: 'x' }]);
    assert.equal(malformed.length, 1);
    assert.match(malformed[0], /names no channels/);
  });

  test('two stores claiming one channel is refused, not resolved to the last', () => {
    const { duplicated } = flatten([
      { store: 'apple', channels: ['ios-appstore'], why: null },
      { store: 'microsoft', channels: ['ios-appstore'], why: null },
    ]);
    assert.equal(duplicated.length, 1);
    assert.match(duplicated[0], /claimed by "apple" and "microsoft"/);
  });

  test('compare() reports both directions independently', () => {
    const r = compare(
      [{ store: 'a', channels: ['a'], why: null }, { store: 'b', channels: ['b'], why: null }],
      ['b', 'c'],
    );
    assert.deepEqual(r.declaredOnly, ['a']);
    assert.deepEqual(r.registerOnly, ['c']);
  });

  test('compareManifest() is order-insensitive and counts what it compared', () => {
    const r = compareManifest(
      [{ store: 'b', channels: ['b'], why: null }, { store: 'a', channels: ['a'], why: null }],
      ['a', 'b'],
    );
    assert.deepEqual(r.onlyInGuard, []);
    assert.deepEqual(r.onlyInManifest, []);
    assert.equal(r.compared, 2);
  });
});
