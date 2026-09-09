// ─────────────────────────────────────────────────────────────────────────────
// assert-name-clearance.test.mjs — the mutation matrix for
// `tooling/ci/assert-name-clearance.mjs`.
//
// 🔴 A GUARD THAT CANNOT FAIL IS NOT A GUARD. This guard runs against a tree
// where the answer is currently "printed and owner-gated" — Subly is
// PROVEN-TAKEN on `ios-appstore` and that channel is unarmed — so on the real
// repository it exits 0 every time. Read alone, that green is consistent with a
// guard that exits 0 unconditionally, which is exactly the shape this corpus has
// twice found and deleted. So every limb below is driven by a REAL FIXTURE TREE,
// seeded from the real register, the real catalogue, the real schema and the
// real identity files, and then MUTATED one property at a time.
//
// GREEN CONTROL FIRST (M0). Without a run over the unmutated fixture that exits
// 0, every red below would be equally consistent with a guard that refuses
// everything — a guard that reports a defect on a correct tree, which costs more
// than it saves.
//
// THE SHARPEST CASE IS M3. The blocked-but-unarmed state is the ONLY reason main
// is green today, and if that derivation ever stopped depending on the register
// the guard would go on printing ⬜ after `ios-appstore` acquired a lane — a
// clearance that had stopped clearing, silently, at exactly the moment it
// mattered. M3 flips `served` in the fixture register and requires the exit to
// move 0 → 1. Nothing is typed into a list to make that happen.
//
// Run:  node --test tooling/ci/test/assert-name-clearance.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-name-clearance.mjs');

/** Everything the guard reads, and nothing else. Copied from the real tree so a
 *  fixture cannot quietly model a register the repository does not have. */
const SEEDED = [
  'tooling/channel-register.json',
  'catalog/apps.json',
  'contracts/name-clearance.schema.json',
  'apps/subly/app.yaml',
  'apps/subly/name-clearance.json',
  'apps/subly/android/app/build.gradle.kts',
  'apps/subly/ios/Runner.xcodeproj/project.pbxproj',
  'apps/subly/macos/Runner/Configs/AppInfo.xcconfig',
  'apps/subly/linux/CMakeLists.txt',
];

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-anc-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A throwaway checkout of just the guard's subject. `mutate` receives helpers
 *  that read and write files inside it. */
function fixture(mutate = () => {}) {
  const root = join(TMP, `r${(seq += 1)}`);
  for (const rel of SEEDED) {
    const dst = join(root, ...rel.split('/'));
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(join(REPO, ...rel.split('/')), dst);
  }
  const readText = (rel) => readFileSync(join(root, ...rel.split('/')), 'utf8');
  const writeText = (rel, text) => writeFileSync(join(root, ...rel.split('/')), text);
  const editJson = (rel, fn) => {
    const doc = JSON.parse(readText(rel));
    const next = fn(doc) ?? doc;
    writeText(rel, `${JSON.stringify(next, null, 2)}\n`);
  };
  mutate({ root, readText, writeText, editJson });
  return root;
}

/** The guard's exit code, captured ON ITS OWN LINE — `$?` beside anything else
 *  is that thing's status, which is how a red guard has been read as green in
 *  this repository before. */
function run(root, args = []) {
  const r = spawnSync(process.execPath, [GUARD, '--repo', root, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const RECORD = 'apps/subly/name-clearance.json';

describe('assert-name-clearance — the green control', () => {
  test('M0 GREEN CONTROL — the unmutated fixture exits 0 and PRINTS both owed findings', () => {
    const r = run(fixture());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /PROVEN-TAKEN on ios-appstore/, 'the wall must be printed, not swallowed');
    assert.match(r.out, /NOT BLOCKING TODAY/);
    assert.match(r.out, /QUALIFIED, NOT CLEAR/, 'a null trademark ruling must never print as clear');
    assert.match(r.out, /owner-gated until/);
  });
});

describe('assert-name-clearance — the mutation matrix', () => {
  test('M1 a MISSING record is a finding, and it names the command that makes one', () => {
    const root = fixture(({ root: r }) => rmSync(join(r, 'apps', 'subly', 'name-clearance.json')));
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no apps\/subly\/name-clearance\.json/);
    assert.match(r.out, /name-clearance\.mjs "<Name>" --app subly --execute/);
  });

  test('M2 a record for a DIFFERENT name than app.yaml declares is a finding', () => {
    const root = fixture(({ readText, writeText }) => writeText('apps/subly/app.yaml', readText('apps/subly/app.yaml').replace(/^name: Subly$/m, 'name: Renamed')));
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /clears the name "Subly" while apps\/subly\/app\.yaml declares "Renamed"/);
  });

  test('M3 THE ARMING BITE — the same BLOCKED record fails the moment its channel arms', () => {
    const before = run(fixture());
    assert.equal(before.code, 0, 'green control first');
    const root = fixture(({ editJson }) =>
      editJson('tooling/channel-register.json', (doc) => {
        for (const c of doc.channels) if (c.id === 'ios-appstore') c.served = true;
      }),
    );
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is ARMED/);
    assert.match(r.out, /would be refused by a channel that can reach a user today/);
  });

  test('M4 a record whose RED CONTROLS FAILED is not evidence, whatever its verdicts say', () => {
    const root = fixture(({ editJson }) =>
      editJson(RECORD, (doc) => {
        doc.controls = { green: 0, failed: ['amo', 'ios-appstore'] };
      }),
    );
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /red control\(s\) FAILED on the run that wrote it/);
  });

  test('M5 the owner gate EXPIRES — a past `gatedUntil` blocks, and so does a missing one', () => {
    const expired = run(
      fixture(({ editJson }) =>
        editJson(RECORD, (doc) => {
          doc.trademark.gatedUntil = '2020-01-01';
        }),
      ),
    );
    assert.equal(expired.code, 1, expired.out);
    assert.match(expired.out, /EXPIRED on 2020-01-01/);

    const undated = run(
      fixture(({ editJson }) =>
        editJson(RECORD, (doc) => {
          doc.trademark.gatedUntil = null;
        }),
      ),
    );
    assert.equal(undated.code, 1, undated.out);
    assert.match(undated.out, /carries no `gatedUntil` date/);

    const unowned = run(
      fixture(({ editJson }) =>
        editJson(RECORD, (doc) => {
          doc.trademark.ownerItem = null;
        }),
      ),
    );
    assert.equal(unowned.code, 1, unowned.out);
    assert.match(unowned.out, /a finding nobody owns/);
  });

  test('M6 an owner ruling of DO-NOT-PROCEED blocks unconditionally', () => {
    const root = fixture(({ editJson }) =>
      editJson(RECORD, (doc) => {
        doc.trademark.ruling = 'DO-NOT-PROCEED';
        doc.trademark.ruledBy = 'owner';
        doc.trademark.ruledOn = '2026-09-09';
      }),
    );
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /RULED DO-NOT-PROCEED/);
  });

  test('M7 IDENTITY DRIFT — an applicationId the tree no longer declares is a finding', () => {
    // The `applicationId` LINE, not the first occurrence of the string: this
    // file also carries `namespace = "com.nikatru.subly"` above it, and a bare
    // `.replace()` mutates that one instead and leaves the identity the guard
    // actually reads untouched — a mutation that changes nothing, which reads
    // exactly like a guard that cannot fail. It did, on the first run.
    const root = fixture(({ readText, writeText }) =>
      writeText(
        'apps/subly/android/app/build.gradle.kts',
        readText('apps/subly/android/app/build.gradle.kts').replace(/^(\s*applicationId\s*=\s*)"[^"]+"/m, '$1"com.nikatru.renamed"'),
      ),
    );
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /now declares "com\.nikatru\.renamed"/);
    assert.match(r.out, /one app_id derives every store identity/);
  });

  test('M8 SELF IS NOT A COLLISION, but a second app declaring the same name is', () => {
    const root = fixture(({ editJson }) =>
      editJson('catalog/apps.json', (doc) => {
        doc.push({ ...doc[0], slug: 'twin' });
      }),
    );
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /a DIFFERENT app in catalog\/apps\.json already declares this name/);
    assert.match(r.out, /twin/);
  });

  test('M9 STALENESS — past the ceiling it WARNS in the hook and FAILS under --execute', () => {
    const stale = ({ editJson }) =>
      editJson(RECORD, (doc) => {
        doc.asOf = '2020-01-01';
      });
    const hook = run(fixture(stale));
    assert.equal(hook.code, 0, hook.out);
    assert.match(hook.out, /the ceiling is 30/);
    assert.match(hook.out, /a WARNING here and a FINDING under --execute/);

    const routine = run(fixture(stale), ['--execute']);
    assert.equal(routine.code, 1, routine.out);
    assert.match(routine.out, /the ceiling is 30/);
  });

  test('M10 a record written against a DIFFERENT channel set is COVERAGE LOST, not a pass', () => {
    const root = fixture(({ editJson }) =>
      editJson(RECORD, (doc) => {
        delete doc.channels['linux-snap'];
      }),
    );
    const r = run(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /Never asked about: linux-snap/);
  });

  test('M11 an unreadable register is COVERAGE LOST — nothing was checked, and nothing is not a pass', () => {
    const root = fixture(({ writeText }) => writeText('tooling/channel-register.json', '{ not json'));
    const r = run(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('M12 a record that violates the schema is a finding, not a clearance', () => {
    const root = fixture(({ editJson }) =>
      editJson(RECORD, (doc) => {
        doc.channels.web.verdict = 'PROBABLY-FINE';
      }),
    );
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /PROBABLY-FINE/);
  });

  test('M13 an empty catalogue is COVERAGE LOST — the expected set is what stops a vacuous green', () => {
    const root = fixture(({ writeText }) => writeText('catalog/apps.json', '[]\n'));
    const r = run(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /declares no app with a `slug`/);
  });

  test('M15 ONE DAY AHEAD IS GEOGRAPHY, NOT A DEFECT — a record stamped in IST is read in UTC', () => {
    // 🔴 THIS EXACT CASE FAILED CI ON THE FIRST PUSH. The probe stamps the LOCAL
    // date on purpose (UTC would stamp yesterday for an evening run at +05:30 and
    // give a day of the 30-day ceiling away), and the runner reads it in UTC:
    // local 2026-09-09 02:51 IST is 2026-09-08 21:21 UTC, so a correct record
    // read as "measured tomorrow" and the guard refused it. Tolerating one day is
    // the whole width of the effect — M14 proves it is not tolerating more.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const root = fixture(({ editJson }) =>
      editJson(RECORD, (doc) => {
        doc.asOf = tomorrow;
      }),
    );
    const r = run(root);
    assert.equal(r.code, 0, r.out);
  });

  test('M14 an `asOf` in the future is a finding — a clearance cannot have been measured tomorrow', () => {
    const root = fixture(({ editJson }) =>
      editJson(RECORD, (doc) => {
        doc.asOf = '2099-01-01';
      }),
    );
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /More than a day is more than geography can explain/);
  });
});
