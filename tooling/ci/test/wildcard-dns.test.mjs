// ─────────────────────────────────────────────────────────────────────────────
// wildcard-dns.test.mjs — the wildcard is judged from the ZONE, and "I could not
// look" is never a pass.
//
// tooling/ops/check-wildcard-dns.mjs exists because [ADR 080] §4 deleted the
// proxied wildcard `*.nikatru.com` and nothing could keep it deleted. The CI
// guard that used to enforce it resolved a name nobody registered, and a
// runner's resolver lags the zone: after the record was deleted at 17:13:11Z on
// 2026-09-11 a fresh `wc-6980804e.nikatru.com` still answered HTTP 530 from a
// GitHub runner at 17:42Z while 8.8.8.8 and 1.1.1.1 both returned NXDOMAIN. So
// the question moved to ops-watch and to the zone's own record list.
//
//   W1 GREEN CONTROL — a zone with records and no wildcard passes, and SAYS how
//      many records it read
//   W2 a wildcard record is exit 1, naming the record and its id
//   W3 a wildcard one label deeper is caught too
//   W4 an EMPTY record list is COVERAGE LOST, never "no wildcard"
//   W5 a non-array answer is COVERAGE LOST
//   W6 no token is exit 2, and the process says the zone was not read
//   W7 an API refusal is exit 2 — fail-closed in every direction
//   W8 a zone name resolving to zero or two zones is exit 2
//   W9 a record list longer than the page budget is exit 2, never "no wildcard"
//   W10 the apex is IMPORTED, not retyped — one literal, one home
//   W11 ops-watch runs it in a job a duty row already claims, so a wildcard that
//       came back is watched by somebody
//
// Mutations run against check-wildcard-dns.mjs (predictions written first):
//   · `records.length === 0` branch deleted                 → W4 RED
//   · wildcardRecords' `name.startsWith('*.')` → `name === `*.${apex}``
//                                                           → W3 RED
//   · the MAX_PAGES throw replaced by `return records`      → W9 RED
//   · the missing-token branch made `process.exitCode = 0`  → W6 RED
//   · the step moved into a job of its own (the first shape)  → W11 RED, and
//     assert-ops-register exit 1 on the real tree: "job(s) dns are the unit of
//     none of them"
//
// Run:  node --test tooling/ci/test/wildcard-dns.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  judge,
  wildcardRecords,
  readZoneRecords,
  CouldNotLook,
  PAGE_SIZE,
  MAX_PAGES,
} from '../../ops/check-wildcard-dns.mjs';
import { WILDCARD_APEX } from '../assert-catalog-reachable.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '..', '..', 'ops', 'check-wildcard-dns.mjs');

const record = (name, over = {}) => ({
  id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  name,
  type: 'CNAME',
  content: 'nikatru.com',
  proxied: true,
  ...over,
});
const APEX = 'nikatru.com';
const REAL_ZONE = [record('nikatru.com'), record('www.nikatru.com'), record('subscriptiontracker-api.nikatru.com')];

describe('check-wildcard-dns — the verdict', () => {
  test('W1 GREEN CONTROL — a zone with records and no wildcard passes, and says how many it read', () => {
    const v = judge({ apex: APEX, records: REAL_ZONE });
    assert.equal(v.code, 0);
    assert.match(v.lines.join('\n'), /no wildcard DNS record in nikatru\.com — 3 record\(s\) read from the zone itself/);
  });

  test('W2 a wildcard record is exit 1, naming the record and its id', () => {
    const v = judge({
      apex: APEX,
      records: [...REAL_ZONE, record('*.nikatru.com', { id: '01c47881398aef9a89a3d00d89dfdfc2' })],
    });
    assert.equal(v.code, 1);
    const text = v.lines.join('\n');
    assert.match(text, /A WILDCARD DNS RECORD EXISTS in nikatru\.com/);
    assert.match(text, /\*\.nikatru\.com {2}CNAME {2}-> nikatru\.com {2}\(proxied=true, id=01c47881398aef9a89a3d00d89dfdfc2\)/);
    assert.match(text, /\[ADR 080\] §4/);
  });

  test('W3 a wildcard ONE LABEL DEEPER is caught too — the property is "names nobody registered resolve"', () => {
    const v = judge({ apex: APEX, records: [...REAL_ZONE, record('*.api.nikatru.com')] });
    assert.equal(v.code, 1, 'a deeper wildcard makes unregistered names resolve just as the apex one does');
    assert.deepEqual(
      wildcardRecords([record('*.api.nikatru.com'), record('api.nikatru.com')], APEX).map((r) => r.name),
      ['*.api.nikatru.com'],
    );
  });

  test('W3b a wildcard in a DIFFERENT zone is not this zone\'s problem', () => {
    assert.deepEqual(wildcardRecords([record('*.example.com')], APEX), []);
  });

  test('W4 an EMPTY record list is COVERAGE LOST, never "no wildcard"', () => {
    // A live zone always holds records. An empty answer satisfies "no wildcard"
    // vacuously, which is the false clean this whole check exists to prevent.
    const v = judge({ apex: APEX, records: [] });
    assert.equal(v.code, 2);
    assert.match(v.lines.join('\n'), /ZERO DNS records[\s\S]*vacuously and is not a pass/);
  });

  test('W5 a non-array answer is COVERAGE LOST', () => {
    assert.equal(judge({ apex: APEX, records: null }).code, 2);
    assert.equal(judge({ apex: APEX, records: { result: [] } }).code, 2);
  });
});

describe('check-wildcard-dns — the read fails closed', () => {
  const api = (answers) => {
    const calls = [];
    const fn = async (path) => {
      calls.push(path);
      const a = answers(path, calls.length);
      if (a instanceof Error) throw a;
      return a;
    };
    fn.calls = calls;
    return fn;
  };
  const zoneOk = { result: [{ id: 'z1' }] };

  test('W7 an API refusal is COULD NOT LOOK, not an answer', async () => {
    const fn = api(() => new CouldNotLook('GET /zones answered HTTP 403: bad token'));
    await assert.rejects(() => readZoneRecords(APEX, 't', fn), (e) => e instanceof CouldNotLook);
  });

  test('W8 a zone name resolving to zero or two zones is COULD NOT LOOK', async () => {
    for (const result of [[], [{ id: 'a' }, { id: 'b' }]]) {
      await assert.rejects(
        () => readZoneRecords(APEX, 't', api(() => ({ result }))),
        (e) => {
          assert.ok(e instanceof CouldNotLook);
          assert.match(e.message, /resolved to \d+ zone\(s\); exactly one is required/);
          return true;
        },
      );
    }
  });

  test('W9 a record list longer than the page budget is COULD NOT LOOK, never "no wildcard"', async () => {
    // A truncated list with the wildcard on the page nobody read would print ok.
    const full = Array.from({ length: PAGE_SIZE }, (_, i) => record(`h${i}.nikatru.com`));
    const fn = api((path) => (path.startsWith('/zones?') ? zoneOk : { result: full }));
    await assert.rejects(
      () => readZoneRecords(APEX, 't', fn),
      (e) => {
        assert.match(e.message, /longer than \d+ records, so this run did not read it to the end/);
        return true;
      },
    );
    assert.equal(fn.calls.length, MAX_PAGES + 1, 'it must page to the budget before refusing');
  });

  test('W9b a short final page ends the paging and returns every record', async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, i) => record(`h${i}.nikatru.com`));
    const fn = api((path, n) => (path.startsWith('/zones?') ? zoneOk : n === 2 ? { result: full } : { result: [record('*.nikatru.com')] }));
    const records = await readZoneRecords(APEX, 't', fn);
    assert.equal(records.length, PAGE_SIZE + 1);
    assert.equal(judge({ apex: APEX, records }).code, 1, 'the wildcard on page two must still be found');
  });
});

describe('check-wildcard-dns — the process', () => {
  const run = (env) =>
    spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', ...env },
    });

  test('W6 no token is exit 2, and it says the zone was not read', () => {
    const r = run({});
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /CLOUDFLARE_API_TOKEN is not in the environment/);
    assert.match(r.stderr, /That is exit 2, never a pass/);
    assert.doesNotMatch(r.stdout, /ok {2}no wildcard/);
  });

  test('W10 the apex is IMPORTED from the catalogue guard, not retyped here', () => {
    // One literal, one home. A second copy could be edited on one side and go on
    // printing ok about a zone nobody owns.
    assert.equal(WILDCARD_APEX, 'nikatru.com');
    const src = spawnSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(SCRIPT)}, 'utf8'))`], { encoding: 'utf8' }).stdout;
    assert.match(src, /import \{ WILDCARD_APEX \} from '\.\.\/ci\/assert-catalog-reachable\.mjs';/);
  });

  test('W11 ops-watch runs it in a job that a duty row ALREADY claims', () => {
    // 🔴 THIS WAS THE OTHER WAY ROUND FOR ONE PUSH, AND THE TREE REFUSED IT.
    // The first shape gave the check its own `dns` job, claimed by no duty row,
    // so that a live DNS verdict could never redden a duty and refuse a deploy.
    // assert-ops-register REFUSED it, and it is right: "a failure there would be
    // watched by nobody in this register". A job outside every unit is not a
    // safe job, it is an unwatched one. So the step lives in the live-ops job,
    // which duty.workflow.ops-watch.yml already covers — and a red there is the
    // ordinary consequence of a live reader failing, exactly as it already is
    // for the GlitchTip, Supabase and GCP readers standing beside it.
    const repo = resolve(HERE, '..', '..', '..');
    const wf = readFileSync(join(repo, '.github', 'workflows', 'ops-watch.yml'), 'utf8');
    const CALL = 'node tooling/ops/check-wildcard-dns.mjs';
    assert.ok(wf.includes(CALL), 'ops-watch must run the check, or nothing enforces [ADR 080] §4');
    assert.doesNotMatch(wf, /^ {2}dns:$/m, 'it must not have a job of its own — an unclaimed job is an unwatched one');

    // WHICH job runs it is DERIVED from the workflow, never typed here: the job
    // a step belongs to is the nearest `  <id>:` header above it.
    const lines = wf.split('\n');
    const at = lines.findIndex((l) => l.includes(CALL));
    let job = null;
    for (let i = at; i >= 0; i -= 1) {
      const m = lines[i].match(/^ {2}([a-z][a-z0-9-]*):$/);
      if (m) {
        job = m[1];
        break;
      }
    }
    assert.ok(job, 'could not derive which job runs the check');

    const register = JSON.parse(readFileSync(join(repo, 'tooling', 'ops', 'register.json'), 'utf8'));
    const rows = register.rows ?? register.duties ?? [];
    assert.ok(rows.length > 0, 'the register must have rows, or this check is vacuous');
    const claiming = rows
      .filter((r) => (r.mechanism?.recordQuery?.unit?.jobs ?? []).includes(job))
      .map((r) => r.id);
    assert.ok(
      claiming.length > 0,
      `the \`${job}\` job is the unit of no duty row, so a wildcard that came back would be watched by nobody`,
    );
  });
});
