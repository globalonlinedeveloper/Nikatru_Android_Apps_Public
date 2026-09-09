#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-pages-deployments.mjs — THE CLOUDFLARE PAGES BUILD IS GRADED, BY US,
// BECAUSE NOTHING ELSE GRADES IT AT ALL.
//
// ── THE MEASURED HOLE ────────────────────────────────────────────────────────
// `sites/nikatru` is a GIT-CONNECTED Pages project (sites/nikatru/README.md:
// project `nikatru`, root directory `sites/nikatru`, output `/`, no build step).
// Cloudflare deploys it on the merge push, on Cloudflare's side of the wire. It
// posts NO commit status, opens NO GitHub Deployment and appears in NO Actions
// run. So on the Actions page — the page the owner reads — a Cloudflare build
// that FAILED is indistinguishable from one that never needed to happen, and a
// project stuck on a three-week-old commit looks exactly like a quiet week.
//
// 🔴 AND THAT PROJECT IS NOT A MARKETING SITE ANY MORE. Since [ADR 075] the
// apex is the app's PUBLIC ADDRESS: `nikatru.com/<id>/` is served by
// `sites/nikatru/functions/_middleware.js` proxying the app's own Pages project.
// The router and the app are therefore TWO deployments that must both land, and
// only one of them has ever had a witness. A router stuck on the pre-[ADR 075]
// commit serves 404s at the app's address while `deploy-web.yml` is green, the
// app's own Pages project is green, and the post-deploy smoke — which fetches
// the app's origin — is green too. That is the white-page failure mode with the
// deploy lane reporting success, and it had no observer.
//
// ── WHY IT IS HERE AND NOT IN A DEPLOY LANE ─────────────────────────────────
// The Cloudflare build starts when Cloudflare notices the push, which is after
// our workflow has finished. A deploy-time check would have to poll for a build
// it cannot trigger and cannot bound. So this is a DUTY: it runs on ops-watch's
// twelve slots, where a build that has not landed by the next slot is a finding
// and not a race. ops-watch.yml is also the ONE workflow holding
// CLOUDFLARE_API_TOKEN, which is the other half of why it lives there.
//
// ── WHAT IS GRADED, AND WHAT IS DELIBERATELY NOT ────────────────────────────
//   GET /accounts/{account}/pages/projects/{project}/deployments?env=production
//
//   · `latest_stage.name === 'deploy' && latest_stage.status === 'success'` —
//     the newest PRODUCTION deployment reached the last stage and that stage
//     passed. A project whose newest production build failed is live on the
//     PREVIOUS one, which is precisely the state that looks healthy from
//     outside: the site answers 200, with last week's bytes.
//
//   · `deployment_trigger.metadata.commit_hash`, for GIT-CONNECTED projects
//     only, against the newest commit on `main` that touched the project's
//     source directory. Equal is the only passing answer. BEHIND means the
//     build for that commit never ran or never finished. AHEAD, or a hash `main`
//     does not contain, means production is serving a branch.
//
//   ⚠️ `*.pages.dev` IS NOT ASKED, ON PURPOSE. It is a different zone with its
//   own preview deployments, and `env=production` is the whole reason this query
//   is trustworthy: a green preview of a branch is not evidence about the apex,
//   and a check that accepted one would be green through the entire failure this
//   file exists for. The filter is a REQUEST, so the ANSWER is checked too —
//   every returned row's `environment` must read `production` or the verdict is
//   withheld (exit 2), the same reason classifyRunHistoryAnswer in
//   assert-ops-register.mjs re-reads `head_branch` off the response.
//
//   ⚠️ DIRECT-UPLOAD PROJECTS CARRY NO COMMIT. `wrangler pages deploy` produces
//   `deployment_trigger.type: "ad_hoc"` with no `metadata.commit_hash`, so
//   asserting a hash there would fail for the wrong reason on a good deploy and
//   be "fixed" by deleting the assertion. Their stage is graded; their commit
//   limb is declared UNGRADED and counted, so the number of ungraded projects is
//   printed rather than hidden. Their commit witness is `record-deployment.mjs`,
//   which is a different rail, read by tooling/ops/check-prod-provenance.mjs (pipeline B-17).
//
// ── THREE-VALUED, AND 2 IS NOT A PASS ───────────────────────────────────────
//   0  every derived project's newest production deployment succeeded, and every
//      git-connected one is at the commit `main` says it should be.
//   1  a project is stale, red, or serving a commit `main` does not contain.
//   2  COULD NOT LOOK — no credential, a non-200, unparseable JSON, an
//      `environment` that came back something other than `production`, or a
//      project list that derived to EMPTY. An empty sweep prints the same `ok`
//      as a complete one, which is the defect this portfolio keeps re-finding.
//
// 🔴 `process.exit()` IS BANNED IN THIS FILE, for the reason recorded in
// check-analytics-liveness.mjs: an undici keep-alive socket is still open and
// the libuv assertion aborts the process on Windows. Set `process.exitCode`.
//
// Usage:  node tooling/ops/check-pages-deployments.mjs [--root DIR]
// Env:    CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));

const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const ROOT = resolve(flag('--root') ?? join(HERE, '..', '..'));

/** Raised where the answer is "nothing was judged", never "it is fine". */
export class CouldNotLook extends Error {}

/** The directory under `sites/` that is not a site. Named once. */
const SITES_SHARED = '_shared';

/** THE PROJECT SET IS DERIVED, NEVER LISTED. A hand-written list here is a
 *  second copy of the deployment topology, and the copy is the one that rots —
 *  the same rule `deploy-web.yml`'s matrix obeys (`--emit-apps`, not a literal).
 *
 *  Two kinds, from two sources, because they are two different mechanisms:
 *
 *    GIT-CONNECTED — one per directory under `sites/` except `_shared`. These
 *      are the projects Cloudflare builds itself, and they are the ones with no
 *      witness anywhere else. `sites/<name>` is both the project name and the
 *      configured root directory (sites/nikatru/README.md), so ONE reading gives
 *      the project to query AND the path whose git history it must match.
 *
 *    DIRECT-UPLOAD — one per `catalog/apps.json` slug. `deploy-web.yml` creates
 *      and uploads `--project-name=<slug>`, so a new app adds itself here by
 *      existing rather than by anyone remembering this file.
 *
 *  Returns `{ projects, problems }`. A `problem` is a READING failure (a missing
 *  or unparseable source), which the caller turns into exit 2 — not into a
 *  shorter list. */
export function derivePagesProjects(root) {
  const projects = [];
  const problems = [];

  const sitesDir = join(root, 'sites');
  if (!existsSync(sitesDir)) {
    problems.push('sites/ does not exist, so no git-connected Pages project could be derived.');
  } else {
    const names = readdirSync(sitesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== SITES_SHARED)
      .map((d) => d.name)
      .sort();
    if (names.length === 0) {
      problems.push(`sites/ holds no site directory other than ${SITES_SHARED}/. The shape changed underneath this reader.`);
    }
    for (const name of names) projects.push({ project: name, kind: 'git', sourceDir: `sites/${name}` });
  }

  const cataloguePath = join(root, 'catalog', 'apps.json');
  if (!existsSync(cataloguePath)) {
    problems.push('catalog/apps.json does not exist, so no direct-upload Pages project could be derived.');
  } else {
    let rows;
    try {
      rows = JSON.parse(readFileSync(cataloguePath, 'utf8'));
    } catch (e) {
      problems.push(`catalog/apps.json did not parse: ${e.message}`);
      rows = null;
    }
    if (rows && !Array.isArray(rows)) {
      problems.push('catalog/apps.json is not an array. The shape changed underneath this reader.');
    } else if (rows) {
      if (rows.length === 0) {
        problems.push('catalog/apps.json is EMPTY, so the direct-upload half of this sweep would range over nothing.');
      }
      for (const r of rows) {
        if (!r || typeof r.slug !== 'string' || r.slug === '') {
          problems.push(`catalog/apps.json holds a row with no \`slug\`: ${JSON.stringify(r)}`);
          continue;
        }
        projects.push({ project: r.slug, kind: 'direct', sourceDir: `apps/${r.slug}` });
      }
    }
  }

  return { projects, problems };
}

/** PURE. ONE project's answer turned into a verdict, so every branch is
 *  reachable from a test with no network and no git — the shell/pure split the
 *  ops readers in this directory already use.
 *
 *  `expectedCommit` is the SHA `main` says this project should be serving, or
 *  `null` for a project whose commit limb is ungraded (direct upload) or whose
 *  history could not be read.
 *
 *  Returns `{ code, line }`. `code` is 0, 1 or 2 with the file-level meaning. */
export function judgeProject({ project, kind, sourceDir, deployments, expectedCommit }) {
  const at = `${project} (${kind})`;

  if (!Array.isArray(deployments)) {
    return { code: 2, line: `?   ${at} — the deployments answer was not an array, so NOTHING was judged.` };
  }
  if (deployments.length === 0) {
    return {
      code: 1,
      line:
        `✗   ${at} — the project has NO production deployment at all. Either it has never published, ` +
        `or its deployments were purged. Nothing is serving what this repository built.`,
    };
  }

  // 🔴 THE FILTER IS THE REQUEST; THIS IS THE ANSWER, CHECKED. `?env=production`
  // silently ignored by a future API version would hand us preview rows and this
  // guard would grade a branch build as the apex with nothing to notice.
  const foreign = deployments.filter((d) => d?.environment !== 'production');
  if (foreign.length > 0) {
    return {
      code: 2,
      line:
        `?   ${at} — the API answered with ${foreign.length} row(s) whose \`environment\` is ` +
        `${JSON.stringify(foreign[0]?.environment ?? null)} for a query that asked for \`production\`. ` +
        `The environment filter did not hold, so no verdict about production is available.`,
    };
  }

  const newest = deployments[0];
  const stage = newest?.latest_stage;
  if (!stage || typeof stage.name !== 'string' || typeof stage.status !== 'string') {
    return {
      code: 2,
      line: `?   ${at} — the newest production deployment carries no readable \`latest_stage\`, so NOTHING was judged.`,
    };
  }

  const short = (h) => (typeof h === 'string' ? h.slice(0, 7) : String(h));
  const id = newest.id ?? '(no id)';

  if (stage.name !== 'deploy' || stage.status !== 'success') {
    return {
      code: 1,
      line:
        `✗   ${at} — the newest production deployment ${id} stopped at stage \`${stage.name}\` with status ` +
        `\`${stage.status}\`. Production is therefore still serving the PREVIOUS build, which answers 200 with ` +
        `older bytes — the state that looks healthy from outside. Cloudflare posts no commit status for this ` +
        `build, so this line is the only place it is ever reported.`,
    };
  }

  const trigger = newest.deployment_trigger ?? {};
  const served = trigger?.metadata?.commit_hash ?? null;

  if (expectedCommit === null) {
    return {
      code: 0,
      line:
        `ok  ${at} — deployment ${id} succeeded at stage \`deploy\`; commit limb UNGRADED ` +
        `(trigger \`${trigger.type ?? 'unknown'}\` carries no commit_hash, which is correct for a direct upload; ` +
        `its commit witness is record-deployment.mjs, read by check-prod-provenance.mjs on the pipeline B-17 rail).`,
    };
  }

  if (typeof served !== 'string' || served === '') {
    return {
      code: 2,
      line:
        `?   ${at} — deployment ${id} succeeded, but \`deployment_trigger.metadata.commit_hash\` is ` +
        `${JSON.stringify(served)} on a GIT-CONNECTED project. Nothing identifies WHICH commit is live, so the ` +
        `freshness question is unanswered rather than answered "fine".`,
    };
  }

  if (served !== expectedCommit) {
    return {
      code: 1,
      line:
        `✗   ${at} — deployment ${id} succeeded, but it is serving commit ${short(served)} while the newest ` +
        `commit on \`main\` touching ${sourceDir} is ${short(expectedCommit)}. The Cloudflare build for ` +
        `${short(expectedCommit)} never ran or never finished. This is invisible on the Actions page by ` +
        `construction: the build happens on Cloudflare's side of the wire and posts no status here.`,
    };
  }

  return {
    code: 0,
    line: `ok  ${at} — deployment ${id} succeeded at stage \`deploy\`, serving ${short(served)}, the newest \`main\` commit touching ${sourceDir}.`,
  };
}

/** PURE. The whole sweep's verdict from the per-project ones. The WORST code
 *  wins and 2 outranks 1: "some of it was not judged" is a strictly worse state
 *  than "one of the things I did judge is broken", because the unjudged half
 *  could hold anything. */
export function foldVerdicts(results, { projectsSwept, ungraded }) {
  const code = results.reduce((worst, r) => (r.code === 2 || worst === 2 ? 2 : Math.max(worst, r.code)), 0);
  const lines = results.map((r) => r.line);
  const reds = results.filter((r) => r.code === 1).length;
  const unknowns = results.filter((r) => r.code === 2).length;
  return { code, lines, reds, unknowns, projectsSwept, ungraded };
}

/** The newest commit on `main` that touched a path. `null` when the history is
 *  unreadable — which the caller must turn into exit 2, never into a pass.
 *
 *  ⚠️ `origin/main`, NOT `HEAD`. ops-watch runs on a schedule and its checkout is
 *  main, but a dispatched run from a branch would otherwise compare Cloudflare's
 *  production build against a branch tip and report a false red. */
export function newestCommitTouching(root, path, run = spawnSync) {
  const r = run('git', ['log', '-1', '--format=%H', 'origin/main', '--', path], {
    cwd: root,
    encoding: 'utf8',
  });
  if (r.error || r.status !== 0) return null;
  const sha = (r.stdout ?? '').trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

const CF_API = 'https://api.cloudflare.com/client/v4';

async function readDeployments(project) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    throw new CouldNotLook('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not both in the environment');
  }
  const url = `${CF_API}/accounts/${account}/pages/projects/${encodeURIComponent(project)}/deployments?env=production&per_page=1`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) {
    throw new CouldNotLook(`GET pages/projects/${project}/deployments answered HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new CouldNotLook(`GET pages/projects/${project}/deployments answered unparseable JSON: ${text.slice(0, 200)}`);
  }
  if (body?.success !== true) {
    throw new CouldNotLook(`Cloudflare reported success=false for ${project}: ${JSON.stringify(body?.errors ?? null).slice(0, 400)}`);
  }
  return body.result;
}

async function main() {
  const { projects, problems } = derivePagesProjects(ROOT);

  if (problems.length > 0 || projects.length === 0) {
    console.error('✗ COULD NOT LOOK — the Pages project set did not derive, so NOTHING was swept:');
    for (const p of problems) console.error(`    ${p}`);
    if (projects.length === 0) console.error('    the derived project set is EMPTY, which prints the same ok as a complete sweep.');
    process.exitCode = 2;
    return;
  }

  const results = [];
  let ungraded = 0;

  for (const p of projects) {
    let expectedCommit = null;
    if (p.kind === 'git') {
      expectedCommit = newestCommitTouching(ROOT, p.sourceDir, spawnSync);
      if (expectedCommit === null) {
        results.push({
          code: 2,
          line:
            `?   ${p.project} (git) — \`git log origin/main -- ${p.sourceDir}\` produced no commit. The history is ` +
            `unreadable here (a shallow clone has no origin/main), so the freshness limb was NOT executed.`,
        });
        continue;
      }
    } else {
      ungraded += 1;
    }

    try {
      const deployments = await readDeployments(p.project);
      results.push(judgeProject({ ...p, deployments, expectedCommit }));
    } catch (e) {
      results.push({
        code: 2,
        line: `?   ${p.project} (${p.kind}) — ${e instanceof CouldNotLook ? e.message : `${e.name}: ${e.message}`}`,
      });
    }
  }

  const verdict = foldVerdicts(results, { projectsSwept: projects.length, ungraded });

  console.log(
    `⬜  MONITOR · Cloudflare Pages production deployments · ${verdict.projectsSwept} project(s) DERIVED ` +
      `(${verdict.projectsSwept - verdict.ungraded} commit-graded, ${verdict.ungraded} direct-upload with the commit limb ungraded)`,
  );
  for (const line of verdict.lines) console.log(`    ${line}`);

  if (verdict.code === 0) {
    console.log(`ok  every derived Pages project's newest PRODUCTION deployment succeeded and is at the commit main names.`);
  } else {
    console.error('');
    console.error(
      `✗ ${verdict.reds} project(s) RED, ${verdict.unknowns} NOT JUDGED. A Cloudflare Git build posts no commit ` +
        `status, opens no GitHub Deployment and appears in no Actions run, so this reader is the only observer it has.`,
    );
  }
  process.exitCode = verdict.code;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
