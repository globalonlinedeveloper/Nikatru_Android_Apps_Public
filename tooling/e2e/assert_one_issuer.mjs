// Asserts the ONE-ISSUER fact, in whichever direction this run's auth target
// makes it true — positively, on every run, rather than as a leg that gets
// skipped when the answer would be inconvenient.
//
// ── THE FACT
//
// `runbooks/auth-cutover.md` Phase 5: "every hosted-minted session 401s
// portfolio-wide. There is no dual-issuer path in the code — the Workers trust
// exactly one issuer." Today that issuer is the HOSTED Supabase project, so:
//
//   hosted → a token this run minted is ACCEPTED by the deployed Worker (200).
//   boxa   → the same request with a BOX A-minted token is REFUSED (401).
//
// Both are things that must be true. Writing only the first would leave the
// second as a comment; writing only the second would leave it unexercised until
// the day it matters. Writing both means the day the Workers gain a second
// issuer — or lose the first — this step names it in one line instead of six
// golden-path screenshots ending at a blank page.
//
// ⚠️ THIS IS NOT THE CUTOVER. Nothing here changes a Worker, a secret or KV.
// It reads what the deployed Worker already does with a token it is handed.
//
// ── HOW IT GETS A TOKEN WITHOUT SPENDING THE DRIVER'S
//
// `provision_user.mjs` mints ONE single-use magic-link token per user and the
// browser spends it; a replay returns 403 (measured against Box A 2026-09-04).
// So this step mints its OWN, from the same admin route, for the same already
// provisioned throwaway user — `admin/generate_link` is not single-use, the
// TOKEN it returns is. `/verify` is not captcha-gated on either target
// (auth-cutover.md §4.7), which is why this works against Box A at all.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, E2E_EMAIL,
//      API_BASE_URL, E2E_AUTH_TARGET (default `hosted`).

const url = need('SUPABASE_URL').replace(/\/+$/, '');
const anonKey = need('SUPABASE_ANON_KEY');
const serviceKey = need('SUPABASE_SERVICE_ROLE_KEY');
const email = need('E2E_EMAIL');
const apiBase = need('API_BASE_URL').replace(/\/+$/, '');
const target = process.env.E2E_AUTH_TARGET || 'hosted';

if (target !== 'hosted' && target !== 'boxa') {
  console.error(`E2E_AUTH_TARGET must be "hosted" or "boxa", not "${target}".`);
  process.exitCode = 1;
} else {
  const linkRes = await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  if (!linkRes.ok) {
    console.error(`generate_link failed: HTTP ${linkRes.status}`);
    process.exitCode = 1;
  } else {
    const link = await linkRes.json();
    const tokenHash = link.hashed_token;
    if (!tokenHash) {
      console.error(
        `No hashed_token in generate_link response (keys: ${Object.keys(link).sort().join(', ')})`,
      );
      process.exitCode = 1;
    } else {
      console.log(`::add-mask::${tokenHash}`);
      const verifyRes = await fetch(`${url}/auth/v1/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey },
        body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
      });
      const session = verifyRes.ok ? await verifyRes.json() : null;
      const accessToken = session?.access_token ?? '';
      if (!accessToken) {
        console.error(
          `::error title=Could not mint a session::/verify answered HTTP ${verifyRes.status} with no ` +
            'access_token, so nothing could be presented to the Worker. On boxa this is the ' +
            'magic-link login path itself failing, which is a bigger finding than the one-issuer check.',
        );
        process.exitCode = 1;
      } else {
        console.log(`::add-mask::${accessToken}`);
        const probe = await fetch(`${apiBase}/v1/subscriptions`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        console.log(`auth target : ${target}`);
        console.log(`token issuer: the ${target === 'boxa' ? 'Box A' : 'hosted'} auth stack`);
        console.log(`GET ${apiBase}/v1/subscriptions -> HTTP ${probe.status}`);

        if (target === 'hosted') {
          if (probe.status === 200) {
            console.log(
              'ASSERTED: the deployed Worker accepts a hosted-minted session. The one issuer the ' +
                'Workers trust is still the hosted project, which is what Phase 5 moves.',
            );
          } else {
            console.error(
              `::error title=One-issuer check::the Worker answered ${probe.status} to a token minted ` +
                'by the auth project it is configured for. Either SUPABASE_URL on the Workers has ' +
                'moved, or the JWKS fetch is failing — see runbooks/auth-cutover.md Phase 1.',
            );
            process.exitCode = 1;
          }
        } else if (probe.status === 401) {
          console.log(
            'ASSERTED: the deployed Worker REFUSES a Box A-minted session with 401. This is the ' +
              'one-issuer fact, and it is why the golden-path legs below cannot pass against boxa ' +
              'until Phase 5 moves SUPABASE_URL on both Workers. Refusal here is the PASS.',
          );
        } else {
          console.error(
            `::error title=One-issuer check::the Worker answered ${probe.status}, not 401, to a Box ` +
              'A-minted session. If it answered 200 the Workers now trust TWO issuers, which no code ' +
              'path in services/ implements and which nobody decided — treat it as a security ' +
              'finding, not a test failure.',
          );
          process.exitCode = 1;
        }
      }
    }
  }
}

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}
