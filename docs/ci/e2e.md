# `e2e.yml`

The prose that used to live inside `.github/workflows/e2e.yml`. The workflow keeps a
one-line `# why:` on each non-obvious decision; everything that explains,
retracts or records a measurement is here. Read `docs/ci/README.md` first —
it carries the rules every workflow in this repository has to obey.

## File header

### above `on:`

Full-stack end-to-end test of the deployed Subly app against LIVE Supabase auth
+ the live Cloudflare Worker + D1. A throwaway user is provisioned (confirmed)
before the run and purged after, so prod is left pristine.

Runs nightly + on demand — NOT on every push (it writes to live prod and takes
a few minutes). To also run per-push, add `push: { branches: [main] }` below.

Required repo secrets — ALL of them, on every run:
  SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE_URL,
  CLOUDFLARE_API_TOKEN (needs D1 read+write), CLOUDFLARE_ACCOUNT_ID,
  SUPABASE_SERVICE_ROLE_KEY

🔴 A MISSING SECRET IS A FAILED RUN, NOT A SKIPPED ONE — changed 2026-08-01.
This header used to read "if SUPABASE_SERVICE_ROLE_KEY is absent the job
green-skips (degrades gracefully)", and every real step carried
`if: steps.pre.outputs.run == 'true'`. The graceful degradation was a fully
green nightly run that executed one `echo` and tested nothing — and the `alert`
job below, gated on `failure()`, could not fire on it by construction. So the
day that secret was rotated, renamed or expired, the only end-to-end proof the
factory has against live Supabase + the live Worker + live D1 would have gone
dark reporting success, in the same workflow whose header memorialises six
unattended red nights nobody saw. Silence is not success, and neither is a
green tick over an empty run.

There is no secretless audience to protect: this workflow has no `push` or
`pull_request` trigger, so it never runs on a fork PR, and both triggers it
does have (schedule, workflow_dispatch) only ever run in this repository where
the secrets exist. Failing closed costs a contributor nothing and buys the
owner a red run — which the `alert` job turns into a durable GitHub issue.

tooling/ci/assert-green-means-ran.mjs §B enforces this structurally: the
preflight must exit non-zero, and no step may be `if:`-gated on its output.

### above `permissions:`

Least privilege, and this is the DEFAULT for every job that does not override
it. The e2e job below only reads the repo — it publishes nothing through
GITHUB_TOKEN. Without this every job ran at the repository-default scope, which
on a public repo is a standing hand-out to any compromised action. [pipeline F-11]

The `alert` job needs `issues: write` and declares that AT THE JOB LEVEL, which
REPLACES this block for that job alone rather than merging into it. That is the
whole reason alerting is a separate job: the job that holds
SUPABASE_SERVICE_ROLE_KEY and CLOUDFLARE_API_TOKEN must not also be handed a
token that can write to the issue tracker.

## job `prepare`

### above `prepare:`

── which apps does this factory hold? ──────────────────────────────────────
[pipeline 9]R-1: "adding an app requires no new or edited workflow file."
The nightly proof is a MATRIX over this output, so the set of apps driven
against live Supabase is the root pubspec's `workspace:` list and nothing
else. Identical to build-platforms.yml's `prepare`, and deliberately reading
through the SAME emitter — `assert-release-lane-generic.mjs --emit-apps` is
the guard that grades both lanes, so the set they iterate and the set they
are graded against cannot diverge. A second pubspec reader inlined here would
be the copy that quietly stops reading what it thinks it reads.

It has NO secret-presence preflight and needs none: it touches no secret, and
the `e2e` job below still fails closed on SUPABASE_SERVICE_ROLE_KEY for every
leg. It emits nothing on an empty workspace — it exits 1 — because a matrix
of `[]` runs zero legs and reports success, which is the exact green-over-
nothing this workflow's header was rewritten to remove.

## job `strategy`

### above `strategy:`

`fail-fast: false` — each app's nightly run is its own proof against live
production, and cancelling app #1's leg because app #2 regressed destroys
the evidence that would have told a real outage from one app's bug. It also
keeps the `always()` purge below reachable on every leg. With one app in the
workspace this changes nothing.

## job `with`

### above `with:`

persist-credentials: false — actions/checkout otherwise writes GITHUB_TOKEN
into .git/config and LEAVES it there for the whole job. Any later step that
packages the workspace (or anything containing .git/) ships the token inside
the artifact, and on a PUBLIC repo artifacts are downloadable. Nothing here
does git push/tag/commit, so none of these checkouts need the credential.
[zizmor artipacked] Verified 2026-07-27: no current artifact path includes
.git/ — so this closes a FUTURE mistake, not a live leak.

## job `e2e`

### before step **Preflight — the service-role secret must be present**

THE RUN IS EITHER POSSIBLE OR IT IS RED. Nothing downstream is gated on
this step's output — the job simply stops here, which is what makes the
`alert` job below reachable when the secret goes missing unattended.

### before step **Stamp this run's build identity (APP_VERSION)**

── THIS LANE'S BUILD IDENTITY, DERIVED ONCE ────────────────────────────
🔴 WITHOUT THIS THE NIGHTLY WROTE `dev` INTO PRODUCTION. e2e.yml passes
SUPABASE_URL, SUPABASE_ANON_KEY and API_BASE_URL, which is enough to make
`AppConfig.isBackendLive` true and open the REAL consent transport — but
it passed no APP_VERSION, so app_config.dart fell back to its compile-time
default `'dev'` and every row this lane wrote was indistinguishable from a
developer laptop's. Six such rows sat in platform_db from 2026-08-27 until
ops-watch run 33139423096 found them; record:
Private/notes/EVIDENCE-consent-artifacts-dev-rows-2026-08-28.md.

⛔ AND THE FIX IS NOT `PLATFORM_BASE_URL`. There is no staging Worker and
creating one is rejected: this workflow exists to prove the golden path
against LIVE Supabase + the LIVE Worker + LIVE D1, and ci.yml / assert-e2e
-proof-fresh.mjs treat that liveness as the thing asserted. B-17 states
verification against production is permitted and EXPECTED; what is
required is that it cleans up, and that a row it writes SAYS who wrote it.

⚠️ THE VALUE HAS TO FIT IN 32 CHARACTERS, and overflowing is WORSE than
`dev`. services/platform/src/routes/events.ts:378 binds it as
`str(body?.app_version, 32)`, and that helper returns NULL — not a
truncation — for anything longer, so an over-long stamp lands as a row
that fails the resolver carrying NO information at all.
  "e2e-" 4 + run_number + "-" 1 + sha7 7
  = 12 + len(run_number). Today's run numbers are 3 digits → 15 chars.
  At the 9-digit ceiling assert-app-versioning.mjs budgets for → 21 chars.
  Both are inside 32. A FULL 40-CHAR SHA WOULD RENDER 4+9+1+40 = 54 AND
  BE STORED AS NULL, which is why `${GITHUB_SHA::7}` and not `github.sha`.

DERIVED ONCE, ON THE ONE SHELL THAT HAS THE EXPANSION — the same rule
build-platforms.yml's `prepare` states, and for the same reason: GitHub
expressions have no substring, so a short sha can only come from bash, and
two hand-copied compositions are two things free to drift. Written to
$GITHUB_ENV so BOTH consumers read one string: the `flutter drive` define
below, and tooling/e2e/purge.mjs, whose failure message points a human at
exactly the rows this run could have written.

### before step **Set up ChromeDriver**

🔴 REPINNED 2026-09-03, AND THE OLD PIN WAS FROZEN RATHER THAN MERELY OLD.
It read `@ef5c64a9 # v2` — a real commit, but an UNTAGGED one (16 minutes
past v2.4.0, i.e. what the floating `v2` tag pointed at), and upstream has
since DELETED the `v2` tag entirely. Renovate cannot resolve a tag that no
longer exists, so it reported `Could not determine new digest for update`
and proposed nothing: this action had been receiving no updates at all
since March, silently, with the pin looking perfectly healthy in the diff.
⚠️ THAT IS THE FAILURE MODE SHA-PINNING BUYS AND `helpers:pinGitHubActionDigests`
is supposed to pay for — and it went unnoticed because nothing in this tree
checks that the `# vN` comment names a tag that still exists. The detector
is Renovate itself, which found it in its FIRST self-hosted run.
v3.0.0 is a TypeScript rewrite that states behavioural parity (same install
locations, same PATH resolution) and this repo passes it no inputs at all,
so the depended-on surface is unchanged. It also carries the download
retry/backoff and the `qs` DoS fix.

### before step **Provision the throwaway user the delete leg destroys**

🔴 A SECOND USER, BECAUSE LEG 6 DESTROYS THE ONE IT SIGNS IN WITH.
[pipeline N-6] leg 6 is "account delete purges", and the only honest way
to prove it is to let the app really delete a real account. That cannot
be the user above: `verify_row.mjs` asserts `COUNT(*) >= 1` for that id
AFTER the drive, so erasing it would turn leg 2's server-side proof red
for the exact reason leg 6 passed — one suite, two claims, and they must
not be able to falsify each other.

Same script, no arguments: `provision_user.mjs` writes `email`,
`password` and `user_id` to $GITHUB_OUTPUT, and step outputs are
per-step, so this `id:` is the whole separation. It needs no new secret.

### before step **Surface the failing assertion**

WHAT BROKE, ON THE RUN PAGE — not on line 370 of a 549-line log.

`flutter drive` reports an integration_test failure as one enormous
single-line JSON blob with the stack traces \n-escaped inside it. The
2026-08-01 failure ("Found 0 widgets with text \"Welcome back\"") was
fully present in the log of all six red nights and read by nobody,
because nothing carried it up to where a person looks. An `::error::`
annotation shows at the top of the run page and in the failure email; the
step summary keeps it after the log rotates.

Never gated on success: `if: failure()` only, so it cannot fire on a
green run and cannot itself turn one red (`|| true` on the extraction).

### before step **Verify the row landed in live D1**

⬜ `SUBLY_D1_DATABASE_ID` IS STILL APP-SPECIFIC, AND IS LEFT THAT WAY ON
PURPOSE. [9]R-1's acceptance is about hard-coded app PATHS, and every one
of those is now a matrix value — but this is a different animal: the app
id is in the VARIABLE NAME, because `tooling/e2e/verify_row.mjs` and
`purge.mjs` read `SUBLY_D1_DATABASE_ID` by that literal name, and the
value is a real per-app D1 database that only exists once an app has a
backend. Making it generic means changing those two scripts to take the
database id as an argument (and a per-app place to hold the id — the
channel register or the app's own config, not this file). That is a
different change with a different blast radius, in files this refactor
does not own. Forcing `${{ matrix.app }}` into an env-var name here would
produce `PROBE_D1_DATABASE_ID` that no script reads: a lane that LOOKS
generic and silently verifies nothing, which is worse than the honest
literal. App #2's leg will fail loudly on a missing id — the correct
outcome, and the thing that will force the real fix.

### before step **Verify the in-app deletion really purged (leg 6)**

── LEG 6's SERVER-SIDE HALF ────────────────────────────────────────────
The suite above tapped Delete account inside the running app and asserted
the app said "Account deleted". That is the app's own account of what
happened, and a server that deleted nothing and answered `{ ok: true }`
produces the identical green screen — the one failure a user can never
detect and never recover from. So the claim is re-read here, server-side,
with no app in the loop: the identity must be unresolvable through the
GoTrue admin API, and every schema-derived user-owned table in subly_db
must hold zero rows for it.

BEFORE the purge below, necessarily. `purge.mjs` would delete exactly the
rows this step exists to find, so running it first would make the audit
pass on a deletion that never happened.

NOT `if: always()` — a run that failed earlier never reached the delete
walk, and auditing a purge nobody performed reports a failure whose cause
is somewhere else entirely. The teardown below is what keeps prod clean
on that path.

### before step **Verify the consent artifact landed in platform_db**

── THE CONSENT LEG'S SERVER-SIDE HALF ──────────────────────────────────
The suite proves the DPDP prompt comes up on a fresh live launch and
answers it. It cannot prove the artifact ARRIVED, and the reason is in
the app by design: `_ConsentPrompt._answer` does not await the record
call, and `applyConsentDecision` treats the consent upload as best-effort
— a user's choice must not look rejected because the network is down.
So a `POST /v1/consent` that 404s, is shed by the rate limiter or never
leaves the browser gives the identical green run with an EMPTY §6(3)
trail, and nothing anywhere says so. This step is what says so.

⬜ `PLATFORM_D1_DATABASE_ID` IS A LITERAL FOR THE SAME REASON THE TWO
SUBLY IDS ABOVE ARE, and a weaker one besides: this database is SHARED by
the whole portfolio, so it is not even app-specific — there is exactly one
of it, named in services/platform/wrangler.jsonc, and a `${{ matrix.app }}`
in the variable NAME would produce something no script reads. `E2E_APP_ID`
is the matrix value, so the ROW is looked up per app even though the
database is not.

BEFORE the purges below, necessarily: the teardown deletes exactly the row
this step exists to find. NOT `if:`-gated, per the workflow header — a
step that can green-skip is a step that can go dark unnoticed.

### before step **Upload per-page screenshots**

`steps.user.outcome != 'skipped'` = "provisioning was ATTEMPTED", which is
the honest trigger for both cleanup steps: it is true when the run got far
enough to touch production (including when provisioning itself failed
halfway and may have left a user behind), and false when the job stopped
at the preflight — where there is nothing to purge and no screenshots to
collect. It replaces the old `steps.pre.outputs.run == 'true'` gate
without inheriting its green-skip.

### in step **Upload per-page screenshots**, above `name: e2e-screenshots-${{ matrix.app }}`

Per-app, and not for tidiness: `upload-artifact@v4` HARD-FAILS on a
second upload under a name that already exists in the run, so a fixed
name turns app #2's leg red on a step that is `if: always()` — i.e.
it would break the purge's own run. The `alert` job's body still says
"the e2e-screenshots artifact"; that prefix is what a reader matches.

### before step **Purge test data (always — keep prod pristine)**

🔴 THE CONSENT ENV IS ON THIS STEP AND NOT ON THE DELETE-LEG ONE BELOW,
and that asymmetry is the point rather than an oversight. The consent
artifact belongs to the BROWSER PROFILE, not to either throwaway user:
all three tests share one profile, the prompt is answered once, and one
row is written for the whole run. Handing the same anon_id to both purge
steps would issue the identical DELETE twice and print a confusing
`0 row(s)` the second time, as if something had gone missing.

Why it is deleted at all is in tooling/e2e/purge.mjs's header: left to
accumulate, these CI rows feed `analyticsLiveness` in
services/platform/src/scheduled.ts, which reads a consent row as evidence
that a HUMAN used a shipped build.

### before step **Purge the delete-leg user too (already gone on a green run)**

The delete-leg user gets the SAME teardown, and it is not redundant with
the app having deleted it. The deletion is the last thing the suite does,
so every earlier failure — a broken sign-in, a red assertion, a cancelled
run — leaves that account and its rows live in production. On the happy
path this is a no-op that reports `0 row(s)` and HTTP 404; on every other
path it is the only thing that cleans up. `purge.mjs` already tolerated
both (the D1 deletes are unconditional, 404 has always been forgiven), so
nothing was loosened to make this safe.

## job `alert`

### above `alert:`

── Alerting ────────────────────────────────────────────────────────────────
A test suite nobody watches is not a test suite. This workflow FAILED on 19,
20, 21, 22, 23 and 24 July 2026 — six consecutive unattended nights against
live Supabase, the live Worker and live D1 — and nothing responded, because
the only record of a red run was a line in a list nobody opens. Silence is
not success.

The signal is a GitHub issue. It is the only channel that costs nothing, adds
no service to the stack, and PERSISTS: a notification is read once and gone,
whereas an open issue sits on the repo until a human closes it — and closing
it is the acknowledgement that someone actually looked.

ONE issue, reused. Six failures must not become six issues; that is the noise
that gets a channel muted, which is the original bug wearing a different hat.
A new issue is opened only when no matching one is already open; otherwise the
failure is added as a comment (a comment still notifies subscribers, so the
escalation is not lost). The issue is deliberately NOT auto-closed on a later
green run — a human closing it is the only evidence anyone saw it.

SCHEDULED RUNS ONLY. A workflow_dispatch failure is attended by definition:
somebody is sitting there watching the run they just started. The defect is
specifically the unattended path, and alerting on manual runs would file an
issue every time someone iterates on a fix.

No `uses:` is added: `gh` is preinstalled on GitHub-hosted runners, so this
introduces no third-party action to SHA-pin and nothing new can go stale.

Since 2026-08-01 this also covers the MISSING-SECRET case: the preflight now
fails the job instead of green-skipping it, so the one condition under which
the nightly used to go dark silently is now a `failure()` this job reports.

### in step **File the failure against one durable issue**, above `TITLE: 'Nightly E2E (live) is failing against production'`

THE MARKER. Matched exactly, so rewording it means the next failure
opens a second issue next to the one already open.

