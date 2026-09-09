#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// generate-bundle.mjs — write bundle.json from bundle.js, or prove they agree.
//
//   node contracts/entitlement/generate-bundle.mjs           rewrite bundle.json
//   node contracts/entitlement/generate-bundle.mjs --check    exit 1 if it would change
//
// The same arrangement generate.mjs makes for the entitlement vocabulary, and
// for the same reason: `bundle.js` is the artefact a Cloudflare Worker and plain
// node tooling can import with no tool in between, and `bundle.json` is the
// machine-readable copy a JSON-schema-graded consumer and any non-JS reader
// needs. Two files is what this directory exists to STOP, so the second one is
// DERIVED and `--check` runs in CI — which makes it a generated copy rather than
// a second hand-maintained one.
//
// ⚠️ NO DART GENERATOR, AND THAT IS DELIBERATE. contract.js has one because
// packages/purchases renders revocation reasons in the client. Nothing in Dart
// reads a bundle SOURCE: the client contract does not change ([ADR 057] §6), the
// server decides every grant, and the client only reads `granted_via` and an
// opaque `bundle` block off the entitlements response. Generating a Dart mirror
// nothing imports would be a fourth copy with no reader — a file that can drift
// without any consumer noticing, which is the shape this directory refuses.
//
// ⚠️ NO DEPENDENCIES, DELIBERATELY — plain node, no install, same as generate.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLE_TABLE } from './bundle.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'bundle.json');
const REL = 'contracts/entitlement/bundle.json';
const check = process.argv.includes('--check');

const payload = {
  $schema: './bundle.schema.json',
  ...JSON.parse(JSON.stringify(BUNDLE_TABLE)),
};
const rendered = JSON.stringify(payload, null, 2) + '\n';

// A COVERAGE SELF-CHECK, because an empty table would serialise perfectly and
// read exactly like a clean run. Every downstream check over an empty set is
// vacuously true, and that is not a pass.
if (!payload.bundleSources?.length || !payload.productKinds?.length) {
  console.error(`✗ COVERAGE LOST — bundle.js exported an empty table, so ${REL} would be written empty.`);
  console.error('  An empty source set satisfies every downstream check vacuously; that is not a pass.');
  process.exit(1);
}
// A SHARPER FLOOR ON THE ONE FIELD THAT MATTERS. A table whose every source is
// exempt from a receipt is a table that permits a grant from nothing, and it
// serialises as valid JSON that reads exactly like a clean run. At least one
// source must REQUIRE evidence, or "no entitlement without a verified receipt"
// is a sentence with no member it applies to.
if (!payload.bundleSources.some((s) => s.requiresReceipt === true)) {
  console.error(`✗ COVERAGE LOST — no source in bundle.js requires a receipt, so ${REL} would declare that`);
  console.error('  every bundle grant may be minted without evidence. That is not the same as a rule nobody needed.');
  process.exit(1);
}

if (!check) {
  writeFileSync(OUT, rendered, 'utf8');
  console.log(
    `ok  wrote ${REL} — ${payload.bundleSources.length} bundle source(s), ` +
      `${payload.bundleSources.filter((s) => s.requiresReceipt).length} requiring a receipt, ` +
      `${payload.productKinds.length} product kind(s)`,
  );
  process.exit(0);
}

let current;
try {
  current = readFileSync(OUT, 'utf8');
} catch {
  current = null;
}

if (current === null) {
  console.error(`✗ ${REL} does not exist. Run: node contracts/entitlement/generate-bundle.mjs`);
  process.exit(1);
}
if (current.replace(/\r\n/g, '\n') !== rendered) {
  console.error(`✗ ${REL} is not what bundle.js derives — the two copies of the bundle vocabulary have`);
  console.error('  drifted, which is the exact failure this directory exists to prevent.');
  console.error('  Run: node contracts/entitlement/generate-bundle.mjs');
  process.exit(1);
}

console.log(
  `ok  bundle contract — ${REL} matches bundle.js ` +
    `(${payload.bundleSources.length} source(s), ${payload.productKinds.length} product kind(s), ` +
    `min live products ${payload.minLiveProductsForBundle})`,
);
