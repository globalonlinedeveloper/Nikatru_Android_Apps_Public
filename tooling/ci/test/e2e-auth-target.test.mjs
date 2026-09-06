// ─────────────────────────────────────────────────────────────────────────────
// e2e-auth-target.test.mjs — the two target-aware E2E harness steps, exercised
// against a real HTTP server rather than exempted.
//
// `tooling/e2e/captcha_posture.mjs` and `tooling/e2e/assert_one_issuer.mjs` are
// the halves of the cutover blocker that assert a DIFFERENT fact depending on
// which auth stack `e2e.yml` pointed the run at. Every other file under
// `tooling/e2e/` carries an entry in assert-guard-coverage's
// NO_NEGATIVE_TEST_NEEDED map, on the honest ground that a fixture cannot model
// a live deletion or a live consent row. These two are not in that class: both
// take an HTTP answer and turn it into an exit code, and an HTTP answer is
// exactly what a loopback server can produce. So they get real failing cases.
//
// 🔴 WHAT IS ACTUALLY BEING PROTECTED. Each script has a branch that must exit 1
// on a response that LOOKS ordinary:
//   · hosted answering `captcha_failed` — hosted Supabase has begun enforcing a
//     captcha, so a web build carrying TURNSTILE_SITE_KEY may be one nobody can
//     sign in to. Silence here would be a deploy that breaks sign-in.
//   · boxa answering `invalid_credentials` — the captcha gate on the auth box is
//     OFF, which is an open anonymous signup, not a test failure.
//   · boxa's session being ACCEPTED by the Worker — the Workers now trust two
//     issuers, which nothing in services/ implements and nobody decided.
// A green control precedes each of those, because a case that fails for the
// wrong reason is not a case at all.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CAPTCHA_POSTURE = join(REPO, 'tooling', 'e2e', 'captcha_posture.mjs');
const ONE_ISSUER = join(REPO, 'tooling', 'e2e', 'assert_one_issuer.mjs');

/** What the fake GoTrue / Worker should answer on this case. Mutated per test. */
const plan = {
  tokenStatus: 400,
  tokenBody: { error_code: 'invalid_credentials' },
  generateLinkStatus: 200,
  generateLinkBody: { hashed_token: 'pkce_deadbeefdeadbeefdeadbeefdeadbeef' },
  verifyStatus: 200,
  verifyBody: { access_token: 'header.payload.signature' },
  apiStatus: 200,
  apiBody: [],
};

let server;
let origin;

before(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const answer = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    // Bodies are read and discarded: what is under test is how the SCRIPT reads
    // an answer, not what GoTrue does with a request.
    req.resume();
    if (path === '/auth/v1/token') return answer(plan.tokenStatus, plan.tokenBody);
    if (path === '/auth/v1/admin/generate_link') {
      return answer(plan.generateLinkStatus, plan.generateLinkBody);
    }
    if (path === '/auth/v1/verify') return answer(plan.verifyStatus, plan.verifyBody);
    if (path === '/v1/subscriptions') return answer(plan.apiStatus, plan.apiBody);
    return answer(404, { error: 'no such route in the fake' });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((done) => server.close(done));
});

/** Runs one of the two scripts and resolves with its exit code and output.
 *
 * 🔴 ASYNC, AND `spawnSync` IS THE BUG IT REPLACES. The fake GoTrue above lives
 * in THIS process, so a synchronous spawn blocks the event loop that has to
 * answer the child's request: the child waits for a response nobody can send and
 * the parent waits for a child that cannot finish. Measured 2026-09-07 — the
 * suite hung rather than failed, which is the worse of the two.
 */
function run(script, env) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [script], {
      cwd: REPO,
      env: {
        ...process.env,
        SUPABASE_URL: origin,
        SUPABASE_ANON_KEY: 'anon-key-for-the-fake',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-the-fake',
        E2E_EMAIL: 'subly-e2e+fixture@nikatru.com',
        API_BASE_URL: origin,
        ...env,
      },
    });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('close', (code) => done({ code, out }));
  });
}

describe('captcha_posture.mjs — what the target does with a token it never asked for', () => {
  test('GREEN CONTROL · hosted ignores the token and checks the password', async () => {
    plan.tokenStatus = 400;
    plan.tokenBody = { error_code: 'invalid_credentials' };
    const r = await run(CAPTCHA_POSTURE, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /MEASURED: hosted GoTrue IGNORED the captcha token/);
  });

  test('hosted answering captcha_failed FAILS — it has started enforcing a gate', async () => {
    plan.tokenStatus = 400;
    plan.tokenBody = { error_code: 'captcha_failed' };
    const r = await run(CAPTCHA_POSTURE, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Captcha posture changed/);
  });

  test('GREEN CONTROL · boxa refuses at the captcha before the password', async () => {
    plan.tokenStatus = 400;
    plan.tokenBody = { error_code: 'captcha_failed' };
    const r = await run(CAPTCHA_POSTURE, { E2E_AUTH_TARGET: 'boxa' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Box A REFUSED the request at the captcha/);
  });

  test('boxa answering invalid_credentials FAILS — the gate is off', async () => {
    plan.tokenStatus = 400;
    plan.tokenBody = { error_code: 'invalid_credentials' };
    const r = await run(CAPTCHA_POSTURE, { E2E_AUTH_TARGET: 'boxa' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Box A captcha gate is not answering/);
  });

  test('a 200 on the sign-in FAILS on either target — nobody signed anybody in', async () => {
    plan.tokenStatus = 200;
    plan.tokenBody = { access_token: 'this-should-never-happen' };
    const hosted = await run(CAPTCHA_POSTURE, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(hosted.code, 1, hosted.out);
    const boxa = await run(CAPTCHA_POSTURE, { E2E_AUTH_TARGET: 'boxa' });
    assert.equal(boxa.code, 1, boxa.out);
  });

  test('an unknown target FAILS rather than defaulting to the safe-looking one', async () => {
    const r = await run(CAPTCHA_POSTURE, { E2E_AUTH_TARGET: 'staging' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /must be "hosted" or "boxa"/);
  });

  test('a missing SUPABASE_ANON_KEY FAILS rather than probing with an empty one', async () => {
    const r = await run(CAPTCHA_POSTURE, { E2E_AUTH_TARGET: 'hosted', SUPABASE_ANON_KEY: '' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Missing required env var: SUPABASE_ANON_KEY/);
  });
});

describe('assert_one_issuer.mjs — the Workers trust exactly one issuer', () => {
  before(() => {
    plan.generateLinkStatus = 200;
    plan.generateLinkBody = { hashed_token: 'pkce_deadbeefdeadbeefdeadbeefdeadbeef' };
    plan.verifyStatus = 200;
    plan.verifyBody = { access_token: 'header.payload.signature' };
  });

  test('GREEN CONTROL · hosted mints a session the Worker accepts', async () => {
    plan.apiStatus = 200;
    const r = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ASSERTED: the deployed Worker accepts a hosted-minted session/);
  });

  test('hosted being refused 401 FAILS — the Workers no longer trust the project they are configured for', async () => {
    plan.apiStatus = 401;
    const r = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /One-issuer check/);
  });

  test('GREEN CONTROL · boxa is refused 401, and the refusal is the pass', async () => {
    plan.apiStatus = 401;
    const r = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'boxa' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Refusal here is the PASS/);
  });

  test('boxa being ACCEPTED FAILS, and says so as a security finding', async () => {
    plan.apiStatus = 200;
    const r = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'boxa' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /trust TWO issuers/);
  });

  test('no access_token FAILS before the Worker is ever asked', async () => {
    plan.apiStatus = 200;
    plan.verifyStatus = 403;
    plan.verifyBody = { error_code: 'otp_expired' };
    const r = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Could not mint a session/);
    plan.verifyStatus = 200;
    plan.verifyBody = { access_token: 'header.payload.signature' };
  });

  test('generate_link answering without a hashed_token FAILS rather than sending an empty one', async () => {
    plan.generateLinkBody = { action_link: 'https://example.invalid/verify' };
    const r = await run(ONE_ISSUER, { E2E_AUTH_TARGET: 'hosted' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /No hashed_token in generate_link response/);
    plan.generateLinkBody = { hashed_token: 'pkce_deadbeefdeadbeefdeadbeefdeadbeef' };
  });
});
