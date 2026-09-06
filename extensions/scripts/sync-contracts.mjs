/* sync-contracts.mjs — copy the shared contracts into the extension runtime.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/sync-contracts.mjs
     node scripts/sync-contracts.mjs --dry-run
     node scripts/sync-contracts.mjs --check      (exit 1 if it would change)

   WHY A COPY AND NOT AN IMPORT, which is the question this file exists to
   answer. `contracts/entitlement/contract.js` lives at the MONOREPO root, one
   level above this subtree. An extension package is a ZIP, and a zip only ever
   contains files from inside the tool's own directory — `scripts/pack.mjs`
   walks the tool directory and nothing else. So a relative
   `import '../../../../contracts/…'` in extension code resolves fine on a
   developer's disk and is a broken path the moment the tool is packed. The same
   three alternatives `scripts/sync-core.mjs` already rejected apply unchanged:
   symlinks need Developer Mode on Windows and Chrome's unpacked loader treats
   them inconsistently, and an npm workspace drags a module resolver into a
   runtime that has none.

   So: copy the bytes in, commit them, and hash-verify them
   (`scripts/check-contracts-sync.mjs`). Identical bargain, identical gate.

   🔴 BYTE-IDENTICAL, NOT "EQUIVALENT". No header is stamped onto the copy and
   no comment is rewritten. The whole claim this arrangement makes is that the
   TypeScript Worker and the extension read THE SAME BYTES; a copy that differed
   by a generated banner would make that claim unverifiable by the cheapest
   possible check, which is a hash.

   WHERE IT LANDS: `core/v1/`, THE VENDORED SURFACE. ⏱ MOVED 2026-09-06 from
   `core/entitlement-contract.js`, which was one level above that surface. The
   distinction is not cosmetic: `scripts/sync-core.mjs` copies every file under
   `core/<channel>/` into each adopting tool's `vendor/core/`, and it copies
   nothing else — so a contract sitting beside the channel directory could never
   reach a tool's zip, however many guards graded it. It now carries the price
   the surface charges: a `core/core.json` module entry, a sim under
   `core/test/` (`core/test/coverage.node.js` requires one per file on the
   surface, keyed on the FILESYSTEM rather than on any status field), and a core
   version bump.

   ⚠️ NO TOOL VENDORS CORE YET, and that is not something this change fixes.
   `Extension/Full_Screen_Shot/tool.json` and `templates/tool/tool.json` both
   declare `"core": null` on purpose — a declaration with no `vendor/core/`
   behind it asserts a relationship nothing verifies. So the honest claim today
   is "the contract is on the surface a tool inherits when it adopts core", not
   "a submitted zip carries it". The first tool to adopt gets it with no further
   work; before that, nothing ships it.

   ⚠️ NOT A BUILD STEP, and the distinction is the one [ADR 067] decision 1
   turns on. This copies a file at authoring time and commits the result; it
   does not transform anything, and the bytes in the tree are the bytes that
   ship. `tooling/ci/assert-extensions-build-free.mjs` is the check that says so.

   Exit codes: 0 synced (or already in sync) · 1 refused / would change · 2 could
   not run. */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Report, parseArgs, die, EXIT_FAIL } from './lib/report.mjs';
import { repoRoot, sha256 } from './lib/toolinfo.mjs';

/* THE ONE TABLE, exported so `check-contracts-sync.mjs` grades exactly what this
   script writes rather than a second list of the same fact. Adding a row is how
   a second shared contract reaches the extensions; nothing else here changes. */
export const SYNCED = [
  {
    from: 'contracts/entitlement/contract.js',
    to: 'core/v1/entitlement-contract.js',
    why: 'the money vocabulary — the revocation-reason set and the two money environments',
  },
];

/* The monorepo root, which is the parent of this subtree. `--contracts-root`
   exists so the self-test can point the pair at a synthetic tree: a gate you can
   only run against the real repository is a gate you can only negative-test by
   breaking the real repository. */
export function contractsRoot(extRoot, args) {
  const raw = args && typeof args.get === 'function' ? args.get('contracts-root') : null;
  return typeof raw === 'string' && raw ? path.resolve(raw) : path.resolve(extRoot, '..');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  args.rejectUnknown(['dry-run', 'check', 'repo-root', 'contracts-root']);
  const extRoot = repoRoot(args);
  const monoRoot = contractsRoot(extRoot, args);

  const dryRun = args.bool('dry-run');
  const check = args.bool('check');
  const r = new Report('sync-contracts' + (dryRun ? '  [dry run]' : check ? '  [check]' : ''));

  if (!fs.existsSync(path.join(monoRoot, 'contracts'))) {
    die('no contracts/ directory at ' + monoRoot + '.\n' +
      'This subtree reads the shared contracts from the monorepo root one level above it. If the\n' +
      'extensions tree has been checked out on its own, pass --contracts-root <path>. A sync that\n' +
      'silently copied nothing would leave the runtime on whatever bytes it already had.');
  }

  /* REQUIRED COVERAGE. An empty table copies nothing and prints a clean run. */
  if (SYNCED.length === 0) {
    die('the SYNCED table is empty, so this script would copy nothing and report success.\n' +
      'An empty sync and a sync that is up to date print the same line; that is the failure this\n' +
      'repository names first.');
  }

  let changed = 0;
  const wrote = [];
  for (const row of SYNCED) {
    const srcAbs = path.join(monoRoot, row.from);
    const dstAbs = path.join(extRoot, row.to);
    if (!fs.existsSync(srcAbs)) {
      die('source does not exist: ' + row.from + '\n' +
        'It is ' + row.why + ', and the extension runtime cannot be given a copy of a file that is\n' +
        'not there. Either the contract moved, or this table is stale.');
    }
    const src = fs.readFileSync(srcAbs);
    if (src.length === 0) {
      die(row.from + ' is EMPTY. Copying zero bytes would satisfy every hash check afterwards and\n' +
        'leave the runtime with no vocabulary at all.');
    }
    const same = fs.existsSync(dstAbs) && sha256(fs.readFileSync(dstAbs)) === sha256(src);
    if (same) {
      r.pass(row.to + ' is already byte-identical to ' + row.from);
      continue;
    }
    changed++;
    if (check) {
      r.fail(row.to + ' has drifted from ' + row.from,
        'The extension runtime is not carrying the same bytes as the authored contract.\n' +
        'It is ' + row.why + '.\n' +
        'Run:  node scripts/sync-contracts.mjs');
      continue;
    }
    if (dryRun) {
      r.note('would write ' + row.to + '  (' + src.length + ' bytes from ' + row.from + ')');
      continue;
    }
    fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
    fs.writeFileSync(dstAbs, src);
    wrote.push(row.to);
    r.pass('wrote ' + row.to + '  (' + src.length + ' bytes from ' + row.from + ')');
  }

  if (check && changed) process.exit(EXIT_FAIL);

  if (dryRun) {
    r.pass('dry run — nothing was written', changed + ' file(s) would change');
    process.exit(r.finish());
  }

  r.note(SYNCED.length + ' contract file(s) mirrored from ' + monoRoot);
  if (wrote.length) {
    r.note('The copies ARE COMMITTED — that is what makes the adoption visible as a diff, and what');
    r.note('lets someone clone the repo and load an extension unpacked with no setup at all.');
  }
  process.exit(r.finish());
}

/* Run only when invoked directly. check-contracts-sync.mjs imports SYNCED, and
   an import that exited the process would take its caller with it. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
