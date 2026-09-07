#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// publish-arming.mjs — the ONE answer, for the three extension store lanes, to
// "may this run publish, must it refuse, or does it print an owner step?"
//
// 🔴 IT IMPORTS tooling/ci/channel-arming.mjs AND DOES NOT RESTATE IT. The
// arming rule — `served: true`, or `submittable: true` with a real `lane` — has
// exactly one implementation in this repository and three signing seams already
// read it. A fourth copy here would be the defect that module's own header
// names: two readings of one register that agree until the day they do not.
//
// ── THE THREE VERDICTS, AND WHY THE MIDDLE ONE IS NOT A SKIP ─────────────────
//   go       every declared credential is present and the register ARMS the row.
//            The caller publishes.
//   refuse   a credential is EMPTY and the register ARMS the row. Exit 1. This is
//            the fail-closed case: a channel that can reach a user, with no way
//            to authenticate, is a release that would half-ship.
//   pending  a credential is empty and the row is NOT armed. The caller PRINTS
//            the exact owner step and the release records
//            `pending_manual_publish`, which is what `record-deployment.mjs`
//            already accepts for a `submittable: false` store row.
//            [pipeline C-6]: a guard that blocks CI on work only the owner can do
//            blocks every merge in the repository. ADR 067 decision 8 puts ONE
//            MANUAL FIRST PUBLISH in front of every store, so `submittable:
//            false` here is a statement about the store account, not about this
//            code — and the day the owner flips it, the SAME run with the SAME
//            empty secret REFUSES instead. That flip is the register's on-switch.
//
// The fourth quadrant — credentials present, row NOT armed — is `pending` too,
// with its own loud line. A secret that exists for a channel nothing arms is not
// an authorisation to publish: the register is the switch, never the vault.
//
// ⚠️ NOTHING HERE READS OR PRINTS A SECRET VALUE. It reads `process.env[name]`
// only to ask whether it is a non-empty string, and reports NAMES.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armingOf } from '../../tooling/ci/channel-arming.mjs';

/** The repository root, resolved from THIS file rather than from the working
 *  directory: `extensions.yml` runs its steps with `working-directory: extensions`
 *  by default and with `.` on the platform steps, so a cwd-relative root would
 *  resolve differently depending on which kind of step called in. */
export const REPO_ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
export const REGISTER = 'tooling/channel-register.json';

/** The scan cannot continue and reporting "nothing to do" would be a lie about
 *  nothing. Callers exit 1 on this; a publish path that cannot find its own
 *  register must never fall through to "no credentials, therefore pending". */
export class ArmingCoverageLost extends Error {
  constructor(lines) {
    super(lines[0]);
    this.lines = lines;
  }
}

/** The register row for `channelId`, read from disk once. */
export function readChannel(channelId, root = REPO_ROOT) {
  const abs = join(root, REGISTER);
  if (!existsSync(abs)) {
    throw new ArmingCoverageLost([
      `COVERAGE LOST — ${REGISTER} does not exist under ${root}.`,
      'The arming answer, the owner step and the deferral all live on that row. Without the file this',
      'would decide "not armed" from an absence and publish nothing while reporting success.',
    ]);
  }
  let register;
  try {
    register = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new ArmingCoverageLost([`COVERAGE LOST — ${REGISTER} is not valid JSON — ${e.message}`]);
  }
  const row = (register.channels ?? []).find((c) => c.id === channelId);
  if (row === undefined) {
    throw new ArmingCoverageLost([
      `COVERAGE LOST — ${REGISTER} declares no "${channelId}" channel.`,
      'This lane exists to publish exactly that row. A missing row is not an unarmed row: it is a',
      'register this script can no longer be graded against.',
    ]);
  }
  return row;
}

/**
 * The verdict.
 *
 * @param {object} o
 * @param {string} o.channelId      register row id, e.g. "amo"
 * @param {Array<{name:string, why:string}>} o.secrets  the credentials this lane needs, by NAME
 * @param {string} o.ownerStep      the exact command or console act that creates them
 * @param {object} [o.env]          environment to read (tests pass their own)
 * @param {string} [o.root]         repository root
 * @returns {{verdict:'go'|'refuse'|'pending', row:object, arming:object, missing:string[], lines:string[]}}
 */
export function publishVerdict({ channelId, secrets, ownerStep, env = process.env, root = REPO_ROOT }) {
  if (!Array.isArray(secrets) || secrets.length === 0) {
    throw new ArmingCoverageLost([
      `COVERAGE LOST — no credential names were declared for channel "${channelId}".`,
      'With an empty list every credential is present by vacuity, so this would answer `go` for a lane',
      'that can authenticate with nothing at all.',
    ]);
  }
  const row = readChannel(channelId, root);
  const arming = armingOf(row);
  const missing = secrets.filter((s) => String(env[s.name] ?? '').trim() === '').map((s) => s.name);

  const lines = [];
  if (missing.length === 0 && arming.armed) {
    lines.push(`ARMED and CREDENTIALLED — channel "${channelId}": ${secrets.map((s) => s.name).join(', ')} all present (values never read or printed).`);
    for (const r of arming.reasons) lines.push(`   armed because ${r}`);
    return { verdict: 'go', row, arming, missing, lines };
  }

  if (missing.length > 0 && arming.armed) {
    lines.push(`🔴 REFUSED — channel "${channelId}" IS ARMED in ${REGISTER} and ${missing.length} of its ${secrets.length} credential(s) are EMPTY: ${missing.join(', ')}.`);
    for (const r of arming.reasons) lines.push(`   armed because ${r}`);
    for (const s of secrets) if (missing.includes(s.name)) lines.push(`   ${s.name} — ${s.why}`);
    lines.push(`   OWNER STEP: ${ownerStep}`);
    lines.push('   An armed channel with no credential is a release that would half-ship: the artifact is built,');
    lines.push('   the store call cannot be made, and nothing downstream would say so. Fail closed.');
    return { verdict: 'refuse', row, arming, missing, lines };
  }

  if (missing.length > 0) {
    lines.push(`⬜ PENDING MANUAL PUBLISH — channel "${channelId}" is NOT ARMED in ${REGISTER}, so this release publishes nothing to it.`);
    for (const b of arming.blockers) lines.push(`   ${b}`);
    lines.push(`   absent credential(s): ${missing.join(', ')}`);
    for (const s of secrets) if (missing.includes(s.name)) lines.push(`   ${s.name} — ${s.why}`);
    lines.push(`   OWNER STEP: ${ownerStep}`);
    lines.push('   ⚠️ THIS IS A TRIPWIRE, NOT A WAIVER. The same tag with the same empty secret REFUSES the');
    lines.push(`   moment ${REGISTER} arms this row. Arming a channel and creating its secrets belong in ONE change.`);
    return { verdict: 'pending', row, arming, missing, lines };
  }

  lines.push(`⬜ CREDENTIALS PRESENT, CHANNEL NOT ARMED — channel "${channelId}" has every declared credential and ${REGISTER} does not arm it, so this release publishes nothing to it.`);
  for (const b of arming.blockers) lines.push(`   ${b}`);
  lines.push('   🔴 A SECRET IS NOT AN AUTHORISATION. The register is the switch; a credential that exists for');
  lines.push('   a row nothing arms means the two halves of one change landed apart. Flip the row, or delete');
  lines.push('   the secret — do not let a publish decide on the strength of a vault entry.');
  return { verdict: 'pending', row, arming, missing, lines };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE LANE TABLE — which credentials each extension store needs, BY NAME, and
// the exact owner step that creates them.
//
// 🔴 IT LIVES HERE AND NOT IN THE THREE PUBLISH SCRIPTS, because the workflow
// preflight and the publish itself must ask the SAME question. A preflight with
// its own copy of the credential list is the shape that reports "all present"
// over a list one name shorter than the one the publish uses.
//
// Every `why` names the primary source the value is read from, so a reader can
// check the claim against the page rather than against this file.
// ─────────────────────────────────────────────────────────────────────────────
const AMO_DOC = 'https://extensionworkshop.com/documentation/develop/web-ext-command-reference/';
const CWS_DOC = 'https://developer.chrome.com/docs/webstore/using-api';
const EDGE_DOC = 'https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api';
const EXT_RUNBOOK = 'Private/runbooks/store-submission-extensions.md';

export const LANES = Object.freeze({
  amo: {
    channelId: 'amo',
    label: 'Firefox Add-ons (addons.mozilla.org)',
    secrets: [
      { name: 'AMO_JWT_ISSUER', why: `the AMO API key (JWT issuer), passed to web-ext as --api-key (${AMO_DOC})` },
      { name: 'AMO_JWT_SECRET', why: `the AMO API secret (JWT secret), passed to web-ext as --api-secret (${AMO_DOC})` },
    ],
    ownerStep:
      `create an addons.mozilla.org developer account, generate credentials at https://addons.mozilla.org/developers/addon/api/key/, and add them as the repository secrets AMO_JWT_ISSUER and AMO_JWT_SECRET. AMO is the ONE store whose API can make a first submission, so this row can be armed without a console publish first. Runbook: ${EXT_RUNBOOK}`,
  },
  'chrome-webstore': {
    channelId: 'chrome-webstore',
    label: 'Chrome Web Store',
    secrets: [
      { name: 'CWS_CLIENT_ID', why: `the OAuth client id of the Google Cloud project authorised for the chromewebstore scope (${CWS_DOC})` },
      { name: 'CWS_CLIENT_SECRET', why: `that client's secret (${CWS_DOC})` },
      { name: 'CWS_REFRESH_TOKEN', why: `the refresh token obtained once through the OAuth playground; the cws-token-keepalive job exists to keep it alive (${CWS_DOC})` },
      { name: 'CWS_ITEM_ID', why: 'the Chrome Web Store item id — issued by the store at the first MANUAL publish and not derivable' },
      { name: 'CWS_PUBLISHER_ID', why: `the publisher id shown in the Developer Dashboard under Publisher → Settings; the v2 API path carries it and the older v1.1 path did not (${CWS_DOC})` },
    ],
    ownerStep:
      `pay the $5 Chrome Web Store developer fee, publish FullShot MANUALLY once (no store API can create a first submission — ADR 067 decision 8), create an OAuth client, exchange a refresh token through the OAuth playground with the https://www.googleapis.com/auth/chromewebstore scope, then add CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_ITEM_ID and CWS_PUBLISHER_ID as repository secrets. Runbook: ${EXT_RUNBOOK}`,
  },
  'edge-addons': {
    channelId: 'edge-addons',
    label: 'Microsoft Edge Add-ons',
    secrets: [
      { name: 'EDGE_CLIENT_ID', why: `the Partner Center client id sent as the X-ClientID header (${EDGE_DOC})` },
      { name: 'EDGE_API_KEY', why: `the Partner Center API key sent as Authorization: ApiKey <key> (${EDGE_DOC})` },
      { name: 'EDGE_PRODUCT_ID', why: 'the product id on the extension overview page in Partner Center — issued at the first MANUAL publish and not derivable' },
    ],
    ownerStep:
      `register FullShot in Partner Center → Microsoft Edge program, publish it MANUALLY once (ADR 067 decision 8), enable the v1.1 API in Partner Center (Publish API → Enable), then add EDGE_CLIENT_ID, EDGE_API_KEY and EDGE_PRODUCT_ID as repository secrets. Runbook: ${EXT_RUNBOOK}`,
  },
});

/** The verdict for a named lane, so a caller names a LANE and never a list of
 *  secrets it typed out again. */
export function laneVerdict(laneId, { env = process.env, root = REPO_ROOT } = {}) {
  const lane = LANES[laneId];
  if (lane === undefined) {
    throw new ArmingCoverageLost([
      `COVERAGE LOST — no lane "${laneId}" is declared in publish-arming.mjs; it declares [${Object.keys(LANES).join(', ')}].`,
      'A lane this table does not know cannot be graded, and answering "nothing to do" for it would be a',
      'pass produced by a typo.',
    ]);
  }
  return publishVerdict({ channelId: lane.channelId, secrets: lane.secrets, ownerStep: lane.ownerStep, env, root });
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI — the workflow PREFLIGHT. `node scripts/publish-arming.mjs --channel <id>`
// prints the verdict and exits 1 only when the register ARMS the row and a
// credential is empty. It is deliberately NOT named `publish-<store>.mjs`: the
// dry-run-guard check treats that spelling as a publishing surface, and a
// preflight that publishes nothing must be able to run on a rehearsal.
// ─────────────────────────────────────────────────────────────────────────────
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--channel');
  const laneId = i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
  if (laneId === null) {
    console.error('FAIL --channel <id> is required. Known lanes: ' + Object.keys(LANES).join(', '));
    process.exitCode = 1;
  } else {
    try {
      const result = laneVerdict(laneId);
      for (const l of result.lines) console.log(l);
      if (result.verdict === 'refuse') process.exitCode = 1;
    } catch (e) {
      if (e instanceof ArmingCoverageLost) {
        for (const l of e.lines) console.error(l);
        process.exitCode = 1;
      } else {
        throw e;
      }
    }
  }
}
