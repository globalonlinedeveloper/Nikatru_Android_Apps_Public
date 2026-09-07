#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-obfuscation-coupled.mjs — obfuscation and symbol upload are ONE
// increment, or neither.
//
// [pipeline 9]R-7 "Release builds are obfuscated with split debug info, and the
//                  symbols are retained so a crash report can still be read."
//
// ── WHY THIS IS A GUARD AND NOT A BUILD FLAG ─────────────────────────────────
// `--obfuscate --split-debug-info=<dir>` renames every Dart symbol in the AOT
// snapshot and writes the mapping to <dir>. The binary gets smaller and harder
// to read; so does every crash report it will ever produce. The mapping file is
// the ONLY thing that turns `_x12a` back into `SubscriptionRepository.refresh`,
// and it exists for exactly as long as the runner that produced it.
//
// So the failure this exists for is not "we forgot to obfuscate". It is the
// OTHER order: somebody adds `--obfuscate` because it is obviously good, the
// build goes green, nothing anywhere uploads the symbol directory, and the
// regression surfaces WEEKS LATER as a GlitchTip issue nobody can read — at
// which point the symbols for that release are gone and cannot be regenerated,
// because a rebuild produces a different mapping. There is no recovery, only a
// re-release. One flag, added in good faith, permanently blinds the crash sink
// for every build between it and the fix.
//
// The repository is currently on the safe side of that: zero build commands
// carry either flag (measured 2026-08-03). This guard exists so the day
// somebody adds one is the day they also add the upload, rather than the day
// six weeks later when a crash needs reading.
//
// ── WHAT COUNTS AS RETAINING THE SYMBOLS ─────────────────────────────────────
// Two shapes, both real, and the guard accepts either IN THE SAME JOB:
//   (a) a symbol upload to the crash sink — `sentry-cli … debug-files upload`,
//       `upload-dif`, `sentry_dart_plugin`, `upload-symbols`, an .dSYM upload;
//   (b) an `actions/upload-artifact` step whose `path:` names the SAME
//       directory the build passed to `--split-debug-info`.
// (b) is weaker than (a) — a 7-day retention is not an archive — but it is a
// real, checkable relationship, and refusing it would push the first honest
// implementation into disabling the guard. What is NOT accepted is an upload of
// some other directory, which is the shape that looks like coverage and is not.
//
// ── HOW IT MATCHES, AND WHY THAT IS THE CAREFUL PART ─────────────────────────
// 🔴 THE FLAG ON A BUILD COMMAND, NEVER THE BARE WORD. `.symbols` as a token
// matches `apps/subly/.gitignore:37`; the word "obfuscated" appears in a doc
// comment at `packages/platform_storage/lib/src/storage_capabilities.dart:43`.
// A guard that matched either would fire on correct input on day one and be
// switched off. Comments are blanked before anything is read — the
// `assert-stamp-platforms.mjs:37-42` lesson, where a comment kept a guard green
// after the real build step was deleted.
//
// ── CARRIED AS NOTES, NOT AS CODE ────────────────────────────────────────────
// · Breadcrumbs and `FlutterError.onError` belong BEFORE obfuscation, not after
//   — stage 11's to build. Obfuscating first makes the sink less useful, not
//   more.
// · Symbol upload targets the self-hosted GlitchTip whose DSN is already a
//   config key, so (a) needs no new credential surface — it needs an auth token,
//   which is owner work.
// · "Flutter Web has no symbol obfuscation at all" is UNVERIFIED — it rests on
//   a corpus summary, not a primary source — so NO web exemption is hard-coded
//   on it. If a web build ever passes `--obfuscate`, this guard asks the same
//   question it asks of every other target, and the answer can be "the flag was
//   a no-op, delete it".
//
// ── ➕ APPENDED 2026-09-03 · TWO OF THE NOTES ABOVE ARE NOW STALE, AND ONE ────
//    MEASUREMENT IS RE-TAKEN RATHER THAN ASSUMED TO HOLD.
//
// 🔬 RE-MEASURED TODAY: still ZERO. 16 `flutter build` commands across 13
// workflows, 0 of them carrying `--obfuscate` or `--split-debug-info` — the
// guard prints both numbers on every run, so the 2026-08-03 sentence above is
// re-confirmed rather than merely left standing. `.github/workflows/
// deploy-web.yml` gained `--source-maps` on this date and that is NEITHER flag:
// it makes the web build EMIT a mapping instead of renaming symbols, so it
// changes nothing this guard asks. Said explicitly because the next reader will
// see a symbol-adjacent flag land in a build command and wonder.
//
// ⚠️ "IT NEEDS AN AUTH TOKEN, WHICH IS OWNER WORK" IS DONE. `GLITCHTIP_TOKEN`
// exists as a repository secret and deploy-web.yml now uses it to upload the
// web bundle's SOURCE MAPS on every deploy. So shape (a) — an upload to the
// crash sink — is no longer hypothetical in this tree; it is live on one lane.
//
// ⛔ AND THAT UPLOAD IS NOT IN `SYMBOL_UPLOAD` BELOW, DELIBERATELY. Web source
// maps are not a split-debug-info directory, and this guard's question is
// strictly "did an obfuscating build retain ITS mapping". Adding the web lane's
// command to the accept list would widen what satisfies the guard without
// widening what it checks — a gate weakening dressed as coverage. What the next
// person WILL need: the day a mobile build starts obfuscating and uploads its
// symbols with `glitchtip-cli debug-files upload` or `dart-symbol-map` (both
// exist on that CLI, verified by running it), THOSE are the patterns to add
// here, and the addition is then load-bearing rather than cosmetic.
//
// ── ➕ APPENDED 2026-09-07 · THE GUARD GAINS A FLOOR, BECAUSE UNTIL TODAY IT ──
//    PASSED OVER AN EMPTY SET AND SAID SO.
//
// [ADR 067] decision 6 asks for `--obfuscate --split-debug-info` plus symbol
// upload on EVERY release build. The end-to-end audit of 2026-09-07 measured
// the result: 15 release `flutter build` commands across 7 workflows, **0**
// carrying either flag, and this guard printing
// `ok … 16 flutter build command(s), 0 obfuscating`, exit 0. Every sentence of
// that output was true and the obligation was entirely unmet — the coupling
// limb below asks "did an obfuscating build keep its mapping", and with nothing
// obfuscating it quantified over nothing. That is [C-COVERAGE-LOST-IS-NOT-PASS]
// exactly: an assertion that cannot fail, inflating apparent coverage.
//
// So there are now TWO limbs and they are different questions:
//
//   THE FLOOR (new)     every release build on a target Flutter can obfuscate
//                       MUST pass --obfuscate. Zero obfuscating release builds
//                       is exit 1, not ok. The count is printed either way.
//   THE COUPLING (old)  every build that DOES obfuscate must retain its mapping
//                       in its own job. Unchanged, and still the sharper of the
//                       two — the floor can be satisfied by a flag, the coupling
//                       cannot.
//
// ── WHY WEB IS EXEMPT, AND WHY THAT IS NOT AN ALLOWLIST ──────────────────────
// The 2026-08-03 note below left web unexempted because the claim "Flutter Web
// has no symbol obfuscation" rested on a corpus summary. It has since been read
// from the primary source: docs.flutter.dev/deployment/obfuscate lists the
// targets obfuscation applies to — `aar, apk, appbundle, ios, ios-framework,
// ipa, linux, macos, macos-framework, windows` — and states "Web apps don't
// support obfuscation. A web app can be minified…". So the exemption is not a
// judgement about web, it is the toolchain's own domain, and it is written here
// as that list rather than as a list of things to skip: a target outside BOTH
// sets is COVERAGE LOST naming the target, because a Flutter release that grows
// a new target must not fall silently outside this floor. `deploy-web.yml`
// carries web's own separate obligation (`--source-maps` plus an upload) and is
// not this guard's subject.
//
// ── ➕ AND `glitchtip-cli` IS NOW IN `SYMBOL_UPLOAD` ─────────────────────────
// The 2026-09-03 note below predicted the day: "the day a mobile build starts
// obfuscating and uploads its symbols with `glitchtip-cli debug-files upload`
// … THOSE are the patterns to add here, and the addition is then load-bearing
// rather than cosmetic." That day is today, so both the CLI call and this
// repository's wrapper for it (`tooling/ops/upload-native-symbols.mjs`, which
// exists because the CLI exits 0 over an empty directory, over failed chunks
// and over an assembly that never completed) are accepted. `dart-symbol-map
// upload` is deliberately NOT accepted: GlitchTip has no code that reads a Dart
// obfuscation map, so a lane doing only that would be retaining nothing.
//
// Usage:  node tooling/ci/assert-obfuscation-coupled.mjs [repoRoot]
// Exit 0 = every release build obfuscates, and no build obfuscates without
//          retaining its symbols.
// ─────────────────────────────────────────────────────────────────────────────
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllWorkflows, shellSegments } from './workflow-scan.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

/** A Flutter build command. `web-server` is a dev server, not an artifact. */
const BUILD_CMD = /flutter\s+build\s+(?!web-server\b)\S+/;

/** The build TARGET, for the floor's domain. */
const BUILD_TARGET = /flutter\s+build\s+(\S+)/;

/** A release build. `--release` is Flutter's own word for it, and a build
 *  without it is a debug or profile artifact nobody ships. */
const RELEASE = /--release(?=\s|$)/;

/** DECLARED, from Flutter's own documentation rather than from taste:
 *  docs.flutter.dev/deployment/obfuscate — "Obfuscation is supported on these
 *  targets". A release build on one of these MUST obfuscate. */
const OBFUSCATABLE_TARGETS = new Set([
  'aar', 'apk', 'appbundle', 'ios', 'ios-framework', 'ipa',
  'linux', 'macos', 'macos-framework', 'windows',
]);

/** DECLARED, same source: "Web apps don't support obfuscation." A target in
 *  NEITHER set is COVERAGE LOST — see the header. */
const NON_OBFUSCATABLE_TARGETS = new Set(['web', 'web-server', 'bundle']);

/** The two flags that make a build unreadable without its mapping file. */
const OBFUSCATE = /--obfuscate\b/;
const SPLIT_DEBUG = /--split-debug-info(?:=|\s+)(\S+)/;

/** (a) — a real symbol upload to a crash sink. Named, not heuristic: a
 *  heuristic that stops matching reports "clean", which is the failure mode
 *  this whole family of guards exists to remove. */
const SYMBOL_UPLOAD = [
  /sentry-cli[^\n]*\b(debug-files|difutil)\b[^\n]*\bupload\b/,
  /sentry-cli[^\n]*\bupload-dif\b/,
  /sentry-cli[^\n]*\bupload-dsym\b/,
  /sentry_dart_plugin/,
  /upload-symbols/,
  /getsentry\/action-release/,
  /symbol-collector/,
  // GlitchTip's own CLI, added 2026-09-07 when the first native lane started
  // uploading. `debug-files upload` is the DIF path the server implements;
  // `dart-symbol-map upload` is NOT here because GlitchTip stores nothing from
  // it. The wrapper is accepted alongside the bare call because it is what this
  // repository actually invokes, and it exists to make the CLI's exit code mean
  // what it says.
  /glitchtip-cli[^\n]*\bdebug-files\b[^\n]*\bupload\b/,
  /upload-native-symbols\.mjs/,
];

const problems = [];
const notes = [];

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-obfuscation-coupled: FAILED');
  process.exit(1);
}

const workflows = parseAllWorkflows(ROOT);
if (workflows.length === 0) {
  coverageLost([
    `no workflow files were parsed under ${ROOT}/.github/workflows.`,
    'Every question below is asked of build commands in workflows. With none read, the guard would',
    'report "no build obfuscates without retaining its symbols" over an empty set — the exact shape',
    'this repo has shipped twice.',
  ]);
}

// A stripper that ate the file makes every question below run over an empty
// string and answer "nothing to check".
for (const wf of workflows) {
  if (wf.rawStepCount > 0 && wf.strippedStepCount === 0) {
    coverageLost([
      `${wf.rel} has ${wf.rawStepCount} step(s) and NONE survived comment stripping.`,
      'The build-command scan below would then range over nothing and print ok.',
    ]);
  }
}

/** Every `path:` value inside a job, one per line — enough to answer "does an
 *  upload step name this directory" without a full YAML model. */
const uploadedPaths = (job) => {
  const out = [];
  let inUpload = false;
  for (const l of job.logical) {
    if (/^\s*-\s+(uses|name):/.test(l.text)) inUpload = false;
    if (/actions\/upload-artifact/.test(l.text)) inUpload = true;
    if (!inUpload) continue;
    const m = l.text.match(/^\s*(?:path:\s*)?(\S.*?)\s*$/);
    if (m && !/^(?:-\s+)?(uses|with|name|if|id):/.test(m[1])) out.push(m[1].replace(/^path:\s*/, '').replace(/^-\s*/, ''));
  }
  return out;
};

let buildsChecked = 0;
let obfuscating = 0;
let releaseBuilds = 0;
let webReleaseBuilds = 0;
const unknownTargets = [];

for (const wf of workflows) {
  for (const job of wf.jobs.values()) {
    const jobText = job.logical.map((l) => l.text).join('\n');
    const hasSinkUpload = SYMBOL_UPLOAD.some((re) => re.test(jobText));
    const paths = uploadedPaths(job);

    for (const l of job.logical) {
      for (const seg of shellSegments(l.text)) {
        if (!BUILD_CMD.test(seg)) continue;
        buildsChecked++;
        const obf = OBFUSCATE.test(seg);
        const split = SPLIT_DEBUG.exec(seg);

        const at = `${wf.rel}:${l.n} (job "${job.name}")`;

        // ── THE FLOOR ─────────────────────────────────────────────────────
        // Its domain is a RELEASE build on a target Flutter can obfuscate.
        // A target in neither declared set is COVERAGE LOST, not a skip:
        // silently falling outside a floor is how a floor stops being one.
        const target = (BUILD_TARGET.exec(seg)?.[1] ?? '').replace(/^['"]|['"]$/g, '');
        if (!OBFUSCATABLE_TARGETS.has(target) && !NON_OBFUSCATABLE_TARGETS.has(target)) {
          unknownTargets.push(`${at} builds target "${target}"`);
        } else if (RELEASE.test(seg)) {
          if (OBFUSCATABLE_TARGETS.has(target)) {
            releaseBuilds++;
            if (!obf) {
              problems.push(
                `${at} is a RELEASE build of "${target}" and does not pass --obfuscate. ` +
                  '[ADR 067] decision 6: every release build is obfuscated with split debug info and its ' +
                  'symbols retained. An un-obfuscated release ships every Dart symbol name in the binary, ' +
                  'and the audit of 2026-09-07 found 15 of these and zero obfuscating — which this guard ' +
                  'reported as "ok, 0 obfuscating" because it had no floor. Add ' +
                  `--obfuscate --split-debug-info=<dir> and retain <dir> in job "${job.name}".`,
              );
            }
          } else {
            webReleaseBuilds++;
          }
        }

        if (!obf && !split) continue;
        obfuscating++;

        // The two flags travel together or the build is broken in a way no
        // upload can repair: `--obfuscate` with no `--split-debug-info` writes
        // NO mapping file anywhere, so the symbols do not exist to be kept.
        if (obf && !split) {
          problems.push(
            `${at} passes --obfuscate with no --split-debug-info. Flutter then writes no symbol mapping ` +
              'at all, so every crash report from this build is permanently unreadable — there is nothing ' +
              'to upload and nothing to recover. The two flags are one flag.',
          );
          continue;
        }
        if (!obf && split) {
          // Harmless on its own (symbols split out of a non-obfuscated binary
          // are still readable in the binary), so this is a NOTE, not a failure.
          notes.push(`${at} passes --split-debug-info without --obfuscate — the binary is still readable, so nothing is lost; the flag is doing less than it looks like.`);
          continue;
        }

        const dir = split[1].replace(/^['"]|['"]$/g, '');
        const named = paths.some((p) => p.includes(dir) || dir.includes(p.replace(/\/\*+$/, '')));
        if (hasSinkUpload || named) continue;

        problems.push(
          `${at} obfuscates into "${dir}" and nothing in job "${job.name}" retains it. ` +
            'A rebuild produces a DIFFERENT mapping, so the symbols for this release exist only on this ' +
            'runner and only until it is reclaimed — after that every crash report from the build is ' +
            'unreadable and cannot be made readable. Upload the symbols to the crash sink in the same ' +
            `job, or upload "${dir}" as an artifact in the same job, or drop --obfuscate.`,
        );
      }
    }
  }
}

if (buildsChecked === 0) {
  coverageLost([
    `parsed ${workflows.length} workflow file(s) and found ZERO \`flutter build\` commands.`,
    'This guard only ever speaks about build commands, so with none found it has nothing to say and',
    'would say "ok" — indistinguishable from a matcher that has stopped matching. build-platforms.yml',
    'alone carries six.',
  ]);
}

if (unknownTargets.length) {
  coverageLost([
    `${unknownTargets.length} \`flutter build\` command(s) name a target this guard has no verdict for:`,
    ...unknownTargets,
    'The floor below asks "does every release build on an obfuscatable target obfuscate", and both',
    'sets are DECLARED from docs.flutter.dev/deployment/obfuscate. An unrecognised target is not a',
    'pass — it is a target that would fall outside the floor in silence. Put it in',
    'OBFUSCATABLE_TARGETS or NON_OBFUSCATABLE_TARGETS, with the doc line that says which.',
  ]);
}

if (releaseBuilds === 0) {
  coverageLost([
    `parsed ${workflows.length} workflow file(s), found ${buildsChecked} \`flutter build\` command(s) and`,
    'ZERO of them a release build on a target Flutter can obfuscate — so the floor has no subject and',
    'would report "every release build obfuscates" over an empty set. That is precisely the shape this',
    'guard printed for a month while [ADR 067] decision 6 went unmet. build-platforms.yml alone carries',
    'six release builds across linux, android, windows, macOS and iOS.',
  ]);
}

if (problems.length) {
  console.error(
    `✗ obfuscation — ${problems.length} problem(s) over ${releaseBuilds} release build(s), ${obfuscating} obfuscating:`,
  );
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline 9]R-7 — obfuscation and symbol retention are one increment or neither.');
  console.error('  [ADR 067] decision 6 — every release build obfuscates and keeps its symbols.');
  console.error('  See the header of tooling/ci/assert-obfuscation-coupled.mjs for why the order matters.');
  process.exit(1);
}

if (notes.length) {
  console.log('⬜ notes, printed not hidden:');
  for (const n of notes) console.log(`    ${n}`);
}

console.log(
  `ok  obfuscation — ${workflows.length} workflow(s), ${buildsChecked} \`flutter build\` command(s), ` +
    `${releaseBuilds} release build(s) on an obfuscatable target, ${obfuscating} obfuscating; ` +
    `FLOOR: all ${releaseBuilds} of them pass --obfuscate. COUPLING: every obfuscating build retains ` +
    `its symbol mapping in its own job. ${webReleaseBuilds} web release build(s) are outside the floor ` +
    'because Flutter does not support obfuscation on web',
);
