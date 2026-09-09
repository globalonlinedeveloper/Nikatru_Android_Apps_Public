/** 🔴 THE APEX ORIGIN, DECLARED EXACTLY ONCE IN THIS REPOSITORY.
 *
 *  It used to live in `generate-discovery.mjs` as `ORIGIN`, with the note that a
 *  hostname written twice is a hostname that can be changed once. That note is
 *  still the reason; what changed is the number of readers. Since [ADR 075] the
 *  apex is not only where the marketing surface is published — it is the app's
 *  PUBLIC ADDRESS (`https://nikatru.com/<id>`), so four independent things now
 *  have to agree about the same string:
 *
 *    · `tooling/sites/generate-discovery.mjs` — re-exports it as `ORIGIN`, and
 *      writes it into every canonical tag, the sitemap and `llms.txt`;
 *    · `tooling/app-yaml/render.mjs`          — composes the catalogue `url`
 *      from it, so `catalog/apps.json` cannot spell the apex differently from
 *      the pages that link to it;
 *    · `tooling/ci/assert-app-address-shape.mjs` — the guard that fails if any
 *      app is ever published on a subdomain again;
 *    · `tooling/ci/assert-catalog-reachable.mjs` — via `CANONICAL_HUB_URL`.
 *
 *  A module this small exists so that those four can import ONE declaration
 *  without any of them importing the 1,100-line generator. Import it; never
 *  retype it, and never write `nikatru.com` as a literal in a guard.
 *
 *  ⚠️ The trailing slash is part of the value and always has been —
 *  `CANONICAL_HUB_URL` is `${ORIGIN}apps/`, and every caller that wants a bare
 *  origin uses `APEX_HOST` or `new URL(...).origin` rather than trimming it by
 *  hand. */
export const APEX_ORIGIN = 'https://nikatru.com/';

/** The bare hostname, for the guards that compare `new URL(row.url).hostname`.
 *  DERIVED, so the two can never disagree. */
export const APEX_HOST = new URL(APEX_ORIGIN).hostname;

/** The app's public address, composed in ONE place.
 *
 *  🔴 THIS FUNCTION IS THE OWNER DECISION OF 2026-09-09, EXPRESSED AS CODE.
 *  `<id>.nikatru.com` cost a payment-provider submission PER APP, forever —
 *  Paddle: "you will need to have that subdomain approved separately"; Razorpay:
 *  a support ticket per sub-domain against a ceiling of one main site plus five.
 *  A PATH under the already-approved apex costs nothing on either, so the app's
 *  published address is a path and the subdomain survives only as an internal
 *  origin. [ADR 075] carries the sources.
 *
 *  ⚠️ `id` is interpolated, never a literal. The app has already been renamed
 *  once (Subly → Nikatru Subscription Tracker) and the id may move again; every
 *  address in this repository derives from `apps/<id>/app.yaml` so that a rename
 *  moves both sides of every comparison at once. */
export const publicAppUrl = (id) => `${APEX_ORIGIN}${id}`;

/** The base href a Flutter web build must be compiled with to be served under
 *  `publicAppUrl`. Leading AND trailing slash, because `--base-href` requires
 *  both and a bare `/<id>` silently produces an app whose asset URLs are one
 *  directory too high. */
export const appBaseHref = (id) => `/${id}/`;
