#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// publish-cws-token.mjs — the ONE Chrome Web Store refresh-token exchange.
//
// 🔴 IT IS ITS OWN MODULE SO THE KEEP-ALIVE RUNS THE SAME EXCHANGE THE PUBLISH
// RUNS. A keep-alive that refreshes something adjacent keeps the wrong thing
// alive and reports success, which is the worst possible shape for a credential
// whose failure mode is silent expiry.
//
// Source (fetched 2026-09-07): https://developer.chrome.com/docs/webstore/using-api
//   POST https://oauth2.googleapis.com/token
//   client_secret=…&grant_type=refresh_token&refresh_token=…&client_id=…
// answering `{ access_token, expires_in, refresh_token, scope, token_type }`.
//
// ⚠️ NOTHING HERE PRINTS A TOKEN. The caller receives the access token as a
// value; what is ever printed is its lifetime and its scope.
// ─────────────────────────────────────────────────────────────────────────────
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const CWS_API_DOC = 'https://developer.chrome.com/docs/webstore/using-api';

/**
 * Exchange a refresh token for an access token.
 * @returns {Promise<{ok:true, accessToken:string, expiresIn:(number|null), scope:(string|null)}
 *                  | {ok:false, status:number, detail:string}>}
 */
export async function exchangeRefreshToken({ clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    client_id: String(clientId ?? ''),
    client_secret: String(clientSecret ?? ''),
    refresh_token: String(refreshToken ?? ''),
    grant_type: 'refresh_token',
  });
  const r = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await r.text();
  if (!r.ok) {
    // A token error body names the reason (`invalid_grant` for a dead refresh
    // token) and carries no secret of ours, so it is safe to print and it is the
    // only thing that tells an operator WHICH way the credential died.
    return { ok: false, status: r.status, detail: text.slice(0, 500) };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, status: r.status, detail: `the token endpoint answered 200 with non-JSON — ${e.message}` };
  }
  if (typeof json.access_token !== 'string' || json.access_token === '') {
    return { ok: false, status: r.status, detail: 'the token endpoint answered 200 with no access_token' };
  }
  return { ok: true, accessToken: json.access_token, expiresIn: json.expires_in ?? null, scope: json.scope ?? null };
}
