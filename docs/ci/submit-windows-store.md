# `submit-windows-store.yml`

The prose that used to live inside `.github/workflows/submit-windows-store.yml`. The workflow keeps a
one-line `# why:` on each non-obvious decision; everything that explains,
retracts or records a measurement is here. Read `docs/ci/README.md` first —
it carries the rules every workflow in this repository has to obey.

## File header

### above `on:`

[pipeline D-10] limb (i) — "a submission script exists AND RESOLVES TO A STEP
IN A WORKFLOW, parsed not grepped". This workflow is the step it resolves to.
tooling/channel-register.json's windows-store row names this file and this job
in its `submission` block, so deleting either is a register that points at
nothing rather than an unnoticed loss.

🔴 DISPATCH-ONLY, AND THAT IS THE CORRECT SHAPE WHILE `served: false`.
The channel has no publisher account (OWNER_QUEUE A-2) and the MSIX package
identity is still the PARTNER-CENTER-PENDING sentinel, so there is nothing to
submit TO. What this proves on demand is that the path from source to a
validated, store-shaped package still WALKS — the listing tree is complete and
derived from the spec, the .msix actually builds, and the identity the register
declares is the identity `msix` packages. That is the whole of D-10's promise:
submission #2 costs minutes, not archaeology. Submission #1 costs the account.

⚠️ IT RUNS THE REAL THING, NOT A DOUBLE. The dry run is deliberately NOT given
--allow-missing-artifact: the job builds Windows and packages the MSIX first,
so the script validates a package that exists on disk. A dry run that skipped
the artifact would report the path healthy while never touching the one output
the channel actually accepts.

The script's `--submit` mode refuses with UNVERIFIED rather than guessing at
Partner Center's endpoints.

## job `gate`

### above `gate:`

Same shape and same reason as build-platforms.yml's gate job: this workflow
runs a `flutter build --release`, and a release build from an ungated commit
is [pipeline R-6]'s whole subject. assert-release-provenance.mjs walks the
`needs` graph, so gating once here covers the job below.

### above `timeout-minutes: 25`

25, not 10, and the number comes from the script rather than from the clock:
assert-gate-passed.mjs POLLS for up to its own 1200 s default (this call
leaves `--timeout-seconds` unset), so any bound at or under 20 kills it
mid-poll and replaces "timed out waiting for ci-gate" with an opaque
cancellation. Kept byte-identical in all five `gate:` jobs. [pipeline F-5b]

## job `dry-run`

### above `timeout-minutes: 20`

20, and the number is headroom over a measurement rather than a neighbour:
run 32947216531 (2026-08-26) completed this job in 8m32s with all 11 steps
green, including a real `dart run msix:create` — windows build 5m10s.

### before step **Build windows**

The backend defines. Without them `AppConfig.isBackendLive` stays false —
every field is still at its PLACEHOLDER — and the .msix packaged below is
the DEMO build: mock sign-in, seeded data, no crash sink. Found on the
Google Play lane 2026-08-04 and true of every store lane in the tree;
graded by tooling/ci/assert-store-build-config.mjs.

### before step **Dry-run the Microsoft Store submission**

The credentials do not exist yet — OWNER_QUEUE A-2 creates the Partner
Center account that issues them — and the script reports their ABSENCE as
a printed gap rather than a failure. `secrets` are empty strings when
unset, which is what the script's presence check reads.

