// ─────────────────────────────────────────────────────────────────────────────
// pages-deployments.test.mjs — tooling/ops/check-pages-deployments.mjs must be
// able to FAIL, and must be able to say "I could not look" as a THIRD thing.
//
// The failure this reader exists for is the one with NO OTHER OBSERVER: a
// Cloudflare Git-connected Pages build that failed, or never ran, for a commit
// that is already on `main`. It posts no commit status, opens no GitHub
// Deployment and appears in no Actions run, so the Actions page is green and the
// apex — which since [ADR 075] is the app's PUBLIC ADDRESS and the router that
// proxies it — is serving last week's bytes.
//
// The four properties worth having, each with a failing case below:
//
//   · THE PROJECT SET IS DERIVED. `sites/*` minus `_shared` for the
//     git-connected half, `catalog/apps.json` slugs for the direct-upload half.
//     A derivation that comes back EMPTY must be exit 2, not a clean sweep.
//   · A SUCCEEDED DEPLOYMENT AT THE WRONG COMMIT IS RED. This is the whole
//     point: `latest_stage.status === 'success'` alone is satisfied forever by a
//     project nobody has redeployed.
//   · `?env=production` IS A REQUEST, AND THE ANSWER IS CHECKED. A preview row
//     coming back must withhold the verdict, not grade a branch build as the apex.
//   · EXIT 2 IS NOT EXIT 1, AND IT OUTRANKS IT in the fold.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  derivePagesProjects,
  judgeProject,
  foldVerdicts,
  newestCommitTouching,
  isAncestorOf,
} from '../../ops/check-pages-deployments.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const READER_REL = 'tooling/ops/check-pages-deployments.mjs';
const WORKFLOW_REL = '.github/workflows/ops-watch.yml';

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-pd-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A tree with the two sources this reader derives from. */
function tree(name, { sites = ['nikatru', 'rajasekarselvam', '_shared'], catalogue = [{ slug: 'subscriptiontracker' }] } = {}) {
  const root = join(TMP, name);
  for (const s of sites) mkdirSync(join(root, 'sites', s), { recursive: true });
  mkdirSync(join(root, 'catalog'), { recursive: true });
  if (catalogue !== null) writeFileSync(join(root, 'catalog', 'apps.json'), JSON.stringify(catalogue));
  return root;
}

const SHA_OLD = 'a'.repeat(40);
const SHA_NEW = 'b'.repeat(40);

/** One production deployment row, shaped as the Cloudflare API returns it. */
const deployment = (over = {}) => ({
  id: 'dep-1',
  environment: 'production',
  latest_stage: { name: 'deploy', status: 'success' },
  deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_NEW } },
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('derivePagesProjects — the set is derived, and an empty derivation is exit 2', () => {
  test('git-connected projects come from sites/, minus _shared', () => {
    const { projects, problems } = derivePagesProjects(tree('derive-ok'));
    assert.deepEqual(problems, []);
    const git = projects.filter((p) => p.kind === 'git');
    assert.deepEqual(
      git.map((p) => p.project),
      ['nikatru', 'rajasekarselvam'],
      '_shared is not a site and must not be queried as a Pages project',
    );
    assert.equal(git[0].sourceDir, 'sites/nikatru', 'the project name IS the configured root directory — one reading, both uses');
  });

  test('direct-upload projects come from the catalogue, so a new app adds itself', () => {
    const root = tree('derive-two-apps', { catalogue: [{ slug: 'subscriptiontracker' }, { slug: 'newapp' }] });
    const { projects } = derivePagesProjects(root);
    assert.deepEqual(
      projects.filter((p) => p.kind === 'direct').map((p) => p.project),
      ['subscriptiontracker', 'newapp'],
    );
  });

  test('RED CONTROL — an EMPTY catalogue is a problem, not a shorter sweep', () => {
    const { problems } = derivePagesProjects(tree('derive-empty-cat', { catalogue: [] }));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /EMPTY/);
  });

  test('RED CONTROL — sites/ holding only _shared is a problem, not zero git projects', () => {
    const { problems } = derivePagesProjects(tree('derive-only-shared', { sites: ['_shared'] }));
    assert.ok(problems.some((p) => /no site directory/.test(p)));
  });

  test('RED CONTROL — an unparseable catalogue is a problem', () => {
    const root = tree('derive-bad-json', { catalogue: null });
    writeFileSync(join(root, 'catalog', 'apps.json'), '{not json');
    const { problems } = derivePagesProjects(root);
    assert.ok(problems.some((p) => /did not parse/.test(p)));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('judgeProject — the green control, then each way it goes red', () => {
  const base = { project: 'nikatru', kind: 'git', sourceDir: 'sites/nikatru', expectedCommit: SHA_NEW };

  test('GREEN CONTROL — deploy succeeded at the commit main names', () => {
    const v = judgeProject({ ...base, deployments: [deployment()] });
    assert.equal(v.code, 0);
    assert.match(v.line, /^ok /);
  });

  test('🔴 THE FAILURE WITH NO OTHER OBSERVER — success at a STALE commit is RED', () => {
    const v = judgeProject({
      ...base,
      deployments: [deployment({ deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_OLD } } })],
      // the served commit does NOT carry the one main names: genuinely behind.
      isAncestor: () => false,
    });
    assert.equal(v.code, 1, 'a succeeded deployment at the wrong commit must not read as healthy');
    assert.match(v.line, /serving commit aaaaaaa, which does NOT carry bbbbbbb/);
    assert.match(v.line, /invisible on the Actions page/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The limb below is the one that was WRONG, not missing. Cloudflare's git
  // integration builds every push to main, so "served !== expected" is the
  // NORMAL state of a healthy project and the old `!==` red-flagged it.
  // Measured 2026-09-09, ops-watch run 34379156976.
  // ───────────────────────────────────────────────────────────────────────────
  const SHA_AHEAD = 'c'.repeat(40);

  test('🔴 THE FALSE RED — serving a DESCENDANT of the named commit is GREEN, not stale', () => {
    const seen = [];
    const v = judgeProject({
      ...base,
      deployments: [deployment({ deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_AHEAD } } })],
      isAncestor: (a, b) => {
        seen.push([a, b]);
        return true;
      },
    });
    assert.equal(v.code, 0, 'a build AHEAD of the named commit already carries it and is not stale');
    assert.match(v.line, /^ok /);
    assert.match(v.line, /is AHEAD of bbbbbbb/);
    assert.deepEqual(
      seen,
      [[SHA_NEW, SHA_AHEAD]],
      'the question must be asked as isAncestor(expected, served) — reversing it inverts the verdict',
    );
  });

  test('an UNREADABLE ancestry is exit 2, never a pass — a shallow clone has not judged this', () => {
    const v = judgeProject({
      ...base,
      deployments: [deployment({ deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_AHEAD } } })],
      isAncestor: () => null,
    });
    assert.equal(v.code, 2);
    assert.match(v.line, /^\? /);
    assert.match(v.line, /could not be read from this/);
  });

  test('no injected resolver at all is exit 2 — the limb refuses to guess', () => {
    const v = judgeProject({
      ...base,
      deployments: [deployment({ deployment_trigger: { type: 'github:push', metadata: { commit_hash: SHA_AHEAD } } })],
    });
    assert.equal(v.code, 2, 'without a way to ask, the freshness question is unanswered rather than fine');
  });

  test('EQUALITY still short-circuits — the resolver is not consulted when the commits match', () => {
    let asked = 0;
    const v = judgeProject({
      ...base,
      deployments: [deployment()],
      isAncestor: () => {
        asked += 1;
        return false;
      },
    });
    assert.equal(v.code, 0);
    assert.equal(asked, 0, 'an equal commit is already the answer; asking git again is a way to get it wrong');
  });

  test('a failed build stage is RED, and the message says production serves the PREVIOUS build', () => {
    const v = judgeProject({ ...base, deployments: [deployment({ latest_stage: { name: 'build', status: 'failure' } })] });
    assert.equal(v.code, 1);
    assert.match(v.line, /stopped at stage `build` with status `failure`/);
    assert.match(v.line, /PREVIOUS build/);
  });

  test('a deploy stage still in flight is RED, not green — `success` is the only pass', () => {
    const v = judgeProject({ ...base, deployments: [deployment({ latest_stage: { name: 'deploy', status: 'active' } })] });
    assert.equal(v.code, 1);
  });

  test('no production deployment at all is RED', () => {
    const v = judgeProject({ ...base, deployments: [] });
    assert.equal(v.code, 1);
    assert.match(v.line, /NO production deployment at all/);
  });

  test('🔴 the env filter is a REQUEST — a preview row that comes back withholds the verdict', () => {
    const v = judgeProject({ ...base, deployments: [deployment({ environment: 'preview' })] });
    assert.equal(v.code, 2, 'a *.pages.dev preview must never be graded as the apex');
    assert.match(v.line, /environment filter did not hold/);
  });

  test('a git-connected project with no commit_hash is exit 2, not a pass', () => {
    const v = judgeProject({ ...base, deployments: [deployment({ deployment_trigger: { type: 'github:push', metadata: {} } })] });
    assert.equal(v.code, 2);
    assert.match(v.line, /unanswered rather than answered "fine"/);
  });

  test('an unreadable latest_stage is exit 2', () => {
    const v = judgeProject({ ...base, deployments: [deployment({ latest_stage: null })] });
    assert.equal(v.code, 2);
  });

  test('a non-array answer is exit 2', () => {
    const v = judgeProject({ ...base, deployments: null });
    assert.equal(v.code, 2);
  });

  test('a DIRECT-UPLOAD project passes on the stage alone, and says its commit limb is ungraded', () => {
    const v = judgeProject({
      project: 'subscriptiontracker',
      kind: 'direct',
      sourceDir: 'apps/subscriptiontracker',
      expectedCommit: null,
      deployments: [deployment({ deployment_trigger: { type: 'ad_hoc', metadata: {} } })],
    });
    assert.equal(v.code, 0);
    assert.match(v.line, /UNGRADED/, 'an ungraded limb must be printed, never silently skipped');
  });

  test('…and a direct-upload project whose stage FAILED is still red', () => {
    const v = judgeProject({
      project: 'subscriptiontracker',
      kind: 'direct',
      sourceDir: 'apps/subscriptiontracker',
      expectedCommit: null,
      deployments: [deployment({ deployment_trigger: { type: 'ad_hoc', metadata: {} }, latest_stage: { name: 'deploy', status: 'failure' } })],
    });
    assert.equal(v.code, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('foldVerdicts — 2 outranks 1, because an unjudged half could hold anything', () => {
  const meta = { projectsSwept: 2, ungraded: 0 };

  test('all green folds to 0', () => {
    assert.equal(foldVerdicts([{ code: 0, line: 'a' }, { code: 0, line: 'b' }], meta).code, 0);
  });

  test('one red folds to 1', () => {
    assert.equal(foldVerdicts([{ code: 0, line: 'a' }, { code: 1, line: 'b' }], meta).code, 1);
  });

  test('🔴 a red AND an unknown folds to 2, never to 1', () => {
    const v = foldVerdicts([{ code: 1, line: 'a' }, { code: 2, line: 'b' }], meta);
    assert.equal(v.code, 2);
    assert.equal(v.reds, 1);
    assert.equal(v.unknowns, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('isAncestorOf — the exit CODE is the answer, and 128 is not "no"', () => {
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);

  test('it asks `merge-base --is-ancestor` in that order', () => {
    let seen = null;
    isAncestorOf('/root', A, B, (cmd, args) => {
      seen = { cmd, args };
      return { status: 0 };
    });
    assert.equal(seen.cmd, 'git');
    assert.deepEqual(seen.args, ['merge-base', '--is-ancestor', A, B]);
  });

  test('exit 0 is true, exit 1 is false', () => {
    assert.equal(isAncestorOf('/root', A, B, () => ({ status: 0 })), true);
    assert.equal(isAncestorOf('/root', A, B, () => ({ status: 1 })), false);
  });

  test('🔴 RED CONTROL — exit 128 (the object is not in this checkout) is null, NOT false', () => {
    assert.equal(
      isAncestorOf('/root', A, B, () => ({ status: 128 })),
      null,
      'reading a missing object as "not an ancestor" turns a shallow clone into a fabricated red',
    );
  });

  test('a spawn error is null', () => {
    assert.equal(isAncestorOf('/root', A, B, () => ({ error: new Error('ENOENT') })), null);
  });

  test('a non-sha argument is null and git is never called', () => {
    let called = 0;
    const run = () => {
      called += 1;
      return { status: 0 };
    };
    assert.equal(isAncestorOf('/root', 'not-a-sha', B, run), null);
    assert.equal(isAncestorOf('/root', A, null, run), null);
    assert.equal(called, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('newestCommitTouching — an unreadable history is null, which the caller turns into exit 2', () => {
  test('it asks origin/main, not HEAD — a dispatched run from a branch must not false-alarm', () => {
    let seen = null;
    newestCommitTouching('/root', 'sites/nikatru', (cmd, args) => {
      seen = { cmd, args };
      return { status: 0, stdout: `${SHA_NEW}\n` };
    });
    assert.equal(seen.cmd, 'git');
    assert.ok(seen.args.includes('origin/main'), `expected origin/main in ${JSON.stringify(seen.args)}`);
    assert.ok(seen.args.includes('sites/nikatru'));
  });

  test('a non-zero git exit is null', () => {
    assert.equal(newestCommitTouching('/root', 'sites/nikatru', () => ({ status: 128, stdout: '' })), null);
  });

  test('RED CONTROL — output that is not a 40-hex sha is null, not a sha-shaped lie', () => {
    assert.equal(newestCommitTouching('/root', 'sites/nikatru', () => ({ status: 0, stdout: 'fatal: bad revision\n' })), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GREEN MEANS RAN. A reader nothing invokes is a reader that cannot fail, and a
// step deleted from the workflow looks identical in a run log to a step that
// passed. Same limb prod-provenance.test.mjs carries over its own step.
describe('the duty is WIRED — ops-watch.yml actually runs this reader', () => {
  test('a job in ops-watch.yml invokes it', () => {
    const wf = readFileSync(join(REPO, WORKFLOW_REL), 'utf8');
    assert.ok(
      wf.includes(`node ${READER_REL}`),
      `no job in ${WORKFLOW_REL} runs ${READER_REL}. A duty nothing invokes cannot fail, and its absence is invisible.`,
    );
  });

  test('…with the Cloudflare credential it cannot look without', () => {
    const wf = readFileSync(join(REPO, WORKFLOW_REL), 'utf8');
    const i = wf.indexOf(`node ${READER_REL}`);
    const window = wf.slice(Math.max(0, i - 1200), i);
    assert.match(window, /CLOUDFLARE_API_TOKEN/);
    assert.match(window, /CLOUDFLARE_ACCOUNT_ID/);
  });

  test('…and with a full history, because the freshness limb reads origin/main', () => {
    const wf = readFileSync(join(REPO, WORKFLOW_REL), 'utf8');
    const i = wf.indexOf(`node ${READER_REL}`);
    const window = wf.slice(Math.max(0, i - 2000), i);
    assert.match(
      window,
      /fetch-depth:\s*0/,
      'a shallow checkout has no origin/main, so newestCommitTouching returns null and every git project reports exit 2',
    );
  });
});
