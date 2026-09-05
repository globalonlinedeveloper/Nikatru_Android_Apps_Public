#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-app-yaml.mjs — the app declaration is schema-valid, and everything
// rendered from it is still what it renders to.
//
// [ADR 067] decision 2 — "an app is `app.yaml` + its own screens". This is the
// guard that makes that sentence mechanical rather than aspirational.
//
// ── THE DEFECT IT CLOSES, IN THE OTHER GUARD'S OWN WORDS ─────────────────────
// `assert-store-metadata.mjs` opens by quoting [pipeline 10]D-5 — "store listing
// metadata is GENERATED from the spec and lives in the repo" — and its own
// header then records what was measured: "STAMP A FRESH APP AND YOU GET NO
// `store/` TREE … this guard exited 0 reporting 5 present and complete — because
// every subject it had was `apps/subly/store/`, which a human wrote by hand.
// Real guard, running, green, pointed one artifact away from the behaviour the
// requirement names." The listing text agreed with the catalogue because two
// people had typed the same words, and nothing anywhere could tell that apart
// from a generator. `tooling/app-yaml/render.mjs` is the generator; this is the
// check that it was RUN.
//
// ── THE THREE LIMBS ──────────────────────────────────────────────────────────
//   1 · every `apps/<id>/app.yaml` parses and satisfies
//       tooling/app-yaml/schema/app.schema.json;
//   2 · every rendering — `catalog/apps.json` and the five listing-copy files in
//       each store channel directory — is byte-identical to what the declaration
//       renders to. A hand edit to `title.txt` is what this catches, and it is
//       the ONLY thing that can: the file's whole content is the title a store
//       shows, so it cannot carry a "generated, do not edit" header any more than
//       `sites/_shared/_data/apps.json` can (same problem, same file, recorded in
//       generate-apps-data.mjs's header);
//   3 · every `apps/<id>/privacy.yaml` satisfies
//       tooling/app-yaml/schema/privacy.schema.json, names only processors that
//       exist in `tooling/legal/provider-register.json`, and declares no network
//       address.
//
// 🔴 LIMB 3'S TWO CROSS-CHECKS ARE THE HALF A SCHEMA CANNOT DO. A schema can say
// `id` is a string; only the tree can say it is a party this company has
// actually named. And C-NO-NETWORK-ADDRESS-COLUMN is locked precisely because it
// has already been broken in publication once — `privacy.html` said "We do not
// collect or store your IP address" while the self-hosted GlitchTip was storing
// `user.ip_address` (recorded in provider-register.json's own `dataCategories`
// header). A declaration that CAN say "IP address" is a declaration that
// eventually will, so the schema pins `networkAddress` to `false` and this limb
// refuses the words as well as the flag.
//
// ── WHAT COVERAGE LOST MEANS HERE ────────────────────────────────────────────
// Exit 2, never 0, on any run that graded nothing: no `apps/` tree, no
// declaration in it, an unreadable channel register (the storefront key set and
// every listing directory come from it), a declaration that rendered zero
// listing files, or not one `privacy.yaml` anywhere. Each is a run that would
// otherwise print "every declaration is valid" over an empty set — this
// repository's single most repeated defect, and the reason
// C-COVERAGE-LOST-IS-NOT-PASS forbids sharing an exit code with a pass.
//
// Usage:  node tooling/ci/assert-app-yaml.mjs [repoRoot]
// Exit 0 = valid and fresh · 1 = a finding · 2 = COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml, YamlError } from '../app-yaml/yaml.mjs';
import { validate, assertSchemaUnderstood } from '../app-yaml/schema-validate.mjs';
import { plan, APPS_DIR } from '../app-yaml/render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv[2] ?? join(HERE, '..', '..'));
const PRIVACY_SCHEMA = join(HERE, '..', 'app-yaml', 'schema', 'privacy.schema.json');
const PROVIDERS = 'tooling/legal/provider-register.json';

const problems = [];
const ok = (m) => console.log(`ok   ${m}`);

/** Fatal on the spot. Every limb below quantifies over the missing thing, so
 *  continuing would report "clean" over nothing. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-app-yaml: COVERAGE LOST');
  process.exit(2);
}

/** Every string leaf of a parsed declaration, with its pointer. */
function strings(value, path = '#', out = []) {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') for (const k of Object.keys(value)) strings(value[k], `${path}/${k}`, out);
  return out;
}

/** The words that would make the published no-IP promise false. Matched on the
 *  DECLARATION's own text, because the flag alone is satisfiable by an author who
 *  leaves it false and then writes the row anyway. */
const NETWORK_ADDRESS = /\b(ip[ _-]?address(es)?|network[ _-]address|client[ _-]ip|remote[ _-]addr)\b/i;

// ── limbs 1 and 2, both derived from the renderer's own plan ────────────────
// The guard and the generator MUST agree about what "rendered" means, and the
// only way two readers of one contract cannot drift is for there to be one
// reader. So the plan is imported rather than re-derived here — the same reason
// `storeMetadataContract` lives in the channel register and not inside
// assert-store-metadata.mjs.
const { declarations, files, problems: authoring, lost } = plan(ROOT);
if (lost.length) coverageLost(lost);

// 🔴 A DECLARATION THAT DOES NOT PARSE STOPS THE RUN HERE, and the reason is the
// exit code rather than tidiness. Limbs 2 and 3 both quantify over the
// declarations limb 1 accepted, so an invalid one leaves them ranging over a
// smaller set — and limb 3's "not one app carries a privacy.yaml" refusal then
// fires and reports COVERAGE LOST, which is a true statement about this run and
// a MISLEADING diagnosis of the tree: the finding is the broken declaration, and
// the repair the message must point at is that file. Measured: with `id:`
// deleted from apps/subly/app.yaml this guard exited 2 naming the privacy limb.
if (authoring.length) {
  console.error('');
  for (const p of authoring) console.error(`✗ ${p}`);
  console.error(
    `\nassert-app-yaml: ${authoring.length} problem(s) in the declaration(s). Nothing downstream was graded — ` +
      'every later limb ranges over the declarations this limb accepted.',
  );
  process.exit(1);
}
ok(`${declarations.length} declaration(s) parse and satisfy tooling/app-yaml/schema/app.schema.json`);

const stale = [];
for (const [rel, contents] of files) {
  const abs = join(ROOT, rel);
  const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  if (current !== contents) stale.push(rel);
}
if (stale.length) {
  problems.push(
    `${stale.length} rendering(s) no longer match the declaration they are rendered from:\n` +
      stale.map((s) => `      ${s}`).join('\n') +
      '\n      Change apps/<id>/app.yaml, then: node tooling/app-yaml/render.mjs' +
      '\n      (A listing file cannot carry a "generated" header — its whole content is the value a store shows —' +
      '\n       so this comparison is the only thing between a hand edit and a store console.)',
  );
} else {
  ok(`${files.size} rendering(s) are byte-identical to what apps/*/app.yaml renders to`);
}

// ── limb 3 · the privacy declarations ───────────────────────────────────────
const privacySchema = JSON.parse(readFileSync(PRIVACY_SCHEMA, 'utf8'));
assertSchemaUnderstood(privacySchema, 'privacy.schema.json');

const providerRaw = existsSync(join(ROOT, PROVIDERS)) ? readFileSync(join(ROOT, PROVIDERS), 'utf8') : null;
if (providerRaw === null) {
  coverageLost([
    `${PROVIDERS} does not exist.`,
    'It is the ONE declaration of who this company has named as a processor, and the cross-check below',
    'quantifies over it. Absent, every processor row in every privacy.yaml would be accepted unread.',
  ]);
}
let providerIds;
try {
  const reg = JSON.parse(providerRaw);
  providerIds = new Set((Array.isArray(reg.providers) ? reg.providers : []).map((p) => p && p.id).filter(Boolean));
} catch (e) {
  coverageLost([`${PROVIDERS} is not valid JSON (${e.message}); the processor cross-check has no right-hand side.`]);
}
if (providerIds.size === 0) {
  coverageLost([
    `${PROVIDERS} declares zero providers.`,
    'The processor cross-check below would then reject everything or accept nothing, and neither answer is',
    'about the declarations it claims to grade.',
  ]);
}

let privacyGraded = 0;
const problemsBeforePrivacy = problems.length;
for (const { id } of declarations) {
  const rel = `${APPS_DIR}/${id}/privacy.yaml`;
  if (!existsSync(join(ROOT, rel))) continue;
  privacyGraded += 1;
  let doc;
  try {
    doc = parseYaml(readFileSync(join(ROOT, rel), 'utf8'));
  } catch (e) {
    problems.push(`${rel}: ${e instanceof YamlError ? e.message : String(e)}`);
    continue;
  }
  for (const bad of validate(doc, privacySchema, rel)) problems.push(bad);
  if (doc && doc.app !== id) {
    problems.push(`${rel}: declares app "${doc.app}" but lives in ${APPS_DIR}/${id}/ — two files describing two different apps.`);
  }
  for (const p of Array.isArray(doc?.processors) ? doc.processors : []) {
    if (p && typeof p.id === 'string' && !providerIds.has(p.id)) {
      problems.push(
        `${rel}: processor "${p.id}" is not a row in ${PROVIDERS}. That register is the ONE declaration of who ` +
          'these parties are; a second spelling here is the one that drifts.',
      );
    }
  }
  for (const [pointer, text] of strings(doc)) {
    if (NETWORK_ADDRESS.test(text)) {
      problems.push(
        `${rel} ${pointer}: names a network address ("${text.match(NETWORK_ADDRESS)[0]}"). C-NO-NETWORK-ADDRESS-COLUMN ` +
          'is locked: IP addresses are not stored, and the promise is PUBLISHED. This exact claim has already been ' +
          'false in publication once.',
      );
    }
  }
}
if (privacyGraded === 0) {
  coverageLost([
    `none of the ${declarations.length} declaring app(s) carries a privacy.yaml.`,
    'Limb 3 then grades nothing — no schema check, no processor cross-check and no network-address refusal —',
    'while this guard still prints two green lines about the other two limbs.',
  ]);
}
if (problems.length === problemsBeforePrivacy) {
  ok(`${privacyGraded} privacy declaration(s) valid, with every processor named in ${PROVIDERS} and no network address anywhere`);
}

// ── verdict ─────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`✗ ${p}`);
  console.error(`\nassert-app-yaml: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(
  `\nassert-app-yaml: ok — ${declarations.length} app declaration(s), ${files.size} rendering(s) fresh, ` +
    `${privacyGraded} privacy declaration(s) graded against ${providerIds.size} named provider(s).`,
);
