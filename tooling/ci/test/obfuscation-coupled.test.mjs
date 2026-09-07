// ─────────────────────────────────────────────────────────────────────────────
// obfuscation-coupled.test.mjs — assert-obfuscation-coupled.mjs must be able to
// FAIL, on BOTH of its limbs.
//
// 🔴 THE REAL-TREE RUN CAME FIRST AND THESE FIXTURES ENCODE WHAT IT SHOWED.
// Six mutations were run against a full COPY of this repository on 2026-08-03,
// all six caught, all six restored byte-identically and re-run green:
//
//   1. `flutter build linux --release --obfuscate --split-debug-info=build/
//      symbols` in build-platforms.yml with no retention anywhere in the job
//      ⇒ exit 1 naming the directory and the job.
//   2. `--obfuscate` with NO `--split-debug-info` ⇒ exit 1 with the different,
//      sharper message: Flutter writes no mapping at all, so there is nothing
//      to upload and nothing to recover.
//   3. the same obfuscating build PLUS `sentry-cli debug-files upload` in the
//      same job ⇒ exit 0. Written before (1), because a guard that rejects the
//      unfamiliar is not a guard.
//   4. the same obfuscating build PLUS an `actions/upload-artifact` whose
//      `path:` names `build/symbols` ⇒ exit 0.
//   5. the `flutter build` matcher broken to `flutterr` ⇒ COVERAGE LOST, not a
//      pass — the 13 real build commands are what this guard speaks about.
//   6. a COMMENT reading "we deliberately do not pass --obfuscate
//      --split-debug-info=build/symbols here" ⇒ exit 0. This is the case the
//      repo has lost twice before ([1]F-10, assert-stamp-platforms.mjs:37-42).
//
// ── ➕ APPENDED 2026-09-07 · THE FLOOR ARRIVED AND FOUR CASES ABOVE CHANGED ──
//    ANSWER. THE OLD WORDING IS LEFT STANDING; THIS IS WHAT SUPERSEDES IT.
//
// The guard gained a FLOOR: every release build on a target Flutter can
// obfuscate must pass `--obfuscate`. So the tree state cases 1–6 were written
// against — "zero builds obfuscate, and that is fine" — is now a FAILURE, and
// three cases here flip with it:
//
//   · the old case 6 (a comment naming the flags) asserted exit 0 over a
//     release build that does not obfuscate. That is now exit 1 ON THE FLOOR,
//     and it proves MORE than it used to: the comment did not make the build
//     look obfuscated, and the failure says `0 obfuscating` while naming the
//     flags in the comment right above it.
//   · `--split-debug-info` without `--obfuscate` is still a NOTE and not a
//     coupling failure, but on a RELEASE build the floor now fails it — so that
//     case moved to a non-release build, where the note is the only verdict.
//   · the two false-alarm-surface cases (`app.*.symbols` in a .gitignore, the
//     word "obfuscated" in Dart prose) were asserting exit 0 on a fixture whose
//     build no longer clears the floor, so they now use the COMPLIANT fixture.
//     What they test is unchanged: neither surface is a build command.
//
// And FOUR cases are new, in the order the repo requires — GREEN CONTROL FIRST,
// then the mutation that must fail:
//
//   7. GREEN CONTROL — a release build that obfuscates and retains ⇒ exit 0,
//      and the output states the floor it applied.
//   8. MUTATION of exactly that fixture — `--obfuscate` removed from ONE of two
//      release builds ⇒ exit 1 naming that build, that job and that target,
//      with the other still counted.
//   9. a `flutter build web --release` is OUTSIDE the floor and said so, from
//      Flutter's own documented target list rather than from taste.
//  10. a tree whose only release build is web ⇒ COVERAGE LOST. The floor with
//      no subject is the vacuous pass this whole change removes.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-obfuscation-coupled.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-obf-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

function fixture(workflows) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  for (const [name, body] of Object.entries(workflows)) {
    writeFileSync(join(root, '.github', 'workflows', name), body);
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** A build job in the shape build-platforms.yml really has: a folded `run: >`
 *  command, then an upload-artifact step. `target` and `release` are parameters
 *  so a fixture can sit inside or outside the floor's domain deliberately. */
const wf = ({
  buildFlags = '',
  extraSteps = '',
  uploadPaths = 'apps/subly/build/linux/x64/release/bundle',
  comment = '',
  target = 'linux',
  release = ' --release',
} = {}) => `name: Build
on:
  workflow_dispatch:

jobs:
  linux:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
${comment}      - name: Build ${target}
        working-directory: apps/subly
        run: >
          flutter build ${target}${release}${buildFlags}
          --dart-define=GLITCHTIP_DSN=x
${extraSteps}      - uses: actions/upload-artifact@v4
        with:
          name: subly-${target}
          path: |
            ${uploadPaths}
          retention-days: 7
`;

/** A second job that clears the floor on its own, so a fixture can be about the
 *  COUPLING limb without the floor's own COVERAGE LOST getting there first. */
const FLOOR_ANCHOR = `
  anchor:
    runs-on: ubuntu-24.04
    steps:
      - name: Build macos
        working-directory: apps/subly
        run: >
          flutter build macos --release
          --obfuscate --split-debug-info=build/symbols/macos
      - uses: actions/upload-artifact@v4
        with:
          name: symbols-subly-macos
          path: |
            apps/subly/build/symbols/macos
          retention-days: 90
`;

/** The state the tree is IN after 2026-09-07: obfuscating and retaining. */
const COMPLIANT = wf({
  buildFlags: ' --obfuscate --split-debug-info=build/symbols/linux',
  uploadPaths: 'apps/subly/build/linux/x64/release/bundle\n            apps/subly/build/symbols/linux',
});

describe('assert-obfuscation-coupled', () => {
  // ── THE FLOOR ─────────────────────────────────────────────────────────────
  test('GREEN CONTROL — a release build that obfuscates and retains passes, and says which floor it applied', () => {
    const { code, out } = run(fixture({ 'build.yml': COMPLIANT }));
    assert.equal(code, 0, out);
    assert.match(out, /1 release build\(s\) on an obfuscatable target, 1 obfuscating/);
    assert.match(out, /FLOOR: all 1 of them pass --obfuscate/);
  });

  test('MUTATION of that control — --obfuscate removed from one of two release builds ⇒ exit 1 naming it', () => {
    // Byte-identical to the control above except for the anchor job, whose
    // build carries NO --obfuscate. One release build still obfuscates, so this
    // is the floor failing on a per-command basis and not on a bare count.
    const mutated = FLOOR_ANCHOR.replace('          --obfuscate --split-debug-info=build/symbols/macos\n', '');
    const { code, out } = run(fixture({ 'build.yml': `${COMPLIANT}${mutated}` }));
    assert.equal(code, 1, out);
    assert.match(out, /is a RELEASE build of "macos" and does not pass --obfuscate/);
    assert.match(out, /job "anchor"/);
    assert.match(out, /over 2 release build\(s\), 1 obfuscating/);
    assert.match(out, /\[ADR 067\] decision 6/);
  });

  test('FAILS on a tree whose release builds obfuscate nothing — the state ADR 067 decision 6 forbids', () => {
    const { code, out } = run(fixture({ 'build.yml': wf() }));
    assert.equal(code, 1, out);
    assert.match(out, /over 1 release build\(s\), 0 obfuscating/);
    assert.match(out, /does not pass --obfuscate/);
  });

  test('a `flutter build web --release` is outside the floor, and the guard says so rather than passing over it', () => {
    const root = fixture({ 'build.yml': `${COMPLIANT}
  web:
    runs-on: ubuntu-24.04
    steps:
      - name: Build web
        working-directory: apps/subly
        run: >
          flutter build web --release
          --dart-define=GLITCHTIP_DSN=x
` });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /1 release build\(s\) on an obfuscatable target/);
    assert.match(out, /1 web release build\(s\) are outside the floor/);
  });

  // ⏱ INVERTED 2026-09-07 (fix pass). This case READ:
  //     "a build that is not a --release build is outside the floor" ⇒ exit 0.
  // It was WRONG, and it locked the wrong answer in as intended behaviour. The
  // guard-integrity reviewer proved it on the real tree: delete `--release`
  // from `flutter build linux`, delete its `--obfuscate`, and the guard printed
  // `ok … 12 release build(s), 12 obfuscating`, code=0 — a shipping,
  // un-obfuscated Linux release had left the floor and NOTHING named it.
  // `flutter build <target>` defaults to release mode, so the flag was
  // decoration. The domain is now keyed on the ABSENCE of --debug/--profile.
  test('a build with NO mode flag is INSIDE the floor — flutter build defaults to release', () => {
    const root = fixture({ 'build.yml': `${wf({ release: '' })}${FLOOR_ANCHOR}` });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /is a RELEASE build of "linux" and does not pass --obfuscate/);
    assert.match(out, /over 2 release build\(s\), 1 obfuscating/);
  });

  test('GREEN CONTROL for that inversion — the same build WITH --obfuscate passes at 2 of 2', () => {
    const compliantNoFlag = wf({
      release: '',
      buildFlags: ' --obfuscate --split-debug-info=build/symbols/linux',
      uploadPaths: 'apps/subly/build/linux/x64/release/bundle\n            apps/subly/build/symbols/linux',
    });
    const { code, out } = run(fixture({ 'build.yml': `${compliantNoFlag}${FLOOR_ANCHOR}` }));
    assert.equal(code, 0, out);
    assert.match(out, /2 release build\(s\) on an obfuscatable target, 2 obfuscating/);
  });

  test('an EXPLICIT --debug leaves the floor, and the guard NAMES the build that left', () => {
    const root = fixture({ 'build.yml': `${wf({ release: ' --debug' })}${FLOOR_ANCHOR}` });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /1 release build\(s\) on an obfuscatable target, 1 obfuscating/);
    assert.match(out, /1 build\(s\) are outside it on an EXPLICIT --debug\/--profile/);
    assert.match(out, /builds "linux" in --debug mode/);
  });

  test('an EXPLICIT --profile leaves it the same way, and is named the same way', () => {
    const root = fixture({ 'build.yml': `${wf({ release: ' --profile' })}${FLOOR_ANCHOR}` });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /builds "linux" in --profile mode/);
  });

  test('a tree where nothing opts out says so, rather than printing nothing', () => {
    const { code, out } = run(fixture({ 'build.yml': COMPLIANT }));
    assert.equal(code, 0, out);
    assert.match(out, /no build claims --debug or --profile, so nothing left the floor by opting out/);
  });

  test('COVERAGE LOST on --release AND --profile together — a command with two modes has no answer', () => {
    const root = fixture({ 'build.yml': `${wf({ release: ' --release --profile' })}${FLOOR_ANCHOR}` });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /name TWO build modes at once/);
    assert.match(out, /passes --release AND --profile on the same command/);
  });

  test('COVERAGE LOST on `bundle`, which was an UNSOURCED exemption until today', () => {
    // `bundle` sat in NON_OBFUSCATABLE_TARGETS cited to a doc page that names
    // only web. It exempted nothing in the tree, so it is removed and the
    // COVERAGE LOST limb answers for it — an unsourced exemption is not a pass.
    const root = fixture({ 'build.yml': `${wf({ target: 'bundle' })}${FLOOR_ANCHOR}` });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /builds target "bundle"/);
  });

  test('COVERAGE LOST when the only release build is one Flutter cannot obfuscate', () => {
    const root = fixture({
      'build.yml': `name: Build
on:
  workflow_dispatch:

jobs:
  web:
    runs-on: ubuntu-24.04
    steps:
      - name: Build web
        run: flutter build web --release
`,
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO of them a release build/);
  });

  test('COVERAGE LOST on a build target neither declared set has a verdict for', () => {
    const root = fixture({
      'build.yml': `${COMPLIANT}
  novel:
    runs-on: ubuntu-24.04
    steps:
      - name: Build something new
        run: flutter build fuchsia --release
`,
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /builds target "fuchsia"/);
  });

  // ── the coupling limb the guard shipped with ──────────────────────────────
  test('FAILS when a build obfuscates and nothing in its job retains the symbols', () => {
    const { code, out } = run(fixture({ 'build.yml': wf({ buildFlags: ' --obfuscate --split-debug-info=build/symbols' }) }));
    assert.equal(code, 1);
    assert.match(out, /obfuscates into "build\/symbols" and nothing in job "linux" retains it/);
    assert.match(out, /A rebuild produces a DIFFERENT mapping/);
  });

  test('FAILS differently when --obfuscate carries no --split-debug-info at all', () => {
    const { code, out } = run(fixture({ 'build.yml': wf({ buildFlags: ' --obfuscate' }) }));
    assert.equal(code, 1);
    assert.match(out, /passes --obfuscate with no --split-debug-info/);
    assert.match(out, /nothing to upload and nothing to recover/);
  });

  // ── the false-alarm cases, written FIRST ──────────────────────────────────
  test('a symbol upload to the crash sink in the SAME job satisfies it', () => {
    const root = fixture({
      'build.yml': wf({
        buildFlags: ' --obfuscate --split-debug-info=build/symbols',
        extraSteps: '      - name: Upload symbols\n        run: sentry-cli debug-files upload --include-sources build/symbols\n',
      }),
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /1 obfuscating/);
  });

  test('glitchtip-cli debug-files upload satisfies it — the sink this factory actually runs', () => {
    const root = fixture({
      'build.yml': wf({
        buildFlags: ' --obfuscate --split-debug-info=build/symbols',
        extraSteps: '      - name: Upload symbols\n        run: "$RUNNER_TEMP/glitchtip-cli" debug-files upload --wait build/symbols\n',
      }),
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /1 obfuscating/);
  });

  test("this repo's wrapper for that CLI satisfies it too", () => {
    const root = fixture({
      'build.yml': wf({
        buildFlags: ' --obfuscate --split-debug-info=build/symbols',
        extraSteps: '      - name: Upload symbols\n        run: node tooling/ops/upload-native-symbols.mjs --dir build/symbols --org nikatru --project subly\n',
      }),
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  test('a dart-symbol-map upload does NOT satisfy it — GlitchTip stores nothing from one', () => {
    const root = fixture({
      'build.yml': wf({
        buildFlags: ' --obfuscate --split-debug-info=build/symbols',
        extraSteps: '      - name: Upload the obfuscation map\n        run: glitchtip-cli dart-symbol-map upload build/app/obfuscation.map.json build/app.linux-x64\n',
      }),
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /nothing in job "linux" retains it/);
  });

  test('an upload-artifact naming the SAME directory satisfies it', () => {
    const root = fixture({
      'build.yml': wf({
        buildFlags: ' --obfuscate --split-debug-info=build/symbols',
        uploadPaths: 'apps/subly/build/linux/x64/release/bundle\n            build/symbols',
      }),
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  test('an upload-artifact naming a DIFFERENT directory does NOT satisfy it', () => {
    const root = fixture({
      'build.yml': wf({
        buildFlags: ' --obfuscate --split-debug-info=build/symbols',
        uploadPaths: 'apps/subly/build/linux/x64/release/bundle\n            build/coverage',
      }),
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /nothing in job "linux" retains it/);
  });

  test('a symbol upload in a DIFFERENT job does not count — the mapping never leaves its runner', () => {
    const root = fixture({
      'build.yml': `${wf({ buildFlags: ' --obfuscate --split-debug-info=build/symbols' })}
  publish:
    runs-on: ubuntu-24.04
    steps:
      - run: sentry-cli debug-files upload build/symbols
`,
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /job "linux"/);
  });

  test('a COMMENT naming the flags cannot make a build look obfuscated — it fails on the floor with 0 obfuscating', () => {
    const root = fixture({
      'build.yml': wf({ comment: '      # never pass --obfuscate --split-debug-info=build/symbols on this lane\n' }),
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /0 obfuscating/);
    assert.match(out, /does not pass --obfuscate/);
  });

  test('--split-debug-info WITHOUT --obfuscate is a printed note, not a failure', () => {
    const root = fixture({
      // ⏱ CORRECTED 2026-09-07 — `release: ''` used to put this fixture outside
      // the floor; a bare `flutter build` is now INSIDE it, so the opt-out has
      // to be said out loud for the note to be the only verdict.
      'build.yml': `${wf({ buildFlags: ' --split-debug-info=build/symbols', release: ' --profile' })}${FLOOR_ANCHOR}`,
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /doing less than it looks like/);
  });

  // ── the coverage self-check ───────────────────────────────────────────────
  test('COVERAGE LOST when no workflow directory exists at all', () => {
    const root = join(TMP, `empty${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the workflows carry no `flutter build` at all', () => {
    const root = fixture({
      'build.yml': `name: Build
on:
  workflow_dispatch:

jobs:
  linux:
    runs-on: ubuntu-24.04
    steps:
      - run: echo nothing to build
`,
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /found ZERO `flutter build` commands/);
  });

  test('COVERAGE LOST when comment stripping eats every step', () => {
    const root = fixture({
      'build.yml': `name: Build
on:
  workflow_dispatch:

jobs:
  linux:
    runs-on: ubuntu-24.04
    steps:
#      - run: flutter build linux --release
`,
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  // ── the two false-alarm surfaces that really live in this tree ────────────
  test('`app.*.symbols` in a .gitignore is not a build command', () => {
    const root = fixture({ 'build.yml': COMPLIANT });
    mkdirSync(join(root, 'apps', 'subly'), { recursive: true });
    writeFileSync(join(root, 'apps', 'subly', '.gitignore'), 'app.*.symbols\napp.*.map.json\n');
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  test('the word "obfuscated" in Dart prose is not a build command', () => {
    const root = fixture({ 'build.yml': COMPLIANT });
    mkdirSync(join(root, 'packages', 'platform_storage', 'lib'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'platform_storage', 'lib', 'storage_capabilities.dart'),
      '/// Web storage is obfuscated, not encrypted.\nclass StorageCapabilities {}\n',
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });
});
