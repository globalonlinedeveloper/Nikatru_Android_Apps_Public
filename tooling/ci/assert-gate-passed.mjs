#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-gate-passed.mjs — no commit deploys unless the gate passed on IT.
//
// Deploy workflows trigger on `push: branches:[main]` with no dependency on CI,
// so the deploy and the tests start at the same instant and the deploy finishes
// first (~3 min vs ~6). Nothing ever asked the gate for its verdict. The manual
// `workflow_dispatch` "redeploy / rollback button" consulted nothing at all —
// and that is the button you press when something is already wrong.
//
// This POLLS rather than reads once, precisely because at deploy time `ci-gate`
// is usually still running. It FAILS CLOSED: unknown, timed out, cancelled or
// absent all exit non-zero. A deploy blocked by a slow API is recoverable; a
// deploy that shipped an unverified commit to production is not.
//
// ⚠️ NEVER call `process.exit()` in this file. Exiting while a fetch handle is
// still closing aborts Node on Windows with
//   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)
// and returns 127 for BOTH outcomes — which in a fail-closed check silently
// blocks every deploy, including the ones that passed. Found by negative-testing
// this script before wiring it up. Set `process.exitCode` and return instead.
//
// Pipeline requirement: Private/requirements/ → F-5b.
// (Stage 1's prose, pipeline/01-foundation.md, was folded into that JSON spec
// 2026-08-15; the id still resolves against an `origin` field there.)
//
// Usage:  node tooling/ci/assert-gate-passed.mjs <sha> [--timeout-seconds N]
//   env:  GITHUB_TOKEN (or GH_TOKEN), GITHUB_REPOSITORY (owner/repo)
//         GITHUB_API_URL — the real origin or loopback only (a test seam; see
//         `githubApiBase` in record-deployment.mjs)
// Exit 0 = the gate passed for this exact SHA. 1 = anything else.
//
// ── ⏱ APPENDED 2026-09-11 — EXIT 2, AND A RATE LIMIT IS NOT A TIMEOUT ────────
// The exit line above is left as written; this is the correction. Exit codes now
// follow the house rule C-COVERAGE-LOST-IS-NOT-PASS (platform-state/constraints.json):
//   0 = ci-gate was READ for this exact SHA and concluded success.
//   1 = anything else that was READ, or a precondition: ci-gate concluded
//       non-success, never appeared before the timeout, a missing SHA/token,
//       or a 401/403 PERMISSION answer.
//   2 = ci-gate was NOT READ — the GitHub API rate limit outlasted the bound.
//       Still non-zero, still no deploy; it only lets a reader tell "could not
//       ask" from "asked, and the answer was no".
//
// Until today every non-2xx here was re-asked on the 15-second poll until the
// 20-minute deadline, then reported as `timed out … (last seen: not started)`.
// Two things were wrong in that:
//   · a drained installation quota (run 34570837376's recorder hit exactly that,
//     on the same shared installation) was re-asked every 15 s — against
//     GitHub's documented instruction to wait for `retry-after` /
//     `x-ratelimit-reset` — and then filed as a TIMEOUT, which reads as "CI never
//     ran for this commit";
//   · a 401, or a 403 such as "Resource not accessible by integration", is a
//     permission ANSWER that no amount of polling changes, and it burned twenty
//     minutes of runner before saying so.
// Now the classification and the wait are the ONE implementation in
// record-deployment.mjs (`classifyRefusal`, `planRateLimitWait` — GitHub's
// rate-limit docs and the 10-minute bound are cited there), bounded by BOTH that
// budget and this script's own --timeout-seconds; a limit that outlasts either
// exits 2 with "could not read ci-gate", and a permission answer exits 1 on the
// first response. Imported, not copied: the two scripts spend one installation
// quota and must not disagree about what a rate limit is.
//
// ⚠️ FAIL-CLOSED IS UNCHANGED, AND THIS IS NOT A WAIVER. There is still exactly
// one `return` without a non-zero exitCode: a ci-gate check run that was read
// and concluded `success`.
//
// ── ⏱ APPENDED 2026-09-11 (second) — NO REQUEST FASTER THAN ci-gate CAN EXIST ──
// A deploy lane starts at push time beside CI, and ci-gate's check run is only
// created once every job it needs has finished, about five minutes in. Polling
// every 15 s from the first second, deploy-web's gate step answered "no ci-gate
// check on this commit yet" on 19 of its 20 polls on 2026-09-11: 20-24 requests
// per lane per push, out of the installation quota whose exhaustion failed every
// CI run started at 06:42Z and from 08:09Z to 08:15Z.
// Now a poll that finds NO check run waits 15 s, then 30 s, then 60 s for every
// one after (`absentWaitSeconds`). The first poll is still made at once, because
// the redeploy button's ci-gate usually exists already. Once the check run exists,
// and after a transient error, the wait is 15 s again. Every wait is clamped to
// the deadline and the poll it ends on is still made, so the watch covers the
// whole timeout and never overruns it. MEASURED under a virtual clock, the real
// script before and after (test/github-rate-limit.test.mjs holds the same cases):
//   ci-gate appears at 290 s, passes at 320 s  → 23 requests before, 8 after
//   ci-gate appears at 285 s, passes at 300 s  → 21 before, 8 after
//   ci-gate already green (the redeploy button) → 1 before, 1 after
//   ci-gate never appears, 1200 s default       → 80 before, 23 after
// The worst added latency is one back-off step, 60 s, and only before the check
// run exists. The rate-limit and permission contract above is untouched: a rate
// limit still waits as GitHub asks and exits 2 past its bound, and a 401 or a
// 403 without a rate-limit signal still exits 1 on the first response.
// ─────────────────────────────────────────────────────────────────────────────
import {
  classifyRefusal,
  planRateLimitWait,
  githubApiBase,
  limitName,
  formatWait,
  RATE_LIMIT_BUDGET_MS,
  RATE_LIMIT_MAX_RETRIES,
} from './record-deployment.mjs';

/** The required check. Verified against the live check-run list before this was
 *  wired up: a wrong name here would block every deploy forever while looking
 *  like a legitimate failure. It must match `ci.yml` → job `ci-gate` → `name:`. */
const GATE = 'ci-gate';

const POLL_SECONDS = 15;

/** ⏱ 2026-09-11 — the wait after a poll that found NO ci-gate check run yet, by
 *  how many such polls in a row there have been: 15 s, then 30 s, then 60 s for
 *  every one after. See the header block of the same date. Once the check run
 *  exists, and after any transient error, the wait is `POLL_SECONDS` again. */
const ABSENT_BACKOFF_SECONDS = [15, 30, 60];
const absentWaitSeconds = (absentPolls) =>
  ABSENT_BACKOFF_SECONDS[Math.min(Math.max(absentPolls, 1), ABSENT_BACKOFF_SECONDS.length) - 1];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg, hint) {
  console.error(`✗ ${msg}`);
  if (hint) console.error(`  ${hint}`);
  process.exitCode = 1;
}

/** Exit 2 — ci-gate was NOT READ. Never 0: nothing on this path lets a deploy
 *  proceed. Never 1: that says ci-gate was read and the answer was no. */
function unread(lines) {
  console.error(`✗ could not read ci-gate: ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  console.error(
    '  Refusing to deploy (exit 2). This is NOT "ci-gate failed" and NOT "ci-gate passed" — the question went ' +
      'unanswered on this runner. An installation quota refills within the hour; re-run the job then and edit nothing.',
  );
  process.exitCode = 2;
}

async function fetchGate(base, repo, sha, token, secondaryStrikes) {
  const url = `${base}/repos/${repo}/commits/${sha}/check-runs?per_page=100`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'nikatru-assert-gate-passed',
      },
    });
  } catch (err) {
    // Network blip — retry rather than reading it as "no gate" either way.
    return { transient: true, status: String(err?.message ?? err), run: null, refusal: null, text: '' };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const refusal = classifyRefusal({ status: res.status, headers: res.headers, bodyText: text, secondaryStrikes });
    return { transient: true, status: res.status, run: null, refusal, text: text.slice(0, 300) };
  }
  const body = await res.json();
  const run = (body.check_runs ?? []).find((c) => c.name === GATE) ?? null;
  return { transient: false, status: res.status, run, refusal: null, text: '' };
}

async function main() {
  const args = process.argv.slice(2);
  const timeoutIdx = args.indexOf('--timeout-seconds');
  const timeoutSeconds = timeoutIdx >= 0 ? Number(args[timeoutIdx + 1]) : 1200;
  // Skip the flag AND its value, else `--timeout-seconds 10` with no SHA parses
  // "10" as the commit and reports a confusing timeout instead of "no SHA given".
  // ⚠️ Guard the -1: `indexOf` returns -1 when the flag is ABSENT, and -1 + 1 = 0
  // would then discard argv[0] — the SHA — on the exact invocation CI uses.
  // That shipped once and failed both deploys; it was not caught locally because
  // every local test passed the flag. Always test the no-flag form too.
  const skipIdx = timeoutIdx >= 0 ? timeoutIdx + 1 : -1;
  const positional = args.filter((a, i) => !a.startsWith('--') && i !== skipIdx);
  const sha = positional[0];

  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  if (!sha) return fail('no commit SHA given', 'usage: assert-gate-passed.mjs <sha>');
  if (!repo) return fail('GITHUB_REPOSITORY is not set');
  if (!token) return fail('GITHUB_TOKEN / GH_TOKEN is not set', 'the job needs `permissions: checks: read`');
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    return fail('--timeout-seconds must be a positive number');
  }
  const api = githubApiBase();
  if (api.error) return fail(api.error);
  if (api.override) console.log(`⬜ GITHUB_API_URL override in effect: ${api.base} — a LOOPBACK TEST SEAM, not GitHub.`);

  console.log(`waiting for "${GATE}" on ${sha.slice(0, 8)} (timeout ${timeoutSeconds}s)`);

  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastSeen = 'not started';
  // The CURRENT run of consecutive rate-limit refusals. Any response that is
  // read (or is anything other than a rate limit) ends the run and resets it.
  let rl = null;
  // ⏱ 2026-09-11 — consecutive polls that found no ci-gate check run at all.
  // Any poll that shows the check run resets it; see `absentWaitSeconds`.
  let absentPolls = 0;

  // `for (;;)` and not `while (Date.now() < deadline)`: the wait at the bottom is
  // clamped to the deadline and the poll it ends on is the last one made, so a
  // 60-second back-off cannot end the watch up to a minute before the timeout.
  // The first poll is still made at once — the redeploy button's ci-gate
  // usually exists already, and waiting before asking would only delay it.
  for (;;) {
    const { transient, status, run, refusal, text } = await fetchGate(api.base, repo, sha, token, rl?.secondaryStrikes ?? 0);

    if (refusal?.kind === 'rate-limit') {
      const now = Date.now();
      rl ??= { budgetEnds: now + RATE_LIMIT_BUDGET_MS, retries: 0, secondaryStrikes: 0 };
      rl.last = { status, refusal, text };
      const plan = planRateLimitWait({ refusal, now, deadline: Math.min(rl.budgetEnds, deadline), retriesSoFar: rl.retries });
      if (plan.giveUp) {
        return unread([
          `${limitName(refusal)} (HTTP ${status}, ${refusal.signal})`,
          `${plan.why}; the bound is ${RATE_LIMIT_BUDGET_MS / 60_000} minutes or this check's own ${timeoutSeconds}s timeout, whichever ends first.`,
          `Last response: ${status} ${text}`,
        ]);
      }
      rl.retries++;
      if (refusal.limit === 'secondary') rl.secondaryStrikes++;
      console.log(
        `  … github api answered ${status}: ${limitName(refusal)} (${refusal.signal}) — waiting ${formatWait(plan.waitMs)} ` +
          `as GitHub asks (rate-limit retry ${rl.retries} of at most ${RATE_LIMIT_MAX_RETRIES})`,
      );
      await sleep(plan.waitMs);
      if (Date.now() >= deadline) break;
      continue;
    }
    rl = null;
    let nextPollSeconds = POLL_SECONDS;

    if (refusal?.kind === 'answer' && (status === 401 || status === 403)) {
      // A permission ANSWER. Polling cannot change it, so do not spend the
      // deadline re-asking; refuse now, exit 1.
      return fail(
        `github api answered ${status} for the check runs on ${sha.slice(0, 8)} — a permission answer, not a rate limit; refusing to deploy`,
        `${text} — the job needs \`permissions: checks: read\` and a token that can read this repository.`,
      );
    }

    if (transient) {
      console.log(`  … github api returned ${status}, retrying`);
    } else if (!run) {
      lastSeen = 'not started';
      absentPolls++;
      nextPollSeconds = absentWaitSeconds(absentPolls);
      console.log(`  … no ci-gate check on this commit yet (next look in ${nextPollSeconds}s)`);
    } else if (run.status !== 'completed') {
      lastSeen = run.status;
      absentPolls = 0;
      console.log(`  … ci-gate is ${run.status}`);
    } else if (run.conclusion === 'success') {
      console.log(`ok  ci-gate passed for ${sha.slice(0, 8)} — deploy may proceed`);
      return;
    } else {
      // Completed and not success: decided, and the answer is no. Do not wait.
      return fail(
        `ci-gate concluded "${run.conclusion}" for ${sha.slice(0, 8)} — refusing to deploy`,
        run.html_url ?? '',
      );
    }

    const left = deadline - Date.now();
    if (left <= 0) break;
    await sleep(Math.min(nextPollSeconds * 1000, left));
  }

  if (rl !== null) {
    // The deadline ran out while GitHub was still refusing to be asked. That is
    // not "timed out waiting for ci-gate" — ci-gate was never read.
    return unread([
      `${limitName(rl.last.refusal)} (HTTP ${rl.last.status}, ${rl.last.refusal.signal})`,
      `still rate-limited when this check's ${timeoutSeconds}s timeout ran out, after ${rl.retries} rate-limit retr${rl.retries === 1 ? 'y' : 'ies'}.`,
      `Last response: ${rl.last.status} ${rl.last.text}`,
    ]);
  }

  return fail(
    `timed out after ${timeoutSeconds}s waiting for "${GATE}" on ${sha.slice(0, 8)} (last seen: ${lastSeen})`,
    'Failing closed. If CI genuinely does not run for this commit, that is the bug — not this check.',
  );
}

await main();
