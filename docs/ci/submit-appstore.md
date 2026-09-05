# `submit-appstore.yml`

The prose that used to live inside `.github/workflows/submit-appstore.yml`. The workflow keeps a
one-line `# why:` on each non-obvious decision; everything that explains,
retracts or records a measurement is here. Read `docs/ci/README.md` first —
it carries the rules every workflow in this repository has to obey.

## File header

### above `on:`

[pipeline D-10] limb (i) — "a submission script exists AND RESOLVES TO A STEP
IN A WORKFLOW, parsed not grepped". This workflow is the step it resolves to.
tooling/channel-register.json's ios-appstore and macos-appstore rows both name
this file and this job in their `submission` block, so deleting either is a
register that points at nothing rather than an unnoticed loss.

🔴 DISPATCH-ONLY, AND THAT IS THE CORRECT SHAPE WHILE `served: false`.
Both rows are owner-deferred behind OWNER_QUEUE A-4 (Apple Developer Program,
$99/yr, plus an Apple device). There is no account to submit TO.

⚠️ IT BUILDS WHAT CAN BE BUILT WITHOUT A CERTIFICATE, AND SAYS SO.
This is the one place this workflow deliberately differs from
submit-windows-store.yml. Microsoft re-signs the MSIX, so that job packages a
real, submittable artifact. Apple does not: a `.ipa` and a Mac App Store `.pkg`
require a distribution certificate and a provisioning profile that OWNER_QUEUE
A-4 gates. So the job builds UNSIGNED — `flutter build ios --no-codesign` and
`flutter build macos` — which proves the Apple toolchain path still compiles
this app, and then runs the dry run with `--allow-missing-artifact`, which
makes the script SAY it validated the listing and the bundle identifier and
NOT the package. A job that claimed to validate an artifact it cannot produce
would be the more dangerous shape.

The script's `--submit` mode refuses with UNVERIFIED rather than guessing at
App Store Connect's endpoints.

🔴 SOURCED FLOOR, AND THE RUNNER LABEL DOES NOT PIN IT: uploads to App Store
Connect "must be built with Xcode 26 or later" (developer.apple.com/news/upcoming-requirements/,
in force 28 April 2026). `macos-26` names an image family; on run 32947213393
it carried Xcode 26.6 / macOS 26.5.2 / arm64. tooling/versions.json declares
`xcode: "26"`, so submit-appstore.mjs prints no floor warning here —
build-platforms.yml's assert-xcode-floor.mjs is what compares runner to key.

## job `gate`

### above `gate:`

Same shape and same reason as build-platforms.yml's gate job: this workflow
runs `flutter build --release`, and a release build from an ungated commit is
[pipeline R-6]'s whole subject. assert-release-provenance.mjs walks the
`needs` graph, so gating once here covers the job below.

### above `timeout-minutes: 25`

25, not 10, and the number comes from the script rather than from the clock:
assert-gate-passed.mjs POLLS for up to its own 1200 s default (this call
leaves `--timeout-seconds` unset), so any bound at or under 20 kills it
mid-poll and replaces "timed out waiting for ci-gate" with an opaque
cancellation. Kept byte-identical in all five `gate:` jobs. [pipeline F-5b]

## job `dry-run`

### above `timeout-minutes: 30`

30, and the number is headroom over a measurement rather than a neighbour:
run 32947213393 (2026-08-26) completed this job in 12m04s with all 12
steps green — iOS build 5m07s, macOS build 4m47s, no other step over 90s.

### before step **Toolchain under test**

When an Apple build breaks the first question is "what toolchain was
this?" — unrecoverable after the fact without this.

### before step **Build iOS (unsigned — no distribution certificate exists)**

UNSIGNED on purpose — see the header. This proves the app still compiles
for both Apple platforms; it does not produce a submittable artifact and
nothing here pretends it does.
🔴 UNSIGNED IS NOT THE SAME AS UNCONFIGURED, and until 2026-08-04 both
steps were both. `AppConfig.isBackendLive` compares each define below
against a PLACEHOLDER constant, so a build passing none of them resolves
`MockAuthRepository` and `SeedApiClient` — the artifact this submission
path validated was the DEMO build, with mock sign-in and seeded data, and
no crash sink either. That was found on the Google Play lane and is the
same defect on every store lane; deploy-web.yml had been passing all three
from secrets that already existed. Graded by
tooling/ci/assert-store-build-config.mjs, which derives the required set
from `isBackendLive` and the lanes from each store row's own declaration.

### before step **Dry-run the App Store submission (iOS)**

The credentials do not exist yet — OWNER_QUEUE A-4 creates the Apple
Developer account that issues the App Store Connect API key — and the
script reports their ABSENCE as a printed gap rather than a failure.
`secrets` are empty strings when unset, which is what the script's
presence check reads. The .p8 key is never read by the script, only
tested for presence.

### before step **Dry-run the App Store submission (macOS)**

A SEPARATE step and a SEPARATE secret for the app id, because these are
two App Store Connect records with independent review outcomes. Running
them as one step would make one failure look like two channels broken,
and one pass look like two channels validated.

