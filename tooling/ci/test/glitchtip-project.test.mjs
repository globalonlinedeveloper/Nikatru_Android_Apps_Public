// ─────────────────────────────────────────────────────────────────────────────
// glitchtip-project.test.mjs — assert-glitchtip-project.mjs must be able to FAIL,
// and must fail on the three shapes that actually occurred.
//
// The guard holds one rule: every GlitchTip `--project` argument in
// .github/workflows names the SAME project and is a LITERAL, never derived from
// a path in this repository.
//
// ⚠️ REAL-TREE NEGATIVE CONTROL FIRST, THEN FIXTURES. R1 below is not invented.
// It is `origin/main` at a7b92d8e — the tree as it stood before this change —
// extracted to a directory and handed to the guard. That tree carried BOTH
// defects at once: five derived call sites (`--project "$APP"`,
// `--project "${env:APP}"`) and seven literals still spelling the retired slug.
// A fixture the test author wrote would encode the same misunderstanding as the
// guard the test author wrote; the pre-fix tree cannot, because it predates
// both. Results, each exit code captured on its OWN LINE, never after a pipe and
// never after a trailing echo:
//   G   the repaired tree (the real .github/workflows)  -> exit 0, 12 call sites
//   R1  origin/main's workflows, unmodified             -> exit 1, named all five
//                                                          derived sites
//   R2  a workflow directory with no GlitchTip call at all
//                                                       -> exit 1 COVERAGE LOST
//   R3  one file reverted to `--project subly`          -> exit 1, named both
//                                                          spellings
//
// 🔴 THE POSITIVE CONTROL IS NOT OPTIONAL. Without a case that runs the guard
// against the REAL .github/workflows and demands exit 0, every refusal below is
// equally consistent with a guard that refuses everything it is shown.
//
// ── WHY THIS TEST SPELLS `subly` AND THE GUARD DOES NOT ──────────────────────
// The guard carries no project name — it asserts agreement, not a value, so it
// survives the next rename untouched. This file spells the RETIRED name on
// purpose, in a fixture, because the drift it reproduces is historical and
// frozen: the pair (`subly`, `subscriptiontracker`) is the 2026-09-09 event and
// stops being interesting the moment either name moves again.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-glitchtip-project.mjs');
const WORKFLOWS = join(REPO, '.github', 'workflows');

/** Run the guard. The exit code is read from the returned object on its own
 *  line — never through a pipe, and never after a trailing command, both of
 *  which report the LAST thing that ran rather than the guard. */
function run(dir) {
  const r = spawnSync(process.execPath, [GUARD, '--workflows', dir], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'glitchtip-project-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A workflow directory built from the REAL files, optionally mutated. */
function stage(name, mutate = null) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n))) {
    let body = readFileSync(join(WORKFLOWS, f), 'utf8');
    if (mutate) body = mutate(f, body);
    writeFileSync(join(dir, f), body);
  }
  return dir;
}

describe('the repaired tree passes', () => {
  test('G — the real .github/workflows: exit 0, and every call site is named', () => {
    const r = run(WORKFLOWS);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /all naming the literal project/);
    // The count is asserted as a FLOOR, not an equality: a new lane that uploads
    // symbols must not fail this test, but a rewrite that deletes every call
    // site must not pass it either. Twelve on 2026-09-09.
    const named = r.out.split('\n').filter((l) => /^\s+\S+\.ya?ml:\d+$/.test(l));
    assert.ok(named.length >= 12, `only ${named.length} call site(s) named:\n${r.out}`);
  });
});

describe('a derived project name is refused', () => {
  test('R3 — `--project "$APP"` in one lane: exit 1, and the line is quoted back', () => {
    const dir = stage('derived', (f, body) =>
      f === 'build-platforms.yml'
        ? body.replace('--org nikatru --project subscriptiontracker', '--org nikatru --project "$APP"')
        : body,
    );
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /DERIVED, not literal/);
    assert.match(r.out, /--project "\$APP"/);
  });

  test('R3b — a `${{ matrix.app }}` expression is refused the same way', () => {
    const dir = stage('expr', (f, body) =>
      f === 'submit-play.yml'
        ? body.replace('--org nikatru --project subscriptiontracker', '--org nikatru --project ${{ matrix.app }}')
        : body,
    );
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /DERIVED, not literal/);
  });
});

describe('two spellings are refused', () => {
  test('R3c — one file left on the retired slug: exit 1, and BOTH names are printed', () => {
    const dir = stage('drift', (f, body) =>
      f === 'submit-snap.yml' ? body.replaceAll('--project subscriptiontracker', '--project subly') : body,
    );
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /different GlitchTip projects/);
    assert.match(r.out, /subly/);
    assert.match(r.out, /subscriptiontracker/);
  });
});

describe('no call sites is COVERAGE LOST, never a pass', () => {
  test('R2 — a workflow directory with the flag renamed away: exit 1', () => {
    const dir = stage('renamed-flag', (f, body) => body.replaceAll('--project ', '--gtproject '));
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /ZERO GlitchTip --project call sites/);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('an empty directory is also exit 1, not a silent pass', () => {
    const dir = join(TMP, 'empty');
    mkdirSync(dir, { recursive: true });
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /ZERO GlitchTip --project call sites/);
  });
});

describe('the boundary against Cloudflare Pages is deliberate', () => {
  test('`--project-name=` is a Pages project and is NOT read as a GlitchTip one', () => {
    // deploy-web.yml carries `pages deploy --project-name=${{ matrix.app }}`,
    // which IS derived from the app slug and is CORRECT that way: the Pages
    // project is one per app. Reading it as a GlitchTip call site would make
    // this guard demand a change that would break the deployment.
    const dir = stage('pages-boundary');
    const r = run(dir);
    assert.equal(r.code, 0, r.out);
    assert.ok(
      readFileSync(join(WORKFLOWS, 'deploy-web.yml'), 'utf8').includes('--project-name='),
      'deploy-web.yml no longer carries --project-name=; this boundary case has stopped testing anything.',
    );
  });
});

describe('--live refuses to report a pass it did not make', () => {
  test('with no GLITCHTIP_TOKEN, --live is exit 1 and names the secret', () => {
    const env = { ...process.env };
    delete env.GLITCHTIP_TOKEN;
    const r = spawnSync(process.execPath, [GUARD, '--live'], { encoding: 'utf8', env });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(`${r.stdout}${r.stderr}`, /GLITCHTIP_TOKEN/);
  });
});

describe('an unknown flag is exit 2, never a quiet default', () => {
  test('--nope: exit 2', () => {
    const r = spawnSync(process.execPath, [GUARD, '--nope'], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  });
});

describe('the guard is reachable from CI', () => {
  test('ci.yml invokes it', () => {
    const ci = readFileSync(join(WORKFLOWS, 'ci.yml'), 'utf8');
    assert.ok(
      ci.includes('tooling/ci/assert-glitchtip-project.mjs'),
      'assert-glitchtip-project.mjs is not invoked by ci.yml — an unwired guard is not a guard.',
    );
  });
  test('the enforcement index carries it as WIRED', () => {
    const idx = JSON.parse(readFileSync(join(REPO, 'tooling', 'enforcement-index.json'), 'utf8'));
    const rows = Array.isArray(idx) ? idx : idx.entries ?? [];
    const row = rows.find((e) => e.ref === 'tooling/ci/assert-glitchtip-project.mjs');
    assert.ok(row, 'no enforcement-index row for assert-glitchtip-project.mjs');
    assert.equal(row.state, 'WIRED');
  });
});

test('the guard file exists where the index says it does', () => {
  assert.ok(existsSync(GUARD));
});
