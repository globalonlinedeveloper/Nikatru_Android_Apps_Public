import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { corsMiddleware } from '../src/middleware/cors';
import type { AppEnv } from '../src/types';
import raw from '../wrangler.jsonc?raw';

/** A minimal app wired exactly like index.ts, with a settable ALLOWED_ORIGINS. */
function appWith(allowedOrigins: string) {
  const app = new Hono<AppEnv>();
  app.use('*', corsMiddleware);
  app.get('/x', (c) => c.json({ ok: true }));
  app.delete('/x', (c) => c.json({ ok: true }));
  return (method: string, origin?: string) =>
    app.request(
      '/x',
      { method, headers: origin === undefined ? {} : { Origin: origin } },
      { ALLOWED_ORIGINS: allowedOrigins } as AppEnv['Bindings'],
    );
}

/** 🔴 READ OUT OF THE DEPLOYED CONFIG, NOT RETYPED FROM IT.
 *
 *  This constant used to be a hand-copied string whose comment said it "mirrors
 *  the deployed `vars.ALLOWED_ORIGINS`" — and on 2026-09-09 it stopped doing so
 *  twice in one day: [ADR 075] added the apex when the app moved to
 *  `nikatru.com/<id>`, and removed `subly.nikatru.com` when the zone Redirect
 *  Rule retired it. Nothing went red either time. The file went on describing,
 *  in a comment, a deployment that no longer existed, and named a RETIRED origin
 *  as though a browser still sent it.
 *
 *  The old note argued that reading wrangler.jsonc "needs node APIs this
 *  Worker's tsconfig deliberately does not expose". That was wrong on the facts:
 *  `services/subscriptiontracker-api/test/wrangler-config.test.ts` has read its own config
 *  since it was written, with `?raw` and a local JSONC parser — no node API at
 *  all. The reason a hand-copy survived here was that nobody had needed it to be
 *  right yet.
 *
 *  So the behaviour tests below now run against the ACTUAL shipped list. A
 *  divergence between this suite and the deploy is no longer possible, because
 *  there is nothing left to diverge. */
const SHIPPED = String(
  ((parseJsonc(raw) as { vars?: Record<string, unknown> }).vars ?? {}).ALLOWED_ORIGINS ?? '',
);

/** JSONC → JSON. Comments stripped (string literals respected, so a `//` inside
 *  a URL survives) and trailing commas removed. Same shape as the parser in
 *  services/subscriptiontracker-api/test/wrangler-config.test.ts, and same reason: a
 *  wrangler.jsonc is mostly prose, and a grep over it matches the comment that
 *  EXPLAINS a setting as readily as the setting. */
function parseJsonc(text: string): unknown {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    const c2 = text[i + 1];
    if (inStr) {
      if (c === '\\') {
        out += c + (c2 ?? '');
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && c2 === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

describe('the fixture below IS the deployed allowlist', () => {
  it('is a non-empty exact list read from wrangler.jsonc', () => {
    expect(SHIPPED.length, 'ALLOWED_ORIGINS is absent from services/platform/wrangler.jsonc').toBeGreaterThan(0);
    expect(SHIPPED, 'wildcards are not an allowlist').not.toContain('*');
  });

  it('carries the apex — the origin every app page is served from since [ADR 075]', () => {
    expect(SHIPPED.split(',').map((s) => s.trim())).toContain('https://nikatru.com');
  });

  it('no longer carries the retired app subdomain', () => {
    // Not a tautology: this list is the only thing between a host that serves
    // nothing but a 301 and a standing CORS grant, and re-adding it is one word.
    expect(SHIPPED.split(',').map((s) => s.trim())).not.toContain('https://subly.nikatru.com');
  });

  it('no longer carries the retired pre-rename Pages origin', () => {
    // ⏱ 2026-09-11, the NARROW step. A *.pages.dev name is claimable by anyone
    // once its project is deleted, so this grant must leave BEFORE the project does.
    expect(SHIPPED.split(',').map((s) => s.trim())).not.toContain('https://subly-9cp.pages.dev');
  });
});

describe('platform CORS (shared Worker — ADR 020, exact allowlist)', () => {
  it('allows the write methods the shared endpoints need', async () => {
    // Regression guard: while this was a config-read-only host the list was
    // `GET, OPTIONS`, which preflight-blocks DELETE /v1/account from every web
    // build — a failure that presents as a browser bug, not a config bug.
    const res = await appWith(SHIPPED)('OPTIONS', 'https://nikatru.com');
    expect(res.status).toBe(204);
    const methods = res.headers.get('Access-Control-Allow-Methods') ?? '';
    for (const m of ['GET', 'POST', 'DELETE', 'OPTIONS']) {
      expect(methods, `missing ${m}`).toContain(m);
    }
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('reflects an origin that is on the list, exactly', async () => {
    const call = appWith(SHIPPED);
    for (const origin of SHIPPED.split(',')) {
      const res = await call('GET', origin);
      expect(res.headers.get('Access-Control-Allow-Origin'), origin).toBe(origin);
      expect(res.headers.get('Vary')).toBe('Origin');
    }
  });

  it('refuses everything not on the list — no pattern matching at all', async () => {
    const call = appWith(SHIPPED);
    for (const origin of [
      'https://other.nikatru.com', // a SIBLING portfolio origin is not implied
      // ⏱ `https://nikatru.com` MOVED OUT OF THIS LIST on 2026-09-09 [ADR 075]:
      // it is now where every app page is SERVED, so refusing it would take the
      // whole portfolio's config and analytics offline. The near-miss shapes it
      // brought with it stay, and they matter more here than they did on a
      // subdomain — an origin that merely LOOKS like the apex now looks like
      // every app at once, not one of them.
      'https://nikatru.com.evil.test', // suffix-of-hostname attack
      'https://evilnikatru.com', // prefix-of-hostname attack
      'http://nikatru.com', // plaintext variant of an allowed origin
      'https://nikatru.com/', // trailing slash is a different origin
      'https://nikatru.com/subly', // an origin is not a URL: the PATH is not part of it
      'https://subly.nikatru.com', // the RETIRED subdomain is refused, not grandfathered
      'https://example.com',
      'not-a-url',
    ]) {
      const res = await call('GET', origin);
      expect(res.headers.get('Access-Control-Allow-Origin'), origin).toBeNull();
    }
  });

  it('an EMPTY allowlist denies every browser origin — it is NOT a wildcard', async () => {
    // The semantics changed on 2026-07-25: empty used to mean '*'. Clearing the
    // var now takes every web build offline for config + analytics, so this must
    // fail loudly in a test rather than quietly in production.
    // Probed with the origin that IS on the list when the list is not empty —
    // the apex since [ADR 075]. Probing a host that would be refused anyway
    // proves nothing about emptiness.
    const call = appWith('');
    expect(
      (await call('GET', 'https://nikatru.com')).headers.get('Access-Control-Allow-Origin'),
    ).toBeNull();
  });

  it('tolerates whitespace and empty entries in the var', async () => {
    const call = appWith(' https://a.test , ,https://b.test ');
    expect((await call('GET', 'https://a.test')).headers.get('Access-Control-Allow-Origin')).toBe(
      'https://a.test',
    );
    expect((await call('GET', 'https://b.test')).headers.get('Access-Control-Allow-Origin')).toBe(
      'https://b.test',
    );
  });

  it('a non-browser caller (no Origin header) is unaffected', async () => {
    // CORS is a browser mechanism; these callers were never gated by it.
    const res = await appWith(SHIPPED)('GET');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.status).toBe(200);
  });

});
