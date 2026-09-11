#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-hostname-depth.mjs — every hostname under a NIKATRU zone is the apex or
// EXACTLY ONE label deep.
//
// [ADR 080]. Owner, in chat, 2026-09-11: an app's API is
// "example-api.nikatru.com (Recommended)", the sign-in server is
// "Rename to auth-api.nikatru.com (Recommended)", and — standing — never pay for
// Advanced Certificate Manager; every NIKATRU hostname is `<name>.<zone>`.
//
// ── WHY DEPTH IS THE PROPERTY, NOT A SPELLING ────────────────────────────────
// The zone's Universal certificate covers `<zone>` and `*.<zone>` and nothing
// deeper. Earlier the same day [ADR 079] had put the API at the TWO-label
// `subscriptiontracker.api.nikatru.com`; it was served only because a Worker
// Custom Domain minted a per-host advanced pack while the zone's advanced quota
// read `allocated 0`. A two-label name works until that stops, and the fix on
// offer then is the paid add-on the owner refuses. Nothing in the tree could see
// a two-label host arriving: every other guard checks WHICH name, none checks
// HOW DEEP.
//
// ── WHAT IS A DECLARED HOSTNAME HERE (the subjects) ──────────────────────────
//   1. services/*/wrangler.json(c) — every `routes[]` pattern (custom domains
//      included) and every host inside a `vars` value; `env.*` blocks too.
//   2. apps/*/app.yaml — every `hosts.*` value.
//   3. catalog/apps.json — `url`, `origin`, `api`, every `listings.*` (the
//      rendering of 2, and what the public site advertises).
//   4. the registers — tooling/monitor-register.json, channel-register.json,
//      platform-register.json, capability-register.json: every string under a
//      HOST-BEARING key (HOST_KEYS below), at any depth. Prose keys (`why`,
//      `note`, `action`, …) are not subjects.
//   5. .github/workflows/*.yml — every host on a non-comment line (env values,
//      `--url` arguments, URLs in scripts).
//   6. site CSP — every `Content-Security-Policy` line in sites/*/_headers and
//      apps/*/web/_headers.
//
// ── WHAT IS DELIBERATELY NOT A SUBJECT ──────────────────────────────────────
// Comments, prose, history notes, ADR text and test fixtures: they record what
// was true, and a guard that failed on "the dotted host was removed" would train
// someone to delete the record. `*.pages.dev` and every third-party host are out
// of scope by construction — only hosts under ZONES are graded.
// capability-register.json has no floor: it names no NIKATRU host today, and a
// floor on an empty subject would be a guard that can only ever refuse.
//
// Exit: 0 = every declared NIKATRU hostname is the apex or one label deep ·
//       1 = one is deeper · 2 = COVERAGE LOST (the tree did not yield enough)
// Usage: node tooling/ci/assert-hostname-depth.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { parseJsonc } from './d1-sql-inventory.mjs';
import { parseYaml } from '../app-yaml/yaml.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const abs = (p) => join(ROOT, p);

// The Cloudflare zones NIKATRU serves from. A zone is added here in the same
// change that first declares a host under it.
const ZONES = ['nikatru.com', 'rajasekarselvam.com'];

// Keys whose string values are live addresses in the registers. Anything else is
// prose and is not read.
const HOST_KEYS = new Set([
  'hostname', 'host', 'hosts', 'url', 'urls', 'origin', 'api', 'endpoint',
  'expression', 'baseUrl', 'listingUrl', 'pattern', 'domain', 'domains',
]);
const REGISTERS = [
  'tooling/monitor-register.json',
  'tooling/channel-register.json',
  'tooling/platform-register.json',
  'tooling/capability-register.json',
];

function coverageLost(lines) {
  console.error('✗ COVERAGE LOST — assert-hostname-depth read too little of the tree to be evidence.');
  for (const l of lines) console.error(`    ${l}`);
  console.error('  2 is deliberately NOT a pass: a guard that checked nothing has proved nothing.');
  process.exit(2);
}

function readJson(relPath, { required = true } = {}) {
  if (!existsSync(abs(relPath))) {
    if (required) coverageLost([`${relPath} does not exist.`]);
    return null;
  }
  try {
    return JSON.parse(readFileSync(abs(relPath), 'utf8'));
  } catch (err) {
    coverageLost([`${relPath} is not valid JSON (${err.message}).`]);
  }
  return null;
}

const listing = (relDir) => (existsSync(abs(relDir)) ? listDir(abs(relDir), { withFileTypes: true }) : []);

// ── hostname extraction and grading ──────────────────────────────────────────
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HOST_RE = new RegExp(
  `(?<![A-Za-z0-9.-])((?:[A-Za-z0-9*](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)*(?:${ZONES.map(escapeRe).join('|')}))(?![A-Za-z0-9-])`,
  'gi',
);
/** Every NIKATRU-zone hostname appearing in a string. */
const hostsIn = (text) => [...String(text).matchAll(HOST_RE)].map((m) => m[1].toLowerCase());

/** `{ zone, depth }` for a host under a zone, or null when the host is not ours. */
function grade(host) {
  for (const zone of ZONES) {
    if (host === zone) return { zone, depth: 0 };
    if (host.endsWith(`.${zone}`)) return { zone, depth: host.slice(0, -(zone.length + 1)).split('.').length };
  }
  return null;
}

const findings = [];
const read = new Map(); // subject → NIKATRU hostnames graded
function check(subject, where, field, value) {
  if (typeof value !== 'string' || value.trim() === '') return;
  for (const host of hostsIn(value)) {
    const g = grade(host);
    if (!g) continue;
    read.set(subject, (read.get(subject) ?? 0) + 1);
    if (g.depth > 1) {
      findings.push(
        `${where} → ${field} = ${JSON.stringify(value)}: "${host}" is ${g.depth} labels below ${g.zone}. ` +
          `[ADR 080]: a NIKATRU hostname is the apex or exactly one label deep (e.g. <app>-api.${g.zone}); ` +
          `the zone's Universal certificate covers nothing deeper.`,
      );
    }
  }
}
const floor = (subject, why) => {
  if ((read.get(subject) ?? 0) === 0) coverageLost([why]);
};

// ── 1 · Worker configs ───────────────────────────────────────────────────────
let workerConfigs = 0;
for (const e of listing('services')) {
  if (!e.isDirectory() || e.name.startsWith('.')) continue;
  for (const f of ['wrangler.jsonc', 'wrangler.json']) {
    const p = `services/${e.name}/${f}`;
    if (!existsSync(abs(p))) continue;
    let cfg;
    try {
      cfg = parseJsonc(readFileSync(abs(p), 'utf8'));
    } catch (err) {
      coverageLost([`${p} did not parse (${err.message}); its routes were not read.`]);
    }
    workerConfigs++;
    const scan = (c, prefix) => {
      for (const [i, r] of (Array.isArray(c?.routes) ? c.routes : []).entries()) {
        check('workers', p, `${prefix}routes[${i}].pattern`, typeof r === 'string' ? r : r?.pattern);
      }
      if (typeof c?.route === 'string') check('workers', p, `${prefix}route`, c.route);
      for (const [k, v] of Object.entries(c?.vars ?? {})) check('workers', p, `${prefix}vars.${k}`, v);
    };
    scan(cfg, '');
    for (const [envName, envCfg] of Object.entries(cfg?.env ?? {})) scan(envCfg, `env.${envName}.`);
    break;
  }
}
if (workerConfigs === 0) coverageLost(['no services/*/wrangler.json(c) was found, so no route or custom domain was read.']);
floor('workers', 'services/*/wrangler.json(c) declare no NIKATRU hostname in `routes` or `vars`, so no Worker host was graded.');

// ── 2 · app declarations ─────────────────────────────────────────────────────
let appYamls = 0;
for (const e of listing('apps')) {
  if (!e.isDirectory() || e.name.startsWith('.')) continue;
  const p = `apps/${e.name}/app.yaml`;
  if (!existsSync(abs(p))) continue;
  let doc;
  try {
    doc = parseYaml(readFileSync(abs(p), 'utf8'));
  } catch (err) {
    coverageLost([`${p} did not parse (${err.message}); its hosts were not read.`]);
  }
  appYamls++;
  for (const [k, v] of Object.entries(doc?.hosts ?? {})) check('app.yaml', p, `hosts.${k}`, v);
}
if (appYamls === 0) coverageLost(['no apps/*/app.yaml was found, so no declared host was read.']);
floor('app.yaml', 'no apps/*/app.yaml `hosts` value names a NIKATRU hostname, so no app host was graded.');

// ── 3 · the app catalogue ────────────────────────────────────────────────────
const catalogue = readJson('catalog/apps.json');
if (!Array.isArray(catalogue) || catalogue.length === 0) coverageLost(['catalog/apps.json lists no app, so no published address was read.']);
for (const [i, a] of catalogue.entries()) {
  const where = `catalog/apps.json[${i}]`;
  for (const f of ['url', 'origin', 'api']) check('catalogue', where, f, a?.[f]);
  for (const [k, v] of Object.entries(a?.listings ?? {})) check('catalogue', where, `listings.${k}`, v);
}

// ── 4 · the registers ────────────────────────────────────────────────────────
let registersRead = 0;
for (const rel of REGISTERS) {
  const doc = readJson(rel, { required: rel !== 'tooling/capability-register.json' });
  if (doc === null) continue;
  registersRead++;
  const walk = (node, path, underHostKey) => {
    if (typeof node === 'string') {
      if (underHostKey) check('registers', rel, path, node);
    } else if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`, underHostKey));
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, HOST_KEYS.has(k));
    }
  };
  walk(doc, '', false);
}
if (registersRead === 0) coverageLost(['no register was read.']);
floor('registers', `${REGISTERS.join(', ')} carry no NIKATRU hostname under a host-bearing key, so no register host was graded.`);

// ── 5 · workflows ────────────────────────────────────────────────────────────
let workflows = 0;
for (const e of listing('.github/workflows')) {
  if (!e.isFile() || !/\.ya?ml$/.test(e.name)) continue;
  const p = `.github/workflows/${e.name}`;
  workflows++;
  for (const [n, raw] of readFileSync(abs(p), 'utf8').split(/\r?\n/).entries()) {
    if (/^\s*#/.test(raw)) continue;
    check('workflows', `${p}:${n + 1}`, 'line', raw.replace(/\s#.*$/, ''));
  }
}
if (workflows === 0) coverageLost(['no .github/workflows/*.yml was found, so no workflow host was read.']);
floor('workflows', '.github/workflows/*.yml name no NIKATRU hostname on a non-comment line, so no workflow host was graded.');

// ── 6 · site CSP ─────────────────────────────────────────────────────────────
const headerFiles = [
  ...listing('sites').filter((e) => e.isDirectory()).map((e) => `sites/${e.name}/_headers`),
  ...listing('apps').filter((e) => e.isDirectory()).map((e) => `apps/${e.name}/web/_headers`),
].filter((p) => existsSync(abs(p)));
let cspLines = 0;
for (const p of headerFiles) {
  for (const [n, raw] of readFileSync(abs(p), 'utf8').split(/\r?\n/).entries()) {
    if (!/content-security-policy/i.test(raw) || /^\s*#/.test(raw)) continue;
    cspLines++;
    check('csp', `${p}:${n + 1}`, 'Content-Security-Policy', raw);
  }
}
if (cspLines === 0) coverageLost(['no Content-Security-Policy line was found in sites/*/_headers or apps/*/web/_headers.']);
floor('csp', 'no Content-Security-Policy line names a NIKATRU hostname, so no CSP host was graded.');

// ── verdict ──────────────────────────────────────────────────────────────────
const summary = [...read.entries()].map(([k, v]) => `${k} ${v}`).join(' · ');
if (findings.length > 0) {
  console.error(`✗ ${findings.length} declared hostname(s) are deeper than one label under a NIKATRU zone:`);
  for (const f of findings) console.error(`    ${f}`);
  console.error(`  graded: ${summary}; zones: ${ZONES.join(', ')}`);
  process.exit(1);
}
console.log(`✓ every declared NIKATRU hostname is the apex or one label deep (${ZONES.join(', ')}). graded: ${summary}`);
