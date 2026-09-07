#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// publish-cws-keepalive.mjs — exchange the Chrome Web Store refresh token on a
// schedule, so it does not die of disuse between releases.
//
// 🔴 THE FAILURE THIS EXISTS FOR IS SILENT. A Google OAuth refresh token issued
// to a client whose consent screen is in "Testing" expires after seven days, and
// any refresh token that goes unused long enough is revoked — so the token this
// factory needs on release day is exactly the token nothing touches between
// releases. Nothing in the tree would say so until the first tag push, at which
// point the store call fails with `invalid_grant` on the one path that ships
// bytes. A weekly exchange turns a release-day surprise into a Monday alarm.
//
// ── WHAT IT DOES AND DOES NOT FAIL ON ────────────────────────────────────────
// It runs the SAME exchange the publish runs (`publish-cws-token.mjs`, imported,
// never restated), and then applies the register's arming rule:
//   · `chrome-webstore` ARMED and the exchange FAILS  → exit 1. The credential
//     the release lane depends on is dead and somebody has to re-mint it.
//   · ARMED and the exchange succeeds                 → exit 0, printing the
//     lifetime and the scope, never the token.
//   · NOT ARMED                                       → exit 0, printing the
//     owner step. [pipeline C-6]: no agent can create these secrets, so failing
//     here would redden a scheduled lane on work only the owner can do.
//
// ⚠️ NEVER `process.exit()` AFTER A `fetch` ON WINDOWS (TRAPS shell-12).
//
// Usage:  node scripts/publish-cws-keepalive.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { publishVerdict, LANES, ArmingCoverageLost, REPO_ROOT } from './publish-arming.mjs';
import { exchangeRefreshToken, CWS_API_DOC } from './publish-cws-token.mjs';

/** The subset of the Chrome lane this job actually exercises: the three values
 *  the token exchange needs. Taken FROM the lane table by name rather than
 *  retyped, so the reason each one exists has exactly one home. */
const KEEPALIVE = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN'];
const KEEPALIVE_SECRETS = LANES['chrome-webstore'].secrets.filter((s) => KEEPALIVE.includes(s.name));

async function main() {
  let result = null;
  try {
    result = publishVerdict({ channelId: 'chrome-webstore', secrets: KEEPALIVE_SECRETS, ownerStep: LANES['chrome-webstore'].ownerStep, root: REPO_ROOT });
  } catch (e) {
    if (e instanceof ArmingCoverageLost) {
      console.error('');
      for (const l of e.lines) console.error(l);
      console.error('\ncws-token-keepalive: FAILED');
      process.exitCode = 1;
      return;
    }
    throw e;
  }
  for (const l of result.lines) console.log(l);

  if (result.verdict === 'refuse') {
    // Armed with a missing credential: the release lane cannot publish, and the
    // whole point of a keep-alive is to say so on a Monday rather than on a tag.
    process.exitCode = 1;
    return;
  }
  if (result.verdict !== 'go') {
    console.log('cws-token-keepalive: NOTHING TO KEEP ALIVE — the register does not arm chrome-webstore.');
    return;
  }

  const tok = await exchangeRefreshToken({
    clientId: process.env.CWS_CLIENT_ID,
    clientSecret: process.env.CWS_CLIENT_SECRET,
    refreshToken: process.env.CWS_REFRESH_TOKEN,
  });
  if (!tok.ok) {
    console.error('');
    console.error(`FAIL the refresh-token exchange returned HTTP ${tok.status}: ${tok.detail}`);
    console.error(`     Source: ${CWS_API_DOC}. The register ARMS chrome-webstore, so the release lane depends`);
    console.error('     on this credential and it is not working. Re-mint the refresh token through the OAuth');
    console.error('     playground and replace CWS_REFRESH_TOKEN; nothing else in the tree will notice it died.');
    console.error('\ncws-token-keepalive: FAILED');
    process.exitCode = 1;
    return;
  }
  console.log(`cws-token-keepalive: OK — access token obtained, expires_in ${tok.expiresIn}s, scope ${tok.scope}. The token value is never printed.`);
}

await main();
