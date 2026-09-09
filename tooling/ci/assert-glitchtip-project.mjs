#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-glitchtip-project.mjs — every GlitchTip call site in .github/workflows
// names the SAME project, spelled as a LITERAL, never derived from a local path.
//
// ── THE FAILURE THIS EXISTS FOR, MEASURED 2026-09-09 ─────────────────────────
// build-platforms.yml and deploy-web.yml passed `--project "$APP"` — the matrix
// app slug, i.e. the name of a DIRECTORY IN THIS REPOSITORY. The submit-*.yml
// lanes passed `--project subly` — a literal. Renaming apps/subly to
// apps/subscriptiontracker therefore moved four of those call sites and left
// seven behind, and moved them onto a project name that did not exist on the
// server: every one of them POSTed to
//   /api/0/projects/nikatru/subscriptiontracker/files/difs/assemble/
// and got 404 from an instance that still held `subly`.
//
// A GlitchTip project slug is a name on a REMOTE SERVER. Renaming a directory is
// a commit; renaming that project is a PUT against glitchtip.nikatru.com. They
// are two facts and deriving one from the other asserts they are one, which is
// false the moment either moves alone. So the rule here is deliberately the
// OPPOSITE of the repository's usual "derived, not listed": the name is written
// out, once per call site, and this guard is what keeps the copies identical.
//
// ── WHAT IT REFUSES ──────────────────────────────────────────────────────────
//   1. two call sites naming different projects — the drift that happened;
//   2. a call site whose project argument is an expression rather than a literal
//      (`$APP`, `${env:APP}`, `${{ matrix.app }}`, `$*`, `${*`) — the coupling
//      that caused it;
//   3. ZERO call sites found — a rewrite that renames the flag would otherwise
//      make this guard silently pass over nothing. [C-COVERAGE-LOST-IS-NOT-PASS]
//
// It does NOT assert which project is the right one. That is the live instance's
// answer, not this file's, and `--live` asks it: with GLITCHTIP_TOKEN in the
// environment it GETs the project and requires 200. CI does not pass --live —
// ci.yml's standing objection to a CI limb depending on the GlitchTip box stands
// — so the live check is a laptop/runbook step and the offline invariant is the
// merge-blocking one.
//
// Usage:
//   node tooling/ci/assert-glitchtip-project.mjs [--workflows <dir>] [--live]
// Exit 0 = one literal project, everywhere. Exit 1 = it is not, and why.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'assert-glitchtip-project';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

const argv = process.argv.slice(2);
const KNOWN = new Set(['--workflows', '--live', '--help', '-h']);
for (const a of argv) {
  if (a.startsWith('-') && !KNOWN.has(a)) {
    console.error(`${NAME}: unknown flag ${a}. Known: ${[...KNOWN].join(' ')}`);
    process.exit(2);
  }
}
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('usage: node tooling/ci/assert-glitchtip-project.mjs [--workflows <dir>] [--live]');
  process.exit(0);
}
const wIdx = argv.indexOf('--workflows');
const WORKFLOWS = wIdx === -1 ? join(REPO, '.github', 'workflows') : resolve(argv[wIdx + 1] ?? '');
const LIVE = argv.includes('--live');

if (!existsSync(WORKFLOWS)) {
  console.error(`${NAME}: no workflow directory at ${WORKFLOWS}`);
  process.exit(1);
}

// A GlitchTip call site is `--project <x>` on a line that also carries
// `--org nikatru`, or within three lines of one — `upload-web-sourcemaps.mjs` is
// invoked with one flag per continued line, so the two are not always adjacent.
// `--project-name=` is Cloudflare Pages and is NOT this; the boundary is
// deliberate and the regex requires whitespace after `--project`.
const ORG = /--org\s+nikatru\b/;
const PROJECT = /--project\s+(\S+)/;
const DERIVED = /[$]|\$\{\{/;

const sites = [];
for (const f of readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n)).sort()) {
  const lines = readFileSync(join(WORKFLOWS, f), 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = PROJECT.exec(lines[i]);
    if (!m) continue;
    const near = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
    if (!ORG.test(near)) continue;
    sites.push({ file: f, line: i + 1, raw: lines[i].trim(), value: m[1].replace(/["'\\]/g, '') });
  }
}

const fail = (lines) => {
  console.error(`${NAME}: ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

if (sites.length === 0) {
  fail([
    'found ZERO GlitchTip --project call sites in .github/workflows.',
    'On 2026-09-09 there were eleven. Zero means either every symbol and source-map',
    'upload has been deleted, or the flag was renamed and this guard has stopped',
    'guarding. Both are COVERAGE LOST, and neither is a pass.',
    `Looked in: ${WORKFLOWS}`,
  ]);
}

const derived = sites.filter((s) => DERIVED.test(s.value));
if (derived.length) {
  fail([
    `${derived.length} GlitchTip --project argument(s) are DERIVED, not literal.`,
    'A GlitchTip project is a name on glitchtip.nikatru.com. A directory in this',
    'repository is not. Deriving the first from the second asserts they move',
    'together; on 2026-09-09 they did not, and every upload took a 404.',
    'Write the project slug out, and rename it on the server in the same change.',
    ...derived.map((s) => `${s.file}:${s.line}  ${s.raw}`),
  ]);
}

const values = [...new Set(sites.map((s) => s.value))].sort();
if (values.length !== 1) {
  fail([
    `${values.length} different GlitchTip projects are named across the workflows: ${values.join(', ')}.`,
    'One pipeline, one project. Two names means one half of the pipeline is',
    'uploading into a project nobody reads, or into one that does not exist.',
    ...sites.map((s) => `${s.file}:${s.line}  --project ${s.value}`),
  ]);
}

const project = values[0];
console.log(`${NAME}: ${sites.length} call site(s), all naming the literal project "${project}".`);
for (const s of sites) console.log(`  ${s.file}:${s.line}`);

if (LIVE) {
  const token = process.env.GLITCHTIP_TOKEN;
  if (!token) {
    console.error(`${NAME}: --live needs GLITCHTIP_TOKEN in the environment. Refusing to report a pass it did not make.`);
    process.exit(1);
  }
  const base = (process.env.GLITCHTIP_URL ?? 'https://glitchtip.nikatru.com').replace(/\/+$/, '');
  const url = `${base}/api/0/projects/nikatru/${project}/`;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  } catch (e) {
    console.error(`${NAME}: could not reach ${base} — ${e.message}`);
    process.exit(1);
  }
  if (res.status !== 200) {
    fail([
      `the live instance answers ${res.status} for project "${project}".`,
      `GET ${url}`,
      'The workflows agree with each other and disagree with the server, which is',
      'the exact 2026-09-09 failure. Rename the project on GlitchTip, or correct',
      'the literal — but not by guessing which.',
    ]);
  }
  const body = await res.json();
  console.log(`${NAME}: live check OK — "${body.slug}" (id ${body.id}) exists on ${base}.`);
}
