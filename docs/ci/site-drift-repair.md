# `site-drift-repair.yml`

The prose that used to live inside `.github/workflows/site-drift-repair.yml`. The workflow keeps a
one-line `# why:` on each non-obvious decision; everything that explains,
retracts or records a measurement is here. Read `docs/ci/README.md` first —
it carries the rules every workflow in this repository has to obey.

## File header

### above `on:`

── WHAT THIS REPAIRS, AND WHY NO PRE-MERGE LANE CAN ────────────────────────
sites/nikatru/sitemap.xml carries a <lastmod> per page, and
tooling/sites/lastmod.mjs derives that value from the page's GIT DATE
(`git log -1 --date=short --format=%ad -- <page>`, lastmod.mjs:89-94). So the
CORRECT value for a page a pull request changes is THE DATE THAT PULL REQUEST
MERGES — a date that does not exist while the pull request is open. Every
pre-merge lane is therefore structurally unable to hold this invariant:
ci.yml:701 runs check-site-integrity.mjs against a ref whose merge date is
still in the future, and it is right every time until the merge makes it wrong.

MEASURED IN THIS TREE, 2026-08-25:
  · at 51df9ef, `git show 51df9ef:sites/nikatru/sitemap.xml` gave <lastmod>
    2026-08-22 for /apps/ and /apps/subly, while `git log -1 --date=short`
    for sites/nikatru/apps/index.html and sites/nikatru/apps/subly.html both
    gave 2026-08-25 — so check-site-integrity's `e.lastmod !== expected` limb
    exited 1 ON MAIN, where there is no pull-request check left to go red.
  · the repair was made BY HAND in f67ee2b (2026-08-25 10:03:13 +0530),
    "sites: regenerate the sitemap after #363 — main went red the moment that
    PR merged (#369)" — 1 file, 2 insertions, 2 deletions.
  · the identical class was hand-repaired 16 days earlier in 6ea109d
    (2026-08-09 00:35:53 +0530) — 1 file, 1 insertion, 1 deletion.

🔴 THIS FILE IS THE MECHANISM, NOT AN INCIDENT RESPONSE. State on 2026-08-25 is
GREEN and was measured before this file was written:
`node tooling/ci/check-site-integrity.mjs . sites/nikatru sites/rajasekarselvam`
exits 0 ("11 sitemap <lastmod> value(s) equal their page's git date, across 2
root(s)") and `node tooling/ci/assert-discovery-surface.mjs` exits 0. Nothing
here is repairing a live defect; it is removing the hand that repaired the last
two.

── WHY A SEPARATE FILE AND NOT A JOB IN ci.yml ─────────────────────────────
A job that must run only on main needs a job-level `if:`, and
assert-green-means-ran.mjs section A6 ("NO CONDITIONAL CONSTITUENTS") fails any
lane `ci-gate` aggregates that carries one — a job that can be skipped is a
capability that can go dark under a green tick. A separate workflow needs no
`if:` at all, because `on: push: branches: [main]` IS the condition.

── WHY IT PROPOSES A PULL REQUEST RATHER THAN PUSHING ──────────────────────
`main` is protected. Pushing straight to it is a branch-protection change and
OWNER work; nothing in this file attempts it. The shape is the one
store-screenshots.yml already uses: `gh` rather than a third-party action (it
is preinstalled on the runner, so there is no extra 40-hex pin to look up and
get wrong), and the push URL carries the token explicitly because checkout
below sets `persist-credentials: false`.

A PULL REQUEST ALSO KEEPS THIS OUT OF assert-alert-disposition.mjs, whose
population is `FILES_AN_ISSUE = /gh issue create\b/` (that file:193). This
workflow files no issue, so it inherits no disposition obligation it would then
have to be exempted from.

── ⚠️ THE HONEST RESIDUAL: THIS SHORTENS THE WINDOW, IT DOES NOT CLOSE IT ──
Cloudflare's Git integration deploys sites/nikatru ON THE MERGE PUSH, with no
workflow involved and no GitHub check it could read. (That statement used to be
spelled out in ci.yml; the CI rebuild removed it, so it is stated here in full
rather than pointed at -- re-measured 2026-09-06, ci.yml carries no such text.) The stale sitemap therefore goes LIVE at the moment of merge and
stays live until the repair pull request merges. On 2026-08-25 that window was
14m49s (51df9ef 09:48:24 +0530 → f67ee2b 10:03:13 +0530) WITH A HUMAN WATCHING
AND ACTING. What changes here is that the repair is drafted, correct and
waiting instead of remembered. A zero window means pushing to protected main —
owner work, deliberately not attempted.

── ⚠️ WHY THIS DOES NOT FEED ITSELF ────────────────────────────────────────
`planDiscovery()` plans THIRTEEN files under sites/nikatru/ — twelve pages plus
sitemap.xml, measured this run — so "it only ever writes the sitemap" is NOT
true of the generator and must not be assumed. What bounds the loop is
lastmodFor() (tooling/sites/lastmod.mjs:122-133): a page the generator is
CHANGING is stamped `today()`, not its stale git date. So a repair PR that does
rewrite a page is already self-consistent for a same-day merge, and a cross-day
merge costs exactly ONE further sitemap-only round before the fixed point.
sitemap.xml is not itself listed in its own sitemap (10 <loc> entries on
nikatru, 1 on rajasekarselvam, none of them a sitemap), so the sitemap-only
round moves no <lastmod> at all and the next run finds nothing to do.
🔴 DO NOT WIDEN THIS JOB to write anything whose own git date the sitemap
quotes on a longer cycle. That is the edit that would make it self-perpetuating.

── 🔴 THE REDDENING MUTATION FOR THIS FILE, RECORDED AT THE SITE ───────────
NO NEW ASSERTION SHIPS HERE. The only new claim is "this workflow exists and
runs the generator on main", and its mutation is mechanical: DELETE THIS FILE.
Both guards that quantify over the workflow set then go red, and both name it.
Run in an isolated worktree on 2026-08-25, against a tree whose only failure
was a pre-existing host-local one (no `NIKATRU daily backup` scheduled task on
this machine), so the delta is entirely attributable:

  rm .github/workflows/site-drift-repair.yml
    node tooling/ci/assert-ops-register.mjs        -> exit 1, and the message
      changed from that one host problem to "COVERAGE LOST — duty.workflow
      .site-drift-repair.yml anchors at .github/workflows/site-drift-repair
      .yml, which is not among the 11 workflow(s) on disk."
    node tooling/ci/assert-enforcement-index.mjs   -> exit 1 (from 0), with 3
      differences, each naming this file: check-site-integrity.mjs,
      generate-discovery.mjs and lastmod.mjs are "WIRED by
      .github/workflows/site-drift-repair.yml#repair, and that workflow does
      not exist."

  …and the two halves are independently pinned, so neither can carry the other:
    delete only the register ROW, keep this file
      -> assert-ops-register.mjs exit 1: ".github/workflows/site-drift-repair
         .yml has NO `duty` row anchored at it."
    keep both, restore the PREVIOUS tooling/enforcement-index.json
      -> assert-enforcement-index.mjs exit 1: generate-discovery.mjs and
         lastmod.mjs "produced by this tree and missing from the committed
         index", plus check-site-integrity.mjs's invokedBy disagreeing.

⬜ MEASURED SIDE-EFFECT, worth stating: regenerating the index took it from 175
enforcers to 177. `tooling/sites/generate-discovery.mjs` and
`tooling/sites/lastmod.mjs` were in NO row before, because nothing in the
repository invoked either of them; this file is the first thing that does.

📌 APPENDED 2026-08-26 — ONE NEW ASSERTION NOW DOES SHIP HERE, so the
paragraph above is no longer the whole record. `Propose the repair` exits 1
with a named cause when `gh pr create` is refused (see the block at that step).
ITS REDDENING MUTATION, run against that step's own `run:` body with a `gh`
stub returning GitHub's refusal string verbatim: DELETE the `exit 1` and the
refused run exits 0 — green over a repair nobody was told about. Unmutated it
exits 1. A stub failing 503 instead also exits 1, on the generic limb.

### above `concurrency:`

deploy-workers.yml:24-25 and ops-watch.yml:36-37's shape, NOT ci.yml's. A run
of this workflow is the only thing that will notice the drift the merge just
created, so a newer push must QUEUE behind it and must never cancel it.
Cancelling is precisely the defect ci.yml:22 was changed to stop.

### above `permissions:`

Least privilege at the workflow level, exactly as every other workflow in this
tree does it. The write scopes live on the ONE job that needs them, which is
where assert-workflow-hardening.mjs:255 says a write scope belongs.

## job `permissions`

### above `permissions:`

THE NARROWEST SET THAT LETS THE REPAIR OUTLIVE ITS RUN, and each half is
used by exactly one command: `contents: write` pushes the branch,
`pull-requests: write` opens the pull request. Nothing here deploys, and
nothing here writes to main.

## job `repair`

### above `persist-credentials: false`

Nothing in this job uses a credential left in .git/config: the one
command that pushes builds its own remote URL from `github.token`
for that single command.

### above `fetch-depth: 0`

🔴 MANDATORY, NOT AN OPTIMISATION. lastmod.mjs's isShallowRepo()
(that file:82-85) makes check-site-integrity.mjs report COVERAGE LOST
on a shallow clone, because `git log` cannot answer a question about
history that was never fetched. ci.yml:699 carries this line for the
same reason and says so.

### before step **Regenerate the discovery surface**

THE GENERATOR, NOT THE GUARD. assert-discovery-surface.mjs regenerates
IN MEMORY and compares — its line 68 is an `import` of planDiscovery, not
a spawn — so it can tell you the tree is wrong and can never make it
right. Measured this run: `grep -rn generate-discovery .github/workflows/
package.json` matched NOTHING, so before this file no workflow in the
repository had ever invoked the writer.

### before step **Propose the repair (pull request)**

NO `if:` GATE, for assert-green-means-ran.mjs's reason: a step that can
be skipped is a capability that can go dark under a green tick. When
there is genuinely nothing to repair that is REPORTED, not skipped.

### before step **Preserve the computed repair**

`if: always()` — THE UPLOAD EXISTS FOR THE RUN WHERE THE STEP ABOVE
FAILED. Under the default success() it would be skipped on exactly the
run whose output a human needs, which is the whole point of it.

### in step **Preserve the computed repair**, above `if-no-files-found: error`

The step above writes into this directory on BOTH of its paths, so
an empty one means it never got that far — a finding, not a
nothing-to-do.

### before step **Site integrity — the repaired tree agrees with git**

🔴 RUNS AFTER THE PROPOSAL, DELIBERATELY, AND A NON-ZERO EXIT FAILS THE
JOB. This is the limb that covers sites/rajasekarselvam, which NO
generator writes — its one URL is hand-edited (lastmod 2026-08-04 on both
sides as measured today) and it carries the same merge-date exposure with
no automatic repair available at all. ORDERING MATTERS: if this ran
BEFORE the proposal, a drift in rajasekarselvam — which regenerating
cannot fix — would suppress the nikatru repair PR that regenerating CAN
fix. Proposing first and then failing gets both: the repair is waiting,
and the run is red for the part no machine can close.

Unlike a CANCELLED run, a FAILED run on the default branch is a signal a
human is shown: it appears as a failure in the Actions list and in the
push notification, rather than as a grey tick nobody reads.

