import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

// CORS — an EXACT allowlist, FAIL CLOSED. The same rule as services/platform
// and services/subly-api; a fork HERE is not one bad app, it is every app the
// factory will ever stamp, born wrong.
//
// `ALLOWED_ORIGINS` is a comma-separated list of exact browser origins. An
// origin is either on that list or it gets no CORS headers and the browser
// blocks it. Nothing is pattern-matched.
//
// ⚠️ AN EMPTY OR ABSENT LIST DENIES EVERY NON-LOCALHOST BROWSER ORIGIN — it does
// NOT fall back to '*'. It used to ("template mode"), which meant a stamped app
// shipped answering every browser origin until someone remembered to fill the
// var in, and nothing in CI could see it. Put this app's web origin in
// wrangler.jsonc `vars.ALLOWED_ORIGINS` (the post_gen checklist prints this
// step); tooling/ci/assert-cors-allowlist.mjs iterates every
// services/*/wrangler.jsonc and fails the build on an empty list.
//
// ⏱ CORRECTED 2026-09-08 — THE SENTENCE ABOVE USED TO SAY "and add the service
// to tooling/ci/assert-cors-allowlist.mjs", in the same breath as saying that
// guard iterates every config. Both halves cannot be true, and it is the second:
// the guard DERIVES its subjects from `services/` on disk and derives each
// Worker's required origins from catalog/apps.json, so a Worker stamped as
// `<slug>-api` for a catalogue slug is covered with no edit to any guard. The
// instruction sent the owner to hand-edit a file that had stopped needing it.
//
// Localhost (any port, http/https) is allowed ON TOP of the list so local dev
// and the `flutter drive -d web-server` CI harness — which picks a random port
// and so cannot be named in advance — can reach the API. A localhost page still
// needs a valid Bearer token to read anything. This is a recorded PER-APP trade;
// the shared platform Worker deliberately does not carry it.
const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export const corsMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header('Origin') ?? '';
  const allow = (c.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // No Origin header ⇒ a non-browser caller (the Flutter mobile/desktop HTTP
  // stack, curl, server-to-server). Nothing to reflect; never gated by CORS.
  const allowed =
    origin === ''
      ? '*'
      : allow.includes(origin) || LOCALHOST.test(origin)
        ? origin
        : '';
  if (allowed) {
    c.header('Access-Control-Allow-Origin', allowed);
    c.header('Vary', 'Origin');
    c.header(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, x-request-id',
    );
    c.header(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    );
  }
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
  return;
};
