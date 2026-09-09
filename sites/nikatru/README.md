# nikatru.com

Static site for the **Nikatru** brand — studio app portfolio + legal pages (privacy, terms, refund, contact),
plus a Cloudflare Pages Function (`/api/subscribe`) that stores launch-list signups in Cloudflare KV.

Part of the **`Nikatru_Platform_Public`** monorepo — this site lives at **`sites/nikatru/`**.
*(This line named `Project_Cross_Platform_Apps` until 2026-08-21. That name was freed by the
2026-08-19 renames; `gh repo list` is the only thing that settles a repo name, because GitHub
follows rename redirects and the old name answers 200.)*

## Hosting
**Cloudflare Pages** project **`nikatru`** (formerly `project-nek`), connected to the monorepo with root
directory `sites/nikatru` and output dir `/`. Pushes redeploy automatically — no build step, plain static
HTML + one Pages Function. (GitHub Pages is intentionally not used.)

The `/api/subscribe` Function uses the KV binding `SIGNUPS → nikatru-signups`.

> rajasekarselvam.com is a **separate** site in the same monorepo at `sites/rajasekarselvam/`
> (Cloudflare Pages project `rajasekarselvam`).

## 🔴 ONE ADDRESS PER APP — `nikatru.com/<id>` — and what it replaced

**An app's public address is a PATH on the apex.** `https://nikatru.com/<id>` is the application
itself; `<id>.nikatru.com` is an internal origin and a permanent 301 to it. Locked by the owner on
2026-09-09, recorded as **ADR 075**.

| address | what it is | measured 2026-09-09 |
|---|---|---|
| **`nikatru.com/<id>/`** | the running web application, proxied from the app's own Pages project by `functions/_middleware.js` | `200`, serving the app |
| `nikatru.com/<id>` | the same, one hop | `301 → /<id>/` (the build is compiled with `--base-href /<id>/`) |
| **`nikatru.com/apps/<id>`** | the product/marketing page — UNCHANGED, still where the generator writes it and where the sitemap, the hub and every store-facing link point | `200` |
| `<id>.nikatru.com` | the app's own Cloudflare Pages origin; not an address given to humans | `301 → nikatru.com/<id>/…` |

**Why.** Paddle attaches approval to the DOMAIN — *"you will only be allowed to sell through the
domain(s) that have been approved"* — and of a subdomain, *"you will need to have that subdomain
approved separately"*
(paddle.com/help/start/account-verification/what-is-domain-verification). Its checkout overlay
enforces **at init, against the page origin**, so on a subdomain in-app checkout could not open at
all. Razorpay needs a support ticket per sub-domain against a ceiling of one main site plus five.
Neither conditions anything on a path. One apex approval, held once, covers app #51.

### 🔄 SUPERSEDED — the rule this section used to state, kept because the reversal is the useful part

Until 2026-09-09 this file said, under the heading *"TWO ADDRESSES, ONE PRODUCT"*, that
`nikatru.com/subly` and `subly.nikatru.com` were **"both permanent and they are not the same
thing"**, that **"neither redirects to the other"**, and that the path served marketing while the
subdomain served the application. It also recorded, correctly for what was known then, that whether
Paddle's approval extended to the subdomain was **NOT ESTABLISHED**.

Two of those three are now false and the third is answered. The unknown was closed by reading the
vendor's own documentation (above): the approval does **not** extend, and it never would have. So
the "two permanent addresses" rule was resting on an open question, and once the question was
answered the second address stopped being defensible — a subdomain per app is a payment-provider
submission per app, forever, in exchange for isolation the portfolio had already traded away by
running one shared identity project.

What survives unchanged: **`/apps/<id>` is still the marketing page.** Nothing that pointed there
moves. What moved is `/<id>`, from a redirect into the application.

## The one contact record

Used identically on the site, in every store console and in FullShot's privacy policy. Never retyped
per store — a divergence here is a policy-mismatch finding a reviewer can see.

- **Support / privacy / grievance:** `support@nikatru.com`
- **Phone:** `+91 94984 98011`
- **Public location:** `Chennai, Tamil Nadu, India`

🔴 **THE REGISTERED POSTAL ADDRESS DOES NOT GO ON THIS SITE.** Clause 6d of the Awfis membership
agreement forbids it on the website or in marketing, and the NOC that grants use of the address
**auto-revokes on breach** — with the GST and Udyam registrations resting on it. The 2026-08-04
carve-out in `nikatru/business/company-master.md` is narrow: it covers channels that *require* the
address (the Play public developer profile publishes it, unavoidably) and states that the public
site copy stays "Chennai, Tamil Nadu, India".

## Performance targets — and the two "optimisations" that are FORBIDDEN

Agreed 2026-08-21 from the website research brief, step 16 ("Set performance targets and stop there").

| metric | target | measured how |
|---|---|---|
| **LCP** | ≤ **2500 ms** | 75th percentile |
| **INP** | ≤ **200 ms** | 75th percentile |
| **CLS** | ≤ **0.1** | 75th percentile |

Source: **web.dev/articles/vitals** (fetched 2026-08-20). Judged at the **75th percentile** and
**segmented mobile and desktop** — one blended figure lets desktop traffic hide a mobile regression,
which is the only regression that would matter here.

⚠️ **Nothing above is measured for these pages yet.** These are the agreed *targets*; no field or lab
number for nikatru.com has been recorded. Do not read the table as a pass.

### 🔴 The prohibitions — recorded because they are the half that gets "optimised" back

**1. DO NOT split the inline `<style>` blocks into a shared stylesheet.**
Every page here carries its styles in an inline `<style>`, so the site ships **zero render-blocking
external CSS and zero external JS** (measured 2026-08-04, recorded in `_headers`: `/assets/tokens.css`
and `/assets/base.css` both return 404). Extracting a stylesheet does not remove work — it *adds* a
render-blocking round trip that does not exist today. This looks like a best practice precisely
because on most sites the external file already exists; here it would be created in order to be
optimised.

**2. DO NOT add an HTML minifier.**
Cloudflare compresses `text/html` by default, and on the Free plan content "is compressed by default
using Zstandard" (developers.cloudflare.com/speed/optimization/content/compression/, fetched
2026-08-20). A minifier would spend build complexity re-winning bytes the edge already wins, and it
buys that with a build step this site does not otherwise have (Pages deploys these files as-is, no
build).

**Where the effort goes instead: image bytes.** The brief's corollary — PNG and JPEG are *absent*
from Cloudflare's default-compressed content-type list, so image weight is the one thing the edge is
not already handling.
