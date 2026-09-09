import { describe, it, expect } from 'vitest';
// `?raw` rather than node:fs — a Workers tsconfig has no node types on purpose.
import raw from '../wrangler.jsonc?raw';
// The DECLARATIONS, not a second spelling of them. `?raw` keeps this inside the
// Workers tsconfig, which has no node types on purpose.
import catalogueRaw from '../../../catalog/apps.json?raw';
import appYamlRaw from '../../../apps/subscriptiontracker/app.yaml?raw';

// ─────────────────────────────────────────────────────────────────────────────
// The DEPLOYED half of this Worker's configuration.
//
// cors.test.ts proves the MIDDLEWARE denies an origin that is not listed. That
// is now a fail-closed rule, so the config it reads became load-bearing in the
// other direction: clearing `vars.ALLOWED_ORIGINS` takes the live web app
// offline, and `tsc --noEmit` and `wrangler deploy --dry-run` — the only two
// checks this Worker had — never inspect a var's contents. The unit tests inject
// their own bindings, so they cannot see it either.
//
// Asserted on PARSED STRUCTURE, never by grepping the file's prose: a
// wrangler.jsonc here is mostly comments, several of which name the very
// strings being looked for. Same discipline as
// services/platform/test/wrangler-breaker.test.ts and
// tooling/ci/assert-d1-bindings.mjs.
//
// tooling/ci/assert-cors-allowlist.mjs asserts the same allowlist across EVERY
// Worker; this file is the per-Worker copy that runs in this Worker's own lane.
// ─────────────────────────────────────────────────────────────────────────────

/** JSONC → JSON. Comments stripped (string literals respected, so a `//` inside
 *  a url survives) and trailing commas removed. */
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

interface D1Entry {
  binding?: string;
  database_name?: string;
  database_id?: string;
  migrations_dir?: string;
}
const cfg = parseJsonc(raw) as {
  name?: string;
  vars?: Record<string, unknown>;
  d1_databases?: D1Entry[];
};

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE IDENTITY UNDER TEST IS DERIVED, NEVER SPELT.
//
// This block replaces three string literals — the Worker name, and the two
// origins below. A literal here is DISARMED by a whole-tree rename: the replace
// rewrites `wrangler.jsonc` and this assertion in the same pass, so the test
// goes on passing while proving nothing. Measured on the 2026-09-09
// `subly` → `subscriptiontracker` rename, which is exactly what happened.
//
// The declarations are independent of the config being asserted:
//   · `catalog/apps.json`   — the slug, from which `<slug>-api` follows
//   · `apps/<slug>/app.yaml` — `hosts.pagesOrigin`, which is NOT derivable
//                              (Cloudflare assigns the *.pages.dev subdomain at
//                              project creation) and so must be read, not guessed
// A half-done rename now shows up here as a real mismatch.
// ─────────────────────────────────────────────────────────────────────────────

/** The one slug `catalog/apps.json` declares. */
const SLUG: string = (() => {
  const rows = JSON.parse(catalogueRaw) as Array<{ slug?: string }>;
  const slugs = rows.map((r) => r.slug).filter((s): s is string => !!s);
  // COVERAGE LOST, never a silent pass: with more or fewer than one app there is
  // no unambiguous subject and this file must say so rather than pick one.
  if (slugs.length !== 1) {
    throw new Error(
      `catalog/apps.json must declare exactly one app for wrangler-config.test.ts ` +
        `to have a subject; it declares ${slugs.length}.`,
    );
  }
  return slugs[0];
})();

/** The app's PUBLIC ADDRESS, from the catalogue row. Since [ADR 075] this is a
 *  path on the apex (`https://nikatru.com/<id>`), so its ORIGIN is what a browser
 *  tab actually sends and is what the allowlist has to carry. Derived here so the
 *  day the public address moves again, this assertion moves with it. */
function catalogueUrl(): string {
  const rows = JSON.parse(catalogueRaw) as Array<{ slug?: string; url?: string }>;
  const row = rows.find((r) => r.slug === SLUG);
  if (!row || typeof row.url !== 'string') {
    throw new Error(`catalog/apps.json row "${SLUG}" carries no \`url\` — COVERAGE LOST.`);
  }
  return row.url;
}

/** A scalar under `hosts:` in app.yaml, read without a YAML parser (the Workers
 *  tsconfig carries no dependency for one, and the shape here is two levels of
 *  plain `key: value`). */
function hostsField(name: string): string {
  const hosts = appYamlRaw.split(/^hosts:\s*$/m)[1];
  if (hosts === undefined) throw new Error('app.yaml declares no `hosts:` block.');
  for (const line of hosts.split(/\r?\n/)) {
    if (/^\S/.test(line) && line.trim() !== '') break; // left the block
    const m = /^\s+([A-Za-z]+):\s*(\S+)\s*$/.exec(line);
    if (m && m[1] === name) return m[2];
  }
  throw new Error(`app.yaml's hosts block declares no \`${name}\` — COVERAGE LOST.`);
}

describe('the parse itself reached the config', () => {
  it('self-check — every assertion below would pass vacuously over an empty parse', () => {
    expect(raw).toContain('ALLOWED_ORIGINS');
    // ⚠️ DELIBERATELY A LITERAL, like `database_name` below. The DIRECTORY is
    // `${SLUG}-api`, but the DEPLOYED Worker name did not move with the slug:
    // `wrangler deploy` addresses a Worker by name, so changing it provisions a
    // second Worker and makes it fight `api.nikatru.com`, which is a custom
    // domain bound to one Worker at a time. wrangler.jsonc's `name` block
    // carries the reasoning. Deriving it here would assert a Worker that does
    // not exist in the account.
    expect(cfg.name).toBe('subly-api');
    // ...and the DIRECTORY, which did move, is still bound to the catalogue:
    // this is what a half-done rename trips on.
    expect(new URL('.', import.meta.url).pathname).toContain(`${SLUG}-api`);
    expect(Object.keys(cfg.vars ?? {}).length).toBeGreaterThanOrEqual(4);
    expect((cfg.d1_databases ?? []).length).toBe(2);
  });
});

describe('vars.MONEY_ENVIRONMENT — load-bearing since both money doors 503 without it', () => {
  // [5]M-12: the RevenueCat webhook and /v1/entitlements each answer 503 when
  // this var is absent or unrecognised. A deploy that lost it would not fail a
  // health check — it would fail every entitlement read. Production is 'live'
  // by definition; a sandbox deploy edits this knowingly.
  it("is declared and is exactly 'live'", () => {
    expect(cfg.vars?.MONEY_ENVIRONMENT).toBe('live');
  });
});

describe('vars.ALLOWED_ORIGINS — load-bearing since CORS fails closed', () => {
  const listed = String(cfg.vars?.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  it('is a non-empty exact allowlist', () => {
    expect(typeof cfg.vars?.ALLOWED_ORIGINS).toBe('string');
    expect(
      listed.length,
      'an empty list denies every non-localhost browser origin — the web app goes dark',
    ).toBeGreaterThan(0);
  });

  it('lists the live web origin and the Pages preview origin', () => {
    // The live web origin is the APEX since [ADR 075]: the app is published at
    // https://nikatru.com/<id>, so that — not the old subdomain — is what a
    // browser tab sends. The retired subdomain left this list on 2026-09-09 (#569)
    // when the zone Redirect Rule started 301ing it; the case below keeps it out.
    //
    // 🔴 DERIVED, NOT SPELT. The apex comes from the catalogue row's own `url`
    // and the Pages origin from app.yaml's `hosts.pagesOrigin` — the field that
    // moves when the Pages project is migrated, so this assertion moves with it
    // and a config left behind fails here instead of agreeing with a stale copy.
    for (const origin of [new URL(catalogueUrl()).origin, `https://${hostsField('pagesOrigin')}`]) {
      expect(listed, `missing ${origin}`).toContain(origin);
    }
  });

  it('no longer lists the retired app subdomain', () => {
    // Not a tautology: this list is the ONLY thing standing between a retired
    // host and a standing CORS grant, and re-adding it is a one-word edit.
    expect(listed, 'the subdomain serves only a 301 now [ADR 075]').not.toContain(
      'https://subly.nikatru.com',
    );
  });

  it('carries no wildcard and no scheme-less or trailing-slash entry', () => {
    for (const o of listed) {
      expect(o, 'wildcards are not an allowlist').not.toContain('*');
      expect(o, `${o} must be a full origin`).toMatch(/^https?:\/\/[^/]+$/);
    }
  });

  it('does NOT list localhost — that is handled by the middleware regex', () => {
    // Listing it would imply the config must carry something it does not, and
    // the CI harness's port is unknowable in advance anyway.
    expect(listed.some((o) => o.includes('localhost'))).toBe(false);
  });
});

describe('the clone contract this Worker is the template for', () => {
  const byBinding = new Map((cfg.d1_databases ?? []).map((d) => [d.binding, d]));

  it('binds the PER-APP database with its own migrations dir', () => {
    const app = byBinding.get('APP_DB');
    expect(app).toBeDefined();
    // ⚠️ DELIBERATELY A LITERAL, and the one place in this file that should be.
    // The D1 database NAME did not move with the slug: a database is bound by
    // `database_id`, so the name is display only and renaming it is a
    // create-and-migrate, not a declaration edit. Deriving `${SLUG}_db` here
    // would assert a name that does not exist in the account.
    expect(app!.database_name).toBe('subly_db');
    expect(app!.migrations_dir).toBe('migrations');
  });

  it('binds the SHARED platform database and does NOT claim to migrate it', () => {
    // services/platform is the sole applier. A second migrations_dir pointed at
    // platform_db is a portfolio-wide outage waiting for a `wrangler d1
    // migrations apply`.
    const platform = byBinding.get('PLATFORM_DB');
    expect(platform).toBeDefined();
    expect(platform!.database_name).toBe('platform_db');
    expect(platform!.migrations_dir).toBeUndefined();
  });

  it('every D1 binding carries a real database_id, not the brick placeholder', () => {
    for (const d of cfg.d1_databases ?? []) {
      expect(d.database_id, `${d.binding} has no id`).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(d.database_id, `${d.binding} still holds the all-zeros placeholder`).not.toMatch(
        /^0{8}-/,
      );
    }
  });
});
