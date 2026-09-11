#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// triage-failed-runs.mjs — EVERY non-green Actions run, accounted for, with the
// count that could NOT be accounted for printed as its own final line.
//
// 🔴 THE QUESTION IT ANSWERS, VERBATIM FROM THE OWNER ON 2026-09-10: "I have
// seen more than 50+ workflow failed, how we can check everything covered and
// we did not missed anything?" The sweeps of the two days before had read the
// last 60–100 runs and grouped what they saw. That is a SAMPLE. A sample can
// only say "the ones I looked at are explained"; it cannot say "nothing was
// missed", because the runs it did not look at are exactly the ones it cannot
// speak for. The answer to "did we miss anything" is a LEDGER — every non-green
// run the API will hand over, each one assigned to a group with a cited root
// cause, a cited fix, and a cited later-green — and the number of runs that
// could NOT be assigned, printed last, on its own line, driving the exit code.
//
// ── WHAT ONE ROW IS ─────────────────────────────────────────────────────────
//   run id · workflow · branch · conclusion · the FAILING JOB · the FAILING STEP
//   · the FIRST ERROR LINE of that step's log · a SIGNATURE derived from the
//   error (never from the job name — see below) · the verdict of the NEWEST run
//   of that same workflow on that same branch · whether the branch still exists.
//
// ── WHAT "EXPLAINED" MEANS, AND IT IS A CONJUNCTION ─────────────────────────
//   (a) the row's signature has an entry in tooling/ops/failed-run-causes.json
//       naming a root cause and a fix (a merged SHA/PR, "infrastructure,
//       self-cleared", "superseded: branch merged/deleted", or "lost race
//       under strict protection"), AND
//   (b) the newest run of that workflow on that branch is GREEN (cited by run
//       id and timestamp), OR the branch no longer exists (cited, with its PR
//       when one can be found).
//   Either half missing = UNEXPLAINED. A cause with no later green is an OPEN
//   defect; a later green with no cause is a fix nobody can name.
//
// ── 🔴 SIGNATURE FROM THE LOG, NEVER FROM THE JOB NAME ───────────────────────
//   `ci-gate`'s "Require all lanes green" was red 95 times in the first 160
//   runs read while writing this. It is red because SOMETHING ELSE was red. A
//   ledger keyed on the aggregator would have one group called "CI failed" and
//   explain nothing; so aggregator jobs (GATE_STEP below) are dropped whenever
//   another job in the same run failed, and only when they are the ONLY red job
//   does the row carry the `gate-only` signature ("a lane was cancelled or
//   never ran").
//
//   Likewise a `✗ tooling/ops/register.json — 2 problem(s):` header is not a
//   signature — the problem is on the NEXT indented line. So the error block
//   handed to the classifier is the first error line PLUS the lines after it,
//   and the patterns in SIGNATURES read the block, most specific first.
//
// ── CANCELLED RUNS ──────────────────────────────────────────────────────────
//   GitHub's job log for a cancelled run says only `##[error]The operation was
//   canceled.` — it never says by whom. The one thing the API does show is
//   WHETHER A NEWER RUN OF THE SAME WORKFLOW ON THE SAME REF WAS CREATED WHILE
//   THIS ONE WAS STILL RUNNING. That is what `cancel-in-progress` does, so it is
//   the signature `cancelled:superseded-in-group`; a cancelled run with no such
//   successor is `cancelled:by-hand-or-unknown`.
//
// ── EXIT CONTRACT ───────────────────────────────────────────────────────────
//   0 = every non-green run enumerated is explained (UNEXPLAINED: 0).
//   1 = UNEXPLAINED: N with N > 0 — the individual rows are printed above it.
//   2 = COVERAGE LOST — a 403 (the shared installation quota, measured
//       exhausted on 2026-09-09), a paged list that stopped short of
//       `total_count`, a job log that could not be read, or no credential.
//       NEVER readable as a pass: a ledger over a subset says nothing about
//       the rest.
//
// ⚠️ A READER, NOT A GATE. This does not run in ci.yml and must not: it costs
// one API call per run plus one per failed job, and the shared quota is the
// very thing that made 2026-09-09 red. Run it from a workstation, where `gh`'s
// identity is separate from the installation token.
//
// ⚠️ NO `process.exit()` ONCE A `fetch` HAS BEEN MADE — an open undici handle
// crashes libuv on Windows and returns 127 for BOTH outcomes. `process.exitCode`
// + return, as await-pr-checks.mjs does.
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//   node tooling/ops/triage-failed-runs.mjs [--repo owner/name] [--since ISO]
//        [--until ISO] [--cache-dir DIR] [--fixture-dir DIR] [--no-prs]
//        [--json FILE]
//
//   --since ISO      only runs created at/after this instant. Without it, ALL
//                    of them — and if GitHub's per-list ceiling (1000) cuts the
//                    enumeration short, that is exit 2, printed.
//   --until ISO      only runs created at/before this instant — a bounded
//                    window is what makes a ledger reproducible tomorrow, when
//                    today's in-flight PRs have added runs the report never saw.
//   --cache-dir DIR  jobs, logs, newest-run and PR lookups are immutable once a
//                    run has completed; cache them here so a second pass costs
//                    no quota. Never caches the run LIST itself.
//   --fixture-dir DIR offline: `runs.json` (REST shape), `<id>.jobs.json`,
//                    `<id>.job-<jobId>.log`, `newest.json` ({"<path>|<branch>":
//                    run}), `between-<id>.json` (runs of the same workflow+ref
//                    created while <id> lived), `branches.json` ([names]),
//                    `prs.json` ({"<branch>": pr}), `capped.json` ([notes]).
//                    No network path at all.
//   --no-prs         skip the per-deleted-branch PR lookup (saves one call per
//                    branch; the proof line then says "branch deleted" only).
//   --json FILE      also write every row and group to FILE.
//
//   Credential: GH_TOKEN / GITHUB_TOKEN, else the local vault key
//   `Project_Cross_Platform_Apps_GITHUB_PAT` via safe-rerun.mjs's `token()`.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { token } from './safe-rerun.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const API = 'https://api.github.com';
export const CAUSES_REL = 'tooling/ops/failed-run-causes.json';

/** Conclusions this ledger ranges over. `skipped`, `neutral`, `success` and a
 *  null (still running) are not failures; `action_required` and `stale` are
 *  not produced by this repository's workflows and would surface as
 *  `other:*` rows if they ever were — unexplained, which is the safe reading. */
export const NON_GREEN = new Set(['failure', 'timed_out', 'startup_failure', 'cancelled']);

/** Aggregator steps whose red is DOWNSTREAM of another job's red. Dropped from
 *  a run's failing set whenever a non-aggregator job in that run also failed. */
export const GATE_STEP =
  /^(Require all lanes green|Require every platform green|Every job in this workflow is accounted for, and every outcome is graded|A skipped lane is only correct if the event selected another one)$/;

// ═══════════════════════════════════════════════════════════════════════════
// LOG READING — pure functions, text in, text out
// ═══════════════════════════════════════════════════════════════════════════

/** `gh run view --log-failed` prefixes every line with `job\tstep\t`; the jobs
 *  API log does not. Both carry an ISO timestamp next. Strip both. */
const PREFIX = /^(?:[^\t\n]*\t[^\t\n]*\t)?\d{4}-\d\d-\d\dT[\d:.]+Z ?/;
export const stripPrefix = (line) => String(line).replace(PREFIX, '');

const tsOf = (line) => {
  const m = /^(?:[^\t\n]*\t[^\t\n]*\t)?(\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(String(line));
  return m ? Date.parse(m[1]) : NaN;
};

/** Restrict a job's log to ONE step. The jobs API log carries every step of
 *  the job, so a `✗` printed by an earlier PASSING step (a negative test
 *  printing what it expects) would otherwise be read as the failure. Steps
 *  carry `started_at`/`completed_at`; log lines carry timestamps; the
 *  intersection is the step. The gh-format prefix, when present, is used
 *  instead. A step with no timestamps (never started) scopes to nothing. */
export function scopeToStep(lines, step) {
  const named = lines.filter((l) => {
    const parts = String(l).split('\t');
    return parts.length >= 3 && parts[1] === step?.name;
  });
  if (named.length) return named;
  const a = Date.parse(step?.started_at ?? '');
  const b = Date.parse(step?.completed_at ?? '');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
  return lines.filter((l) => {
    const t = tsOf(l);
    return Number.isFinite(t) && t >= a - 1500 && t <= b + 1500;
  });
}

const GENERIC_ERROR = /Process completed with exit code|The operation was canceled|The job was canceled/;
/** `assert-x: FAILED` — the verdict line this repository's guards print LAST. */
const VERDICT_LINE = /^\s*[\w./-]+: FAILED\s*$/;
const FAILED_WORD =
  /(?:^|\s)(?:FAILED|FAIL)\b|BUILD FAILED|Build process failed|error TS\d+|\bAssertionError\b|^\s*error:|^\s*fatal:|Failed to (?:update|resolve|load)/;
/** A printed-not-blocking note (⬜) or a printed warning (⚠). Never the error
 *  line, whatever word it carries — "it stays FAIL-CLOSED" is a ⚠ sentence
 *  from a guard that PASSED (measured on run 34429437969). */
const NOTE_LINE = /^\s*[⬜⚠]/;

/**
 * The first error line of a step, plus the lines after it — the BLOCK the
 * classifier reads. Preference order, each searched over the whole scope
 * before falling to the next:
 *   · a `✖` line — node:test's failing case, which is THE fact of a test job
 *     (the `✗` lines in that job are negative tests printing what they expect);
 *   · a `✗` line at line start (this repository's guards all speak that way;
 *     `✔ … drops every ✗ line` is a ✔ line and does not qualify);
 *   · a `##[error]` that says something (not the generic exit-code one);
 *   · the `<guard>: FAILED` verdict line;
 *   · a line that says FAILED / BUILD FAILED / a TS error / an assertion —
 *     never a ⬜ note, whatever word the note carries;
 *   · the generic cancel line;
 *   · the generic exit line WITH the three lines before it as context (that is
 *     where `dart format` and `flutter pub get` say what went wrong);
 *   · nothing.
 * The block runs `after` lines past the error line — THE REST OF THE STEP, in
 * effect. 🔴 NOT TEN, NOT EIGHTY: the ops register prints its ⬜ notes —
 * multi-line prose — BEFORE the indented `duty.… — RED SINCE` line that is
 * the actual problem. Measured on run 34391007805: the `✗` header sat at
 * scoped line 15, a ⬜ note mentioning RED SINCE at 72, and the real
 * `duty.workflow.deploy-workers.yml — RED SINCE` line beyond 96. A block cut
 * at 80 read that run as `ops-register:other`, which no cause may claim.
 */
export function errorBlock(scopedLines, after = 400) {
  const lines = scopedLines.map(stripPrefix);
  const pick = (test, before = 0) => {
    const i = lines.findIndex(test);
    if (i < 0) return null;
    const from = Math.max(0, i - before);
    return { line: lines[i].trim(), block: lines.slice(from, i + 1 + after).join('\n').trim(), index: i };
  };
  return (
    pick((l) => /^\s*✖/.test(l)) ||
    pick((l) => /^\s*✗/.test(l)) ||
    pick((l) => l.includes('##[error]') && !GENERIC_ERROR.test(l)) ||
    pick((l) => VERDICT_LINE.test(l)) ||
    pick((l) => !NOTE_LINE.test(l) && FAILED_WORD.test(l)) ||
    pick((l) => /##\[error\]The operation was canceled/.test(l)) ||
    pick((l) => /##\[error\]Process completed with exit code/.test(l), 3) || {
      line: '(no error line)',
      block: '',
      index: -1,
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SIGNATURES — the stable part of the message. MOST SPECIFIC FIRST.
// ═══════════════════════════════════════════════════════════════════════════
/** Each entry: id, a pattern tested against `<step>\n<block>`, and an optional
 *  `key` group index that is appended to the id so one pattern yields one
 *  group per subject (per duty, per route, per platform). The FIRST match
 *  wins, so a narrower reading must sit above the wider one it refines. */
export const SIGNATURES = [
  // ── a test job: the failing CASE is the fact ──────────────────────────────
  { id: 'guard-test', re: /^\s*✖ (.+?) \(\d/m, key: 1 },
  // ── the ops register ([14]O-3 reader) ──────────────────────────────────────
  { id: 'ops-register:red-since', re: /(duty\.workflow\.[\w.-]+) — RED SINCE/, key: 1 },
  { id: 'ops-register:duty-stale', re: /(duty\.[\w.-]+) — its record IS reachable and the newest SUCCESSFUL run is .* outside its own window/, key: 1 },
  { id: 'ops-register:duty-dark', re: /(duty\.[\w.-]+) — (?:its record (?:could not be|is not) |the reader (?:could not|cannot) )/, key: 1 },
  { id: 'ops-register:max-delete', re: /--max-delete threshold reached/ },
  { id: 'ops-register:alert-disposition-403', re: /Every alerting firing has a recorded disposition[\s\S]*GitHub API returned 403/ },
  { id: 'ops-register:firing-history-403', re: /limb A — a declared firing history could not be enumerated: GitHub API returned 403/ },
  // The header says "N problem(s)"; the problem is the first INDENTED line that
  // is neither a ⬜ note nor a `·` sub-bullet nor a `[..]` legend. Keyed on it.
  { id: 'ops-register:problem', re: /✗ tooling\/ops\/register\.json[^\n]*\n(?:[^\n]*\n)*?[ \t]{2,}(?![⬜·[])(\S[^\n]{0,90})/, key: 1, normaliseKey: true },
  { id: 'ops-register:other', re: /✗ tooling\/ops\/register\.json/ },
  // ── the shared quota ──────────────────────────────────────────────────────
  { id: 'github-api:403-installation-quota', re: /API rate limit exceeded for installation|GitHub API returned 403|returned 403 listing runs|HTTP 403/ },
  // ── freshness / provenance readers ────────────────────────────────────────
  { id: 'pages-freshness:strict-equality', re: /succeeded, but it is serving commit .* while the newest commit on `main` touching/ },
  { id: 'pages-freshness:no-deployment', re: /Every Pages project's newest PRODUCTION deployment succeeded/ },
  { id: 'provenance:unresolved-rows', re: /group\(s\) of rows in production cannot be traced to a released build/ },
  { id: 'provenance:d1-api-unreadable', re: /COULD NOT LOOK — the D1 API returned (\d{3})/, key: 1 },
  { id: 'provenance:github-api-unreadable', re: /COULD NOT LOOK — the GitHub API returned (\d{3})/, key: 1 },
  { id: 'proof-fresh:no-green-scheduled', re: /NO GREEN SCHEDULED RUN in the newest/ },
  { id: 'proof-fresh:other', re: /must be RECENT, SCHEDULED and GREEN/ },
  // ── registers and generated files ─────────────────────────────────────────
  { id: 'platform-register:unregistered-route', re: /((?:GET|POST|PUT|PATCH|DELETE) \S+) — MOUNTED by .* and absent from the register/, key: 1 },
  { id: 'platform-register:other', re: /✗ platform register/ },
  { id: 'policy-claims:unclaimed-route-segment', re: /registers a route segment .* that is neither a provider's tell/ },
  { id: 'policy-claims:unrowed-emphasis', re: /emphasises .* has no row for it/ },
  { id: 'policy-claims:other', re: /✗ policy claims/ },
  { id: 'start-here:drift', re: /^START-HERE\.md is what the tree generates/ },
  { id: 'enforcement-index:drift', re: /enforcement-index\.json DISAGREES|^The enforcement index is what the tree says/ },
  { id: 'monitor-register:drift', re: /is pointed at .* live and the register records/ },
  { id: 'monitor-register:no-project', re: /NO PROJECT: monitor/ },
  { id: 'monitor-register:other', re: /^The register still matches the live GlitchTip monitors/ },
  { id: 'retention-coverage', re: /✗ (?:retention coverage|COVERAGE LOST — retention\.)/ },
  { id: 'supabase-templates:drift', re: /DIFFERS from live `mailer_templates/ },
  { id: 'catalogue:reachability', re: /✗ catalogue reachability/ },
  { id: 'privacy-notice:drift', re: /notice surface\(s\) no longer match the privacy declaration/ },
  { id: 'site-integrity', re: /✗ \d+ site problem\(s\)/ },
  { id: 'deploy-triggers:unreachable', re: /A TRIGGER PATH CANNOT REACH THE JOBS IT TRIGGERS/ },
  { id: 'surfaces:unhealthy', re: /probed surface\(s\) are NOT healthy/ },
  // ── downstream refusals ───────────────────────────────────────────────────
  { id: 'ci-gate:refused-downstream', re: /ci-gate concluded "(?:failure|cancelled)" for|waiting for "ci-gate"/ },
  { id: 'smoke:stale-build', re: /POST-DEPLOY SMOKE FAILED/ },
  { id: 'web-smoke:first-frame-timeout', re: /never reached the ready signal `flutter-first-frame`/ },
  { id: 'bundle-launch:404', re: /^Launch the built bundle once/ },
  // ── builds and toolchains ─────────────────────────────────────────────────
  { id: 'windows:max-path', re: /Unable to generate build files|cannot write keep file|Filename too long/ },
  { id: 'zizmor:install-failed', re: /^Install zizmor/ },
  { id: 'macos:build-failed', re: /^Build macos[\s\S]*BUILD FAILED/ },
  { id: 'apple:signing-failed', re: /apple-signing: FAILED|assert-artifact-signed-apple: FAILED|find: build\/ios\/ipa: No such file/ },
  { id: 'glitchtip:symbol-upload', re: /debug-files upload exited|difs\/assemble/ },
  { id: 'dart:format', re: /dart format-clean[\s\S]*(?:Changed |Formatted \d+ files)/ },
  { id: 'dart:package-uri-unresolved', re: /Failed to resolve package URI/ },
  { id: 'dart:pub-resolve', re: /incompatible with dependency constraints|Failed to update packages/ },
  { id: 'osv:known-vulnerable', re: /^Known-vulnerable dependencies/ },
  { id: 'hang-guard:ceiling', re: /hang-guard: all \d+ attempt\(s\) exceeded/ },
  { id: 'tsc:error', re: /error TS\d+/ },
  { id: 'npm-test:assertion', re: /AssertionError/ },
  // ── the nightly live e2e and its preflights ───────────────────────────────
  { id: 'e2e:consent-artifact-mismatch', re: /the newest artifact says granted=\d, but the suite tapped/ },
  { id: 'e2e:leg-failed', re: /##\[error\]Failure in method: ([^\n]+)/, key: 1 },
  { id: 'e2e:preflight-variable-unset', re: /repository VARIABLE (\w+) is unset/, key: 1 },
  { id: 'e2e:preflight-secrets-missing', re: /auth_target=\w+ needs \w+/ },
  { id: 'e2e:integration-tests-failed', re: /^Run integration tests \(headless Chrome\)/ },
  // ── readers on main that answer for live systems ──────────────────────────
  { id: 'analytics:silence-judged-fault', re: /THE ANALYTICS RAIL IS SILENT WHILE/ },
  { id: 'heartbeat-table:unhealthy', re: /scheduled duty is not reporting healthy/ },
  { id: 'alarm-chains:monitor-missing', re: /expected monitor "[^"]*" is not in the live list/ },
  { id: 'actions-usage:over-ceiling', re: /net-billed Actions spend is over the declared ceiling/ },
  { id: 'supabase-config:no-credential', re: /found no SUPABASE_PAT/ },
  { id: 'd1-live-sql:refused', re: /D1 REFUSES A STATEMENT THIS REPOSITORY DEPLOYS/ },
  { id: 'd1-live-sql:could-not-complete', re: /This check COULD NOT COMPLETE, so nothing above may be read as proof/ },
  { id: 'deployment-record:no-environment-row', re: /no row in tooling\/channel-register\.json has a `deploymentEnvironment` template/ },
  { id: 'deployment-record:github-5xx', re: /could not record the deployment: POST deployments → 5\d\d/ },
  { id: 'ci-gate:no-sha-given', re: /✗ no commit SHA given/ },
  // ── deploy and release lanes ──────────────────────────────────────────────
  { id: 'wrangler:npx-failed', re: /The process '[^']*npx' failed with exit code/ },
  { id: 'pages:ensure-project', re: /^Ensure the Pages project exists/ },
  { id: 'android:gradle-failed', re: /Gradle task assembleRelease failed|^Build android/ },
  { id: 'msix:identity-guard', re: /assert-artifact-signed-msix|^The MSIX carries the identity the register declares/ },
  { id: 'play:device-coverage', re: /✗ play device coverage/ },
  { id: 'snap:pack-failed', re: /Cannot pack snap|^Pack the snap/ },
  { id: 'store-screenshots:capture', re: /^(?:Capture the set|Propose the set for human review)/ },
  { id: 'site-drift-repair:pr-setting', re: /Allow GitHub Actions to create and approve pull requests/ },
  { id: 'renovate:docker-failed', re: /^Run Renovate/ },
  // ── scanners and toolchain plumbing ───────────────────────────────────────
  { id: 'versions:drift', re: /version drift problem\(s\)|^Build versions all match versions\.json/ },
  { id: 'secret-scan:found', re: /✗ secret scan found something/ },
  { id: 'secret-scan:canary-coverage', re: /declares \d+ rule\(s\) but \d+ canar/ },
  { id: 'workflow-static-analysis:finding', re: /workflow static analysis found/ },
  { id: 'guard-coverage:orphan-guard', re: /neither invoked by a workflow nor imported by one that is/ },
  { id: 'actions-cache:not-allowed', re: /actions\/cache@v\d+ is not allowed/ },
  { id: 'setup-node:cache-paths', re: /Some specified paths were not resolved, unable to cache dependencies/ },
  { id: 'upload-artifact:no-files', re: /No files were found with the provided path/ },
  { id: 'flutter:analyze', re: /^Run flutter analyze/ },
  { id: 'melos:test', re: /^melos run test/ },
  { id: 'workspace:missing-member', re: /workspace member\(s\) listed but missing from disk/ },
  { id: 'tokens-css:drift', re: /^Site tokens\.css must equal a fresh build/ },
  { id: 'site-feed:drift', re: /^Site feed must equal a fresh generation/ },
  { id: 'l10n:drift', re: /^Regenerating the chassis localisations moved no tracked byte/ },
  { id: 'clone-tells', re: /✗ clone tells/ },
  { id: 'launcher-icons:vacuous-compare', re: /^No shipped app carries Flutter's default launcher icon/ },
  { id: 'brand-assets:no-platform-claim', re: /no platform claim found for/ },
  { id: 'wrangler-jsonc:missing', re: /carries no wrangler\.jsonc/ },
  { id: 'extensions:gate-mutation-proof', re: /^Every gate must be proven to fail on a real mutation/ },
  { id: 'extensions:tag-reachable', re: /^Tag must be reachable from main/ },
  { id: 'stamped-service:typecheck', re: /^Typecheck \+ dry-run the stamped service/ },
  { id: 'pipeline-tests', re: /^The pipeline's own tests/ },
  { id: 'actions:unresolvable-pin', re: /Unable to resolve action `[^`]+`, unable to find version/ },
  { id: 'stamp:backend-r2-claim', re: /backend stamp declared a per-app R\d bucket/ },
  { id: 'media-probe:clip-generation', re: /^Generate VP\d\/Opus test clip/ },
  { id: 'flutter:analyze-stamped', re: /^Analyze \+ test the stamped app/ },
  { id: 'web:build-failed', re: /^Build web \(release/ },
  // ── named guards that print `<guard>: FAILED` ─────────────────────────────
  { id: 'guard-failed', re: /(assert-[\w-]+): FAILED/, key: 1 },
  // ── the house refusal shape, `✗ <subject> — N problem(s):`, keyed on subject
  { id: 'guard-refused', re: /^\s*✗ ([^\n—:]{1,60}?)(?: —|:) \d+ (?:problem|finding)\(s\)/m, key: 1 },
  // ── cancellation (refined by timing in classifyRun) ──────────────────────
  { id: 'cancelled', re: /The operation was canceled|The job was canceled/ },
];

/** Non-signature text that varies per run, folded so a fallback signature
 *  groups instead of fragmenting: SHAs, timestamps, durations, counts, paths. */
export const normalise = (s) =>
  String(s)
    .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<ts>')
    // A SHA has at least one hex LETTER; an 11-digit run id has none and is a <n>.
    .replace(/\b(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, '<sha>')
    .replace(/\d+(?:\.\d+)?\s*(?:ms|s|h|m)\b/g, '<dur>')
    .replace(/\/home\/runner\/work\/\S+/g, '<path>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

/** step + error block → signature id. Never the job name. */
export function signatureOf({ step, block, conclusion }, signatures = SIGNATURES) {
  const text = `${step ?? ''}\n${block ?? ''}`;
  for (const s of signatures) {
    const m = s.re.exec(text);
    if (m) {
      if (!s.key) return s.id;
      const k = String(m[s.key]).trim();
      return `${s.id}:${s.normaliseKey ? normalise(k) : k}`;
    }
  }
  if (conclusion === 'cancelled') return 'cancelled';
  // A failed step whose log carries nothing at all (the API served an empty or
  // 404 log — measured on 2026-08-25 main runs older than a fortnight). The
  // step name is the only fact; the id says so rather than pretending to a
  // message it never read.
  if (!String(block ?? '').trim()) return `no-log:${String(step ?? '(no step)').trim()}`;
  const first = String(block ?? '').split('\n')[0];
  return `other:${normalise(step ?? '(no step)')}:${normalise(first || '(no error line)')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ROWS
// ═══════════════════════════════════════════════════════════════════════════

export const failingJobs = (jobs) => (jobs ?? []).filter((j) => NON_GREEN.has(String(j?.conclusion)));
export const failingStep = (job) => (job?.steps ?? []).find((s) => NON_GREEN.has(String(s?.conclusion))) ?? null;

/**
 * One run → one row (the run's PRIMARY failing job). When several non-gate
 * jobs failed, the first in job order carries the row and the others are
 * listed in `alsoFailed`, so a matrix failing five ways is one run in the
 * count, as it is one run in the owner's list.
 */
export function classifyRun(run, jobs, logFor, { newerRunExists = false, signatures = SIGNATURES } = {}) {
  const failing = failingJobs(jobs);
  const nonGate = failing.filter((j) => !GATE_STEP.test(failingStep(j)?.name ?? ''));
  const primary = nonGate[0] ?? failing[0] ?? null;
  const base = {
    id: run.id,
    workflow: String(run.path ?? '').replace(/^\.github\/workflows\//, ''),
    branch: run.head_branch,
    sha: String(run.head_sha ?? '').slice(0, 8),
    event: run.event,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    attempt: run.run_attempt ?? 1,
  };
  if (!primary) {
    // Every job green or skipped, run still non-green: a startup failure, a
    // cancellation before any job ran, or a run whose jobs the API withheld.
    const sig = run.conclusion === 'cancelled'
      ? newerRunExists ? 'cancelled:superseded-in-group' : 'cancelled:by-hand-or-unknown'
      : `startup:${run.conclusion}`;
    return { ...base, job: '(no failing job)', step: '(none)', error: '(no job ran or none failed)', signature: sig, alsoFailed: [] };
  }
  const step = failingStep(primary);
  const scoped = scopeToStep(logFor(primary) ?? [], step);
  const eb = errorBlock(scoped);
  let signature;
  if (nonGate.length === 0) {
    signature = 'gate-only';
  } else {
    signature = signatureOf({ step: step?.name, block: eb.block, conclusion: primary.conclusion }, signatures);
    if (signature === 'cancelled' || (primary.conclusion === 'cancelled' && run.conclusion === 'cancelled')) {
      signature = newerRunExists ? 'cancelled:superseded-in-group' : 'cancelled:by-hand-or-unknown';
    }
  }
  return {
    ...base,
    job: primary.name,
    step: step?.name ?? '(job-level)',
    error: eb.line,
    signature,
    alsoFailed: nonGate.slice(1).map((j) => `${j.name} › ${failingStep(j)?.name ?? '(job-level)'}`),
  };
}

/** Did a newer run of the same workflow on the same ref start while this one
 *  was still running? That is `cancel-in-progress`'s footprint. */
export function newerRunDuring(run, allRuns) {
  const a = Date.parse(run.created_at);
  const b = Date.parse(run.updated_at);
  return allRuns.some(
    (r) =>
      r.id !== run.id &&
      r.path === run.path &&
      r.head_branch === run.head_branch &&
      Date.parse(r.created_at) > a &&
      Date.parse(r.created_at) <= b + 60_000,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CAUSES — the register this ledger consumes
// ═══════════════════════════════════════════════════════════════════════════

export function loadCauses(path = join(ROOT, CAUSES_REL)) {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(doc.causes) || doc.causes.length === 0) {
    throw new Error(`${CAUSES_REL} carries no \`causes\` array — a ledger against an empty register explains nothing`);
  }
  for (const c of doc.causes) {
    for (const k of ['signature', 'rootCause', 'fix']) {
      if (typeof c[k] !== 'string' || !c[k].trim()) throw new Error(`${CAUSES_REL}: a cause lacks \`${k}\`: ${JSON.stringify(c).slice(0, 120)}`);
    }
    if (c.scope !== undefined && c.scope !== 'main' && c.scope !== 'feature-branches') {
      throw new Error(`${CAUSES_REL}: cause ${c.signature} has scope \`${c.scope}\`; only "main" or "feature-branches" are readable`);
    }
  }
  return doc.causes;
}

/** Exact id first; then a trailing-`*` prefix, longest prefix wins. A cause
 *  with `scope: "feature-branches"` never applies to main and one with
 *  `scope: "main"` applies only there — "fixed on the branch before merge" is
 *  not a sentence that can be true of a red run ON main. */
export function causeFor(signature, causes, branch = null) {
  const inScope = (c) =>
    !c.scope || (c.scope === 'main' ? branch === 'main' : c.scope === 'feature-branches' ? branch !== 'main' : false);
  let best = null;
  for (const c of causes) {
    if (!inScope(c)) continue;
    if (c.signature === signature) return c;
    if (c.signature.endsWith('*')) {
      const p = c.signature.slice(0, -1);
      if (signature.startsWith(p) && (!best || p.length > best.signature.length - 1)) best = c;
    }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROOF OF CLOSURE, AND THE GROUPING
// ═══════════════════════════════════════════════════════════════════════════

/** newest: Map "<path>|<branch>" → newest run of that workflow on that branch
 *  (any conclusion). branches: Set of live branch names. prs: Map branch → pr. */
export function proofFor(row, { newest, branches, prs }) {
  const key = `${row.workflowPath}|${row.branch}`;
  const n = newest.get(key) ?? null;
  const alive = branches.has(row.branch);
  if (n && n.conclusion === 'success') {
    return { kind: 'later-green', runId: n.id, at: n.created_at, text: `later green: run ${n.id} @ ${n.created_at}` };
  }
  if (!alive) {
    const pr = prs.get(row.branch);
    if (pr?.merged_at) return { kind: 'branch-gone', pr: pr.number, sha: String(pr.merge_commit_sha ?? '').slice(0, 8), text: `branch deleted; PR #${pr.number} merged ${String(pr.merge_commit_sha ?? '').slice(0, 8)} @ ${pr.merged_at}` };
    if (pr) return { kind: 'branch-gone', pr: pr.number, text: `branch deleted; PR #${pr.number} closed unmerged` };
    return { kind: 'branch-gone', text: 'branch deleted; no PR found' };
  }
  if (n) return { kind: 'none', text: `OPEN — newest ${row.workflow} on ${row.branch} is run ${n.id} (${n.conclusion}) @ ${n.created_at}` };
  return { kind: 'none', text: `OPEN — no newer run of ${row.workflow} on live branch ${row.branch}` };
}

export const isExplained = (cause, proof) => Boolean(cause) && proof.kind !== 'none';

export function groupRows(rows, causes, ctx) {
  const groups = new Map();
  const unexplained = [];
  for (const row of rows) {
    const cause = causeFor(row.signature, causes, row.branch);
    const proof = proofFor(row, ctx);
    const explained = isExplained(cause, proof);
    const g = groups.get(row.signature) ?? { signature: row.signature, count: 0, cause, rows: [], proofs: new Map(), unexplained: 0 };
    g.count++;
    g.rows.push({ ...row, proof: proof.text, explained });
    if (!g.proofs.has(proof.text)) g.proofs.set(proof.text, 0);
    g.proofs.set(proof.text, g.proofs.get(proof.text) + 1);
    if (!explained) {
      g.unexplained++;
      unexplained.push({ ...row, proof: proof.text, why: !cause ? 'no cause in register' : 'no later green and branch still alive' });
    }
    groups.set(row.signature, g);
  }
  return { groups: [...groups.values()].sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature)), unexplained };
}

const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

export function renderTable(groups) {
  const out = [];
  out.push('signature | count | root cause | fix | proof of later green / closure');
  out.push('--- | --- | --- | --- | ---');
  for (const g of groups) {
    const proofs = [...g.proofs.entries()].sort((a, b) => b[1] - a[1]);
    const shown = proofs.slice(0, 3).map(([t, n]) => (n > 1 ? `${t} ×${n}` : t));
    if (proofs.length > 3) shown.push(`+${proofs.length - 3} more`);
    out.push(
      [
        g.signature,
        g.count + (g.unexplained ? ` (${g.unexplained} UNEXPLAINED)` : ''),
        g.cause ? clip(g.cause.rootCause, 220) : '— NO CAUSE IN REGISTER —',
        g.cause ? clip(g.cause.fix, 160) : '—',
        shown.join('; '),
      ].join(' | '),
    );
  }
  return out.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSPORT — live (with an optional immutable cache), or a fixture with NO
// NETWORK PATH AT ALL
// ═══════════════════════════════════════════════════════════════════════════

const PER_PAGE = 100;
/** GitHub stops paging this endpoint at 1000 results per query. */
const LIST_CEILING = 1000;

export class CoverageLost extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'COVERAGE LOST';
  }
}

// ── WHAT MAY REACH THE NETWORK, AND HOW THE CACHE IS TOUCHED ────────────────
// ⏱ 2026-09-11 · Three CodeQL alerts on this file, answered in code rather than
// dismissed:
//   · js/file-access-to-http — the flow CodeQL traced runs from the local vault
//     FILE (safe-rerun.mjs `fromVault`) into the `authorization` header. The
//     credential and the repository slug are now held to the shapes GitHub
//     issues before either is placed in a request, and every request path is
//     held to the six shapes this reader builds, numeric ids only — so nothing
//     read from a file (the vault, a git remote, a cached run) reaches `fetch`
//     unless it has one of those shapes.
//   · js/file-system-race — the cache was `existsSync(p)` then `readFileSync(p)`;
//     a file removed between the two crashed the run. It is now read ONCE, with
//     ENOENT as the only "not cached" answer, and written to a unique temporary
//     name and RENAMED into place, so no reader ever sees a half-written file.

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The shapes of a GitHub credential: `ghp_` `gho_` `ghu_` `ghs_` `ghr_` tokens,
 *  a fine-grained `github_pat_`, and a legacy 40-hex token. Anything else — a
 *  pasted `Bearer …`, a trailing newline, a second header after CR/LF — is
 *  refused before it can be sent. */
const GITHUB_TOKEN_SHAPE = /^(?:gh[pousr]_[A-Za-z0-9]{36,251}|github_pat_[A-Za-z0-9_]{22,251}|[0-9a-f]{40})$/;
export const isValidGithubToken = (tok) => typeof tok === 'string' && GITHUB_TOKEN_SHAPE.test(tok);

/** `owner/name` by GitHub's character rules; a name may not start with `.`, so
 *  `..` can never climb out of `/repos/`. */
const REPO_SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;
export const isValidRepoSlug = (repo) => typeof repo === 'string' && REPO_SHAPE.test(repo);

/** A query string exactly as this reader builds one: `encodeURIComponent` output
 *  joined by `=` and `&`. No `/`, no `#`, no `..` segment can appear in it. */
const QUERY = String.raw`\?[A-Za-z0-9_.!~*'()%&=-]*`;
const NUMERIC_ID = '[0-9]{1,20}';

/** The six request paths this reader issues, and nothing else. */
export function isAllowedApiPath(repo, path) {
  if (!isValidRepoSlug(repo) || typeof path !== 'string') return false;
  const R = `/repos/${reEscape(repo)}`;
  return [
    `${R}/actions/runs${QUERY}`,
    `${R}/actions/runs/${NUMERIC_ID}/jobs${QUERY}`,
    `${R}/actions/jobs/${NUMERIC_ID}/logs`,
    `${R}/actions/workflows/${NUMERIC_ID}/runs${QUERY}`,
    `${R}/branches${QUERY}`,
    `${R}/pulls${QUERY}`,
  ].some((shape) => new RegExp(`^${shape}$`).test(path));
}

/** A cache entry is one flat file name inside the cache directory — never a path. */
const CACHE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,200}$/;

const REAL_FS = { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync };

/** Read `name` from `cacheDir`, or fetch it and cache it. No check precedes the
 *  read (ENOENT is the only miss), and the write lands by rename. `fs` is a seam
 *  for the test that removes the file between a would-be check and the read. */
export async function readThroughCache(cacheDir, name, fetcher, { text = false, fs = REAL_FS } = {}) {
  if (!cacheDir) return fetcher();
  if (!CACHE_NAME.test(name) || name.includes('..')) {
    throw new CoverageLost(`refusing cache entry ${JSON.stringify(String(name)).slice(0, 120)} — not a flat file name`);
  }
  const p = join(cacheDir, name);
  let raw = null;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
  if (raw !== null) return text ? raw : JSON.parse(raw);
  const v = await fetcher();
  fs.mkdirSync(cacheDir, { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(tmp, text ? v : JSON.stringify(v), { flag: 'wx' });
    fs.renameSync(tmp, p);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* the original error is the one worth reporting */
    }
    throw e;
  }
  return v;
}

function liveApi(repo, tok, cacheDir) {
  // Held HERE, where the header is built, as well as in main(): a caller that
  // skips main() must not be able to send an unshaped credential either.
  if (!isValidGithubToken(tok)) {
    throw new CoverageLost('the GitHub credential does not have the shape of a GitHub token, so it was not sent');
  }
  if (!isValidRepoSlug(repo)) {
    throw new CoverageLost(`${JSON.stringify(String(repo)).slice(0, 120)} is not an owner/name repository slug`);
  }
  const headers = {
    authorization: `Bearer ${tok}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'nikatru-triage-failed-runs',
  };
  const get = async (path, { text = false } = {}) => {
    if (!isAllowedApiPath(repo, path)) {
      throw new CoverageLost(
        `refusing to request ${JSON.stringify(String(path)).slice(0, 160)} — not one of the six GitHub API paths this reader builds (numeric ids only)`,
      );
    }
    const url = new URL(`${API}${path}`);
    if (url.origin !== API) throw new CoverageLost(`refusing a request that resolved off ${API} (${url.origin})`);
    const res = await fetch(url, { headers, redirect: 'follow' });
    if (res.status === 403 || res.status === 429) {
      throw new CoverageLost(`GET ${path} → HTTP ${res.status} — the quota or the credential refused; nothing after this point was read`);
    }
    if (!res.ok) {
      const e = new Error(`GET ${path} → HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return text ? res.text() : res.json();
  };
  const cached = (name, fetcher, { text = false } = {}) => readThroughCache(cacheDir, name, fetcher, { text });
  return {
    live: true,
    /** Every run with one of the non-green conclusions. Never cached: the
     *  list is the enumeration, and yesterday's list is the sample this tool
     *  exists to replace. */
    listNonGreen: async (since, until) => {
      const out = [];
      const capped = [];
      const created = since && until ? `${since}..${until}` : since ? `>=${since}` : until ? `<=${until}` : null;
      for (const status of NON_GREEN) {
        const q = `status=${status}&per_page=${PER_PAGE}` + (created ? `&created=${encodeURIComponent(created)}` : '');
        let total = null;
        for (let page = 1; page <= LIST_CEILING / PER_PAGE; page++) {
          const body = await get(`/repos/${repo}/actions/runs?${q}&page=${page}`);
          total = Number(body.total_count ?? 0);
          const batch = body.workflow_runs ?? [];
          out.push(...batch);
          if (batch.length < PER_PAGE) break;
        }
        const got = out.filter((r) => r.conclusion === status).length;
        if (total !== null && got < total) capped.push(`${status}: ${got} of ${total}`);
      }
      return { runs: out, capped };
    },
    listJobs: (id) => cached(`${id}.jobs.json`, () => get(`/repos/${repo}/actions/runs/${id}/jobs?per_page=${PER_PAGE}&filter=all`)),
    // 404 is an ANSWER here — a job cancelled before its first step ran has no
    // log (measured 2026-08-04, run 30874929577: eight lanes cancelled at +6s,
    // every log 404). It is the ONLY status turned into an empty log; a 403
    // still throws COVERAGE LOST above, so the quota cannot read as "no log".
    jobLog: (id, jobId) =>
      cached(
        `${id}.job-${jobId}.log`,
        async () => {
          try {
            return await get(`/repos/${repo}/actions/jobs/${jobId}/logs`, { text: true });
          } catch (e) {
            if (e.status === 404) return '';
            throw e;
          }
        },
        { text: true },
      ),
    newestRun: (workflowId, branch, key) =>
      cached(`newest-${key.replace(/[^\w.-]+/g, '_')}.json`, async () => {
        const body = await get(`/repos/${repo}/actions/workflows/${workflowId}/runs?branch=${encodeURIComponent(branch)}&per_page=1`);
        return body.workflow_runs?.[0] ?? null;
      }),
    /** Every run of one workflow on one ref created inside [from, to] — the
     *  window in which a `cancel-in-progress` successor must have started. */
    runsBetween: (workflowId, branch, id, from, to) =>
      cached(`between-${id}.json`, async () => {
        const body = await get(
          `/repos/${repo}/actions/workflows/${workflowId}/runs?branch=${encodeURIComponent(branch)}&created=${encodeURIComponent(`${from}..${to}`)}&per_page=${PER_PAGE}`,
        );
        return body.workflow_runs ?? [];
      }),
    branches: async () => {
      const names = new Set();
      for (let page = 1; page <= 20; page++) {
        const body = await get(`/repos/${repo}/branches?per_page=${PER_PAGE}&page=${page}`);
        for (const b of body) names.add(b.name);
        if (body.length < PER_PAGE) break;
      }
      return names;
    },
    prFor: (branch) =>
      cached(`pr-${branch.replace(/[^\w.-]+/g, '_')}.json`, async () => {
        const owner = repo.split('/')[0];
        const body = await get(`/repos/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all&per_page=5`);
        const merged = body.find((p) => p.merged_at) ?? body[0] ?? null;
        return merged ? { number: merged.number, merged_at: merged.merged_at, merge_commit_sha: merged.merge_commit_sha, state: merged.state } : null;
      }),
  };
}

export function fixtureApi(dir) {
  const read = (name, fallback) => {
    const p = join(dir, name);
    if (!existsSync(p)) {
      if (fallback !== undefined) return fallback;
      throw new CoverageLost(`fixture ${name} is missing from ${dir}`);
    }
    return name.endsWith('.log') ? readFileSync(p, 'utf8') : JSON.parse(readFileSync(p, 'utf8'));
  };
  return {
    live: false,
    repo: read('repo.json', { repo: 'fixture/fixture' }).repo,
    listNonGreen: async () => ({ runs: read("runs.json"), capped: read("capped.json", []) }),
    listJobs: async (id) => read(`${id}.jobs.json`),
    // A missing log reads as EMPTY, never as a throw: the row then classifies
    // as `other:…:(no error line)`, which has no cause and is UNEXPLAINED —
    // the safe direction for a fixture that forgot a file.
    jobLog: async (id, jobId) => read(`${id}.job-${jobId}.log`, ''),
    newestRun: async (_wf, _branch, key) => read('newest.json', {})[key] ?? null,
    runsBetween: async (_wf, _branch, id) => read(`between-${id}.json`, []),
    branches: async () => new Set(read('branches.json', [])),
    prFor: async (branch) => read('prs.json', {})[branch] ?? null,
  };
}

function repoFromGit() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
export function parseArgs(argv) {
  const a = { repo: null, since: null, until: null, cacheDir: null, fixtureDir: null, prs: true, json: null, causes: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--repo') a.repo = argv[++i] ?? null;
    else if (x === '--since') a.since = argv[++i] ?? null;
    else if (x === '--until') a.until = argv[++i] ?? null;
    else if (x === '--cache-dir') a.cacheDir = argv[++i] ?? null;
    else if (x === '--fixture-dir') a.fixtureDir = argv[++i] ?? null;
    else if (x === '--causes') a.causes = argv[++i] ?? null;
    else if (x === '--json') a.json = argv[++i] ?? null;
    else if (x === '--no-prs') a.prs = false;
    else return { error: `unrecognised argument \`${x}\`` };
  }
  if (a.since && !Number.isFinite(Date.parse(a.since))) return { error: `--since must be an ISO instant, got \`${a.since}\`` };
  if (a.until && !Number.isFinite(Date.parse(a.until))) return { error: `--until must be an ISO instant, got \`${a.until}\`` };
  return a;
}

/** The whole ledger, given a transport. Exported so the test can drive it
 *  with a mutated signature table and watch UNEXPLAINED move. */
export async function ledger(api, { since = null, until = null, prs = true, causes, signatures = SIGNATURES, log = () => {} } = {}) {
  const { runs: all, capped } = await api.listNonGreen(since, until);
  const inWindow = (r) => (!since || Date.parse(r.created_at) >= Date.parse(since)) && (!until || Date.parse(r.created_at) <= Date.parse(until));
  const runs = all.filter((r) => NON_GREEN.has(String(r.conclusion)) && inWindow(r));
  runs.sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at));
  const range = runs.length ? `${runs[runs.length - 1].created_at} .. ${runs[0].created_at}` : '(none)';
  log(`enumerated ${runs.length} non-green run(s), ${range}${since ? ` (since ${since})` : ''}${until ? ` (until ${until})` : ''}`);
  for (const c of capped) log(`✗ COVERAGE LOST — the run list was CAPPED by the API: ${c}`);

  const rows = [];
  let n = 0;
  for (const run of runs) {
    n++;
    const jobsBody = await api.listJobs(run.id);
    const jobs = jobsBody?.jobs ?? [];
    if (typeof jobsBody?.total_count === 'number' && jobsBody.total_count > jobs.length) {
      throw new CoverageLost(`run ${run.id} reports ${jobsBody.total_count} job(s) but one page carried ${jobs.length}`);
    }
    const logs = new Map();
    const failing = failingJobs(jobs).filter((j) => !GATE_STEP.test(failingStep(j)?.name ?? ''));
    const primary = failing[0] ?? failingJobs(jobs)[0];
    if (primary) {
      const text = await api.jobLog(run.id, primary.id);
      logs.set(primary.id, String(text ?? '').split(/\r?\n/));
    }
    // 🔴 THE SUCCESSOR THAT EVICTED A CANCELLED RUN IS USUALLY GREEN, so it is
    // NOT in the non-green list this ledger enumerates. Ask the API for every
    // run of the same workflow on the same ref created while this one lived.
    let newerRunExists = false;
    if (run.conclusion === 'cancelled' || failingJobs(jobs).some((j) => j.conclusion === 'cancelled')) {
      const to = new Date(Date.parse(run.updated_at) + 60_000).toISOString();
      const between = await api.runsBetween(run.workflow_id, run.head_branch, run.id, run.created_at, to);
      newerRunExists = newerRunDuring(run, [...(between ?? []), ...all]);
    }
    const row = classifyRun(run, jobs, (j) => logs.get(j.id) ?? [], { newerRunExists, signatures });
    row.workflowPath = run.path;
    row.workflowId = run.workflow_id;
    rows.push(row);
    if (n % 50 === 0) log(`  … ${n}/${runs.length} classified`);
  }

  const newest = new Map();
  const pairs = new Map();
  for (const r of rows) pairs.set(`${r.workflowPath}|${r.branch}`, r);
  for (const [key, r] of pairs) newest.set(key, await api.newestRun(r.workflowId, r.branch, key));
  const branches = await api.branches();
  const prMap = new Map();
  if (prs) {
    for (const b of new Set(rows.map((r) => r.branch))) {
      if (!branches.has(b)) prMap.set(b, await api.prFor(b));
    }
  }
  const { groups, unexplained } = groupRows(rows, causes, { newest, branches, prs: prMap });
  return { runs, rows, groups, unexplained, capped, range, newest, branches, prs: prMap };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`✗ COVERAGE LOST — ${args.error}`);
    return 2;
  }
  let causes;
  try {
    causes = loadCauses(args.causes ? resolve(args.causes) : undefined);
  } catch (e) {
    console.error(`✗ COVERAGE LOST — ${e.message}`);
    return 2;
  }
  let api;
  if (args.fixtureDir) {
    if (!existsSync(args.fixtureDir)) {
      console.error(`✗ COVERAGE LOST — --fixture-dir ${args.fixtureDir} does not exist`);
      return 2;
    }
    api = fixtureApi(resolve(args.fixtureDir));
    console.log(`⚠️  FIXTURE TRANSPORT — no network. Reading ${args.fixtureDir}`);
  } else {
    const repo = args.repo ?? (process.env.GITHUB_REPOSITORY?.trim() || repoFromGit());
    if (!repo) {
      console.error('✗ COVERAGE LOST — no repository. Pass --repo owner/name or set GITHUB_REPOSITORY.');
      return 2;
    }
    const tok = token();
    if (!tok) {
      console.error('✗ COVERAGE LOST — no GitHub credential. Set GH_TOKEN/GITHUB_TOKEN, or make the vault key Project_Cross_Platform_Apps_GITHUB_PAT readable.');
      return 2;
    }
    if (!isValidGithubToken(tok)) {
      // The value is never printed: a mis-pasted vault line is still a secret.
      console.error(
        '✗ COVERAGE LOST — the GitHub credential does not have the shape of a GitHub token (ghp_/gho_/ghu_/ghs_/ghr_/github_pat_/40-hex), so it was not sent. Its value is not printed.',
      );
      return 2;
    }
    if (!isValidRepoSlug(repo)) {
      console.error(`✗ COVERAGE LOST — ${JSON.stringify(String(repo)).slice(0, 120)} is not an owner/name repository slug, so no request path can be built from it.`);
      return 2;
    }
    api = liveApi(repo, tok, args.cacheDir ? resolve(args.cacheDir) : null);
    console.log(`triage-failed-runs — ${repo}${args.cacheDir ? ` (cache ${args.cacheDir})` : ''}`);
  }

  let result;
  try {
    result = await ledger(api, { since: args.since, until: args.until, prs: args.prs, causes, log: (m) => console.log(m) });
  } catch (e) {
    if (e instanceof CoverageLost) {
      console.error(`✗ COVERAGE LOST — ${e.message}`);
      return 2;
    }
    console.error(`✗ COVERAGE LOST — ${e.message}`);
    return 2;
  }
  const { rows, groups, unexplained, capped, range } = result;
  console.log('');
  console.log(`COVERAGE: ${rows.length} non-green run(s), ${range}${capped.length ? ` — CAPPED (${capped.join('; ')})` : ' — the API returned every run it holds'}`);
  console.log('');
  console.log(renderTable(groups));
  console.log('');
  const explained = rows.length - unexplained.length;
  console.log(`ARITHMETIC: ${rows.length} total = ${explained} explained across ${groups.length} group(s) + ${unexplained.length} unexplained`);
  if (unexplained.length) {
    console.log('');
    console.log('UNEXPLAINED RUNS, individually:');
    for (const u of unexplained) {
      console.log(`  · run ${u.id} · ${u.workflow} · ${u.branch} @ ${u.sha} · ${u.conclusion} · ${u.createdAt}`);
      console.log(`      job: ${u.job} › step: ${u.step}`);
      console.log(`      error: ${clip(u.error, 200)}`);
      console.log(`      signature: ${u.signature} · ${u.why} · ${u.proof}`);
    }
  }
  if (args.json) {
    writeFileSync(resolve(args.json), JSON.stringify({ range, capped, rows: result.rows, groups: groups.map((g) => ({ ...g, proofs: [...g.proofs] })), unexplained }, null, 1));
    console.log(`wrote ${args.json}`);
  }
  console.log('');
  console.log(`UNEXPLAINED: ${unexplained.length}`);
  if (capped.length) {
    console.error('✗ COVERAGE LOST — the enumeration was capped; the count above is over a SUBSET. Pass --since to bound it.');
    return 2;
  }
  return unexplained.length > 0 ? 1 : 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(`✗ COVERAGE LOST — ${e?.stack ?? e}`);
      process.exitCode = 2;
    },
  );
}
