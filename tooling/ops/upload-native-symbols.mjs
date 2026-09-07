#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// upload-native-symbols.mjs — put a release build's split-debug-info directory
// INTO GlitchTip, and refuse to exit 0 unless the CLI says the server assembled
// every file.
//
// [pipeline 9]R-7, native limb. The web limb is
// tooling/ops/upload-web-sourcemaps.mjs and the two are NOT the same problem:
// web uploads an artifact bundle to the RELEASE files endpoint, native uploads
// object files to the DIF endpoint. [ADR 067] decision 6.
//
// ── WHY A WRAPPER AND NOT THE BARE CLI ───────────────────────────────────────
// `glitchtip-cli debug-files upload` is the right command — read at the pinned
// v1.0.0 from src/commands/debug_files.rs, it chunk-uploads each file and calls
// `assemble_difs`, which is the path GlitchTip actually implements for ELF /
// Mach-O / PDB. It is NOT the `sourcemaps upload` path that
// upload-web-sourcemaps.mjs had to replace.
//
// But it exits 0 in three states that are not "the symbols are stored", and all
// three are read from that same source, not supposed:
//
//   1. `if found.is_empty() { println!("No debug information files found.");
//      return Ok(()); }` — a directory that the build never wrote, or that a
//      renamed --split-debug-info flag left empty, is a GREEN upload of nothing.
//      This is the exact shape [C-COVERAGE-LOST-IS-NOT-PASS] exists for.
//   2. the per-file loop counts failures into `errors` and then prints
//      `Upload complete: {uploaded} chunk(s) uploaded, {errors} error(s).` and
//      returns Ok — a chunk that never landed does not fail the command.
//   3. `poll_assembly` gives up after 60 polls with
//      `Assembly did not complete within timeout.` and returns Ok, and a
//      per-file `"error"` state is printed as `Error: <name>: <detail>` and
//      then likewise returns Ok. Assemble is asynchronous, so a 200 from it
//      means "queued", never "stored".
//
// So this wrapper asserts the CLI's own output against what it can see on disk:
//   · it counts the files in the directory ITSELF and requires the CLI to
//     report the SAME number found — closing (1) and catching a type filter
//     that silently skips a file;
//   · it requires `0 error(s)` and `chunk(s) uploaded` equal to that count —
//     closing (2);
//   · it requires `Assembly completed.`, which `poll_assembly` prints only when
//     the server has answered `ok`/`created` for every checksum — closing (3).
// Any of those missing is exit 1 with the CLI's full output printed, never a
// skip.
//
// ── FAIL CLOSED ON THE CREDENTIAL, NEVER SKIP ────────────────────────────────
// `GLITCHTIP_TOKEN` is a repository secret and reaches the CLI as
// SENTRY_AUTH_TOKEN. If it is absent this script exits 1 NAMING the secret. A
// symbol upload that quietly skips itself when the token is missing is how a
// release ships unreadable — the whole reason this file exists.
//
// ── WHAT IS DELIBERATELY NOT UPLOADED ────────────────────────────────────────
// `build/app/obfuscation.map.json` (from --save-obfuscation-map), through
// `glitchtip-cli dart-symbol-map upload`. That map fixes the ISSUE TITLE, not
// the stack trace, and GlitchTip cannot consume it: its assemble path is
// `Archive.open(file)` over what is a JSON array of strings, and grepping
// apps/difs/* and apps/event_ingest/process_event.py for `dart`, `symbol_map`
// and `obfuscat` returns nothing. Measured in
// Nikatru_Platform_Private research/68-GLITCHTIP-CAPABILITY-INVENTORY.md §3.2.
// Expect readable stack traces and mangled issue titles; that is a sink
// limitation, not a pipeline one, and wiring an upload the server discards
// would be coverage that is not.
//
// ── HOW THIS IS TESTED, AND WHY IT IS SPLIT IN TWO ──────────────────────────
// `readCliVerdict` is EXPORTED and pure: it is given the CLI's output, its exit
// status and the file count this script measured on disk, and it returns the
// verdict. The refusals BEFORE the spawn (no token, no directory, an empty
// directory, an unparseable DSN) are driven by spawning this file for real.
// The split exists because the alternative — a fake glitchtip-cli on disk — is
// a shebang script on Linux and a .cmd on Windows, and `spawnSync` runs neither
// the same way, so the negative test would be green on the runner and red on
// the laptop for a reason that is about `spawnSync`, not about symbols.
// tooling/ci/test/native-symbol-upload.test.mjs.
//
// Usage:
//   node tooling/ops/upload-native-symbols.mjs \
//     --cli <path to glitchtip-cli> --dir <split-debug-info dir> \
//     --org <slug> --project <slug> --dsn <GlitchTip DSN>
//
// Exit 0 = the server assembled every debug file in <dir>.
// Exit 1 = it did not, or this script can no longer tell.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The CLI's output contract, read from glitchtip-cli v1.0.0
 * src/commands/debug_files.rs. Every clause here refuses a state in which the
 * command exits 0 having stored nothing; see the header.
 *
 * @param {{out: string, status: number|null, fileCount: number, cli: string}} r
 * @returns {{ok: true} | {ok: false, lines: string[]}}
 */
export function readCliVerdict({ out, status, fileCount, cli }) {
  if (status !== 0) {
    return { ok: false, lines: [`${cli} debug-files upload exited ${status}. Its output is above.`] };
  }

  const found = /Found (\d+) debug information file\(s\)/.exec(out);
  if (!found) {
    return {
      ok: false,
      lines: [
        'the CLI did not print how many debug information files it found.',
        'At the pinned version it prints "No debug information files found." and exits 0 when the',
        'directory holds nothing it recognises — so a missing count is that green, or the CLI\'s',
        'output contract has changed and this check has stopped checking. Both are COVERAGE LOST.',
        `This script found ${fileCount} file(s) on disk.`,
      ],
    };
  }
  if (Number(found[1]) !== fileCount) {
    return {
      ok: false,
      lines: [
        `the CLI found ${found[1]} debug information file(s); this script counted ${fileCount} on disk.`,
        'A file the CLI skipped is a file whose crash frames stay unreadable, and the command exits 0',
        'over it. Every file in the split-debug-info directory must be uploaded or the build is only',
        'partly readable, which is indistinguishable from readable until the crash arrives.',
      ],
    };
  }

  const complete = /Upload complete: (\d+) chunk\(s\) uploaded, (\d+) error\(s\)\./.exec(out);
  if (!complete) {
    return {
      ok: false,
      lines: [
        'the CLI did not print its "Upload complete" line, so the per-file error count is unknown.',
        'That line is the only place a failed chunk is reported — the command returns Ok either way.',
      ],
    };
  }
  if (Number(complete[2]) !== 0) {
    return {
      ok: false,
      lines: [
        `${complete[2]} chunk upload(s) failed and the CLI still exited 0.`,
        'Its per-file loop counts errors and returns Ok, so this is the only place that failure can',
        'become a red build.',
      ],
    };
  }
  if (Number(complete[1]) !== fileCount) {
    return {
      ok: false,
      lines: [
        `${complete[1]} chunk(s) uploaded for ${fileCount} file(s) on disk.`,
        'Every debug file is one chunk in this CLI, so a lower number is a file that never left.',
      ],
    };
  }

  if (!/Assembly completed\./.test(out)) {
    return {
      ok: false,
      lines: [
        'the server never reported the debug files as assembled.',
        'Assemble is ASYNCHRONOUS: a 200 from it means "queued", never "stored". `--wait` polls for',
        '60 seconds and prints "Assembly completed." ONLY when every checksum came back ok/created;',
        'on timeout it prints "Assembly did not complete within timeout." and still returns Ok, and a',
        'per-file failure prints "Error: <name>: <detail>" and likewise returns Ok. The CLI\'s output',
        'is above and names which.',
      ],
    };
  }

  return { ok: true };
}

// Imported for its verdict alone by the negative test; only a direct run does
// the work below.
const RUN_DIRECTLY =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (RUN_DIRECTLY) {
const argv = process.argv.slice(2);
const NO_VALUE = new Set([]);
const args = new Map();
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const key = a.slice(2);
  if (NO_VALUE.has(key)) {
    args.set(key, true);
    continue;
  }
  const next = argv[i + 1];
  // TRAPS shell-13: a no-value flag in a hand-rolled loop silently eats the
  // next argument, and binds undefined when it is last. Refuse both.
  if (next === undefined || next.startsWith('--')) fail([`--${key} was given no value.`]);
  args.set(key, next);
  i++;
}

function fail(lines) {
  console.error('');
  console.error(`FAIL upload-native-symbols — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  process.exitCode = 1;
  process.exit(1);
}

const cli = args.get('cli');
const dir = args.get('dir');
const org = args.get('org');
const project = args.get('project');
const dsn = process.env.GLITCHTIP_DSN ?? args.get('dsn');
const token = process.env.SENTRY_AUTH_TOKEN;

for (const [name, v] of [['--cli', cli], ['--dir', dir], ['--org', org], ['--project', project]]) {
  if (!v) fail([`${name} is required.`, 'Usage is in the header of this file.']);
}

if (!token) {
  fail([
    'SENTRY_AUTH_TOKEN is empty, so the debug symbols for this build cannot be uploaded.',
    'It is the repository secret GLITCHTIP_TOKEN, passed to this step as SENTRY_AUTH_TOKEN.',
    'This is a REFUSAL, not a skip: an obfuscated build whose symbols never reach the crash',
    'sink produces crash reports that cannot be read and cannot be made readable later, because',
    'a rebuild produces a different mapping. Set the secret, or drop --obfuscate.',
  ]);
}

if (!dsn) {
  fail([
    'GLITCHTIP_DSN is empty, so the server origin to upload to cannot be derived.',
    'It is the repository secret GLITCHTIP_DSN, of the shape https://<key>@<host>/<project id>.',
  ]);
}

const m = /^https?:\/\/[^@/]+@([^/]+)\//.exec(dsn);
if (!m) {
  fail([
    'GLITCHTIP_DSN did not parse into a server origin.',
    'Expected https://<key>@<host>/<project id>. The value itself is NOT printed.',
  ]);
}
const server = `${dsn.startsWith('http://') ? 'http' : 'https'}://${m[1]}`;

const abs = resolve(dir);
if (!existsSync(abs) || !statSync(abs).isDirectory()) {
  fail([
    `${dir} is not a directory.`,
    'It is the value a `flutter build … --split-debug-info=<dir>` in this job was given, so its',
    'absence means the build did not obfuscate, or the two values have drifted apart. Either way',
    'there are no symbols to upload and the build that just ran is unreadable.',
  ]);
}

/** Every regular file under <dir>, recursively — Flutter writes one per ABI. */
const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile() && statSync(p).size > 0) files.push(p);
  }
})(abs);

if (files.length === 0) {
  fail([
    `${dir} exists but holds no non-empty file.`,
    'A build that passed --split-debug-info and wrote nothing is a build whose mapping does not',
    'exist. Uploading an empty directory is the CLI\'s own "No debug information files found."',
    'green, which is the state this script exists to refuse.',
  ]);
}

console.log(`⬜ ${files.length} debug file(s) in ${dir}:`);
for (const f of files) console.log(`     ${f.slice(abs.length + 1)}`);

const r = spawnSync(
  cli,
  ['debug-files', 'upload', '--wait', '--org', org, '--project', project, abs],
  {
    encoding: 'utf8',
    env: { ...process.env, SENTRY_URL: server },
  },
);

const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
console.log(out);

if (r.error) fail([`${cli} could not be run: ${r.error.message}`]);

const verdict = readCliVerdict({ out, status: r.status, fileCount: files.length, cli });
if (!verdict.ok) fail(verdict.lines);

console.log(
  `ok  native symbols — ${files.length} debug file(s) from ${dir} uploaded to ${server} ` +
    `(org ${org}, project ${project}) and assembled by the server`,
);

}
