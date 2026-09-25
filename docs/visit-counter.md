# Daily visits (Workers Static Assets + D1)

This is a lightweight public counter, **not GA4 sessions**. Existing GA4 is unchanged.
The Astro build stays static. `wrangler.jsonc` deploys `dist/` plus `worker/index.js`
to the existing `kicks-website` Worker. Only `/api/visits` is Worker-first; other
paths use normal static asset handling. Unmatched paths reaching the Worker fall
back to `env.ASSETS.fetch(request)`. The existing handler in
`functions/api/visits.js` is imported explicitly, not discovered as a Pages Function.
Pages-only `public/_routes.json` has been removed.

## Storage and behavior

D1 binding: `VISITS_DB`. Its only table is `daily_visits(date, visits)`.
The server determines the date in `America/Chicago` (including DST), and uses
one atomic INSERT/ON CONFLICT increment with RETURNING. GET never increments.
Responses are `no-store`. No IP, identity, visitor history, or request logging is
added by this feature. Cloudflare's own platform logging/settings remain separate.

The browser stores only `{date, at}` in localStorage key `kicks-last-visit`, using
server time. A visit is eligible after 30 minutes from the last counted/attempted
visit, or on a new Chicago date. Navigation/refresh does not extend that window.
Web Locks serialize simultaneous tabs on the same origin. Browsers without Web
Locks use read-only mode; if localStorage is blocked, counting fails quietly.
Private profiles, different devices/origins, and cleared storage can count again.

The browser reserves the window before POST so a lost response is not retried
and double-counted. If an increment fails, this can undercount for up to 30 minutes
(or until the next Chicago day). Exactly-once delivery would need additional
per-request server state, deliberately excluded here.

A visible page refreshes the public total every 60 seconds (read-only). Returning
to a hidden tab may start a new visit if eligible. An idle open tab does not create
visits merely because time passed. Old totals expire within 60 seconds or at
Chicago midnight, whichever is earlier. Zero, invalid data, timeout, and API/D1
failure hide the counter. No-JS pages simply omit it.

POST requires an exact same-origin Origin and `X-Kicks-Visit: 1`; cross-site
requests are rejected. Client guards prevent ordinary repeat increments. A caller
who deliberately forges headers or clears storage can still inflate this public
counter. There is no IP rate limit, fingerprint, secret, or user database.

## Existing production configuration

- Worker: `kicks-website`
- Build: `npm run build`; deploy: `npx wrangler deploy`; production branch: `main`
- D1: `kicks-visits`, ID `bc3cc827-6e9c-43b1-a092-f40636eded48`
- Binding: `VISITS_DB`, declared in `wrangler.jsonc`
- The owner has already applied `migrations/0001_daily_visits.sql` to production.
  Do not recreate the database or reapply a production migration as part of build.
- Custom domains `kicksuiuc.com` and `www.kicksuiuc.com` stay Dashboard-managed.
  No `route`/`routes` keys are declared in Wrangler.
- `workers_dev: true` and `preview_urls: true` preserve the existing production
  and preview workers.dev URLs. `keep_vars: true` preserves Dashboard variables.

No SSR adapter, new Pages project, application secret, or Google credential is
needed. The static-assets-only binding restriction is addressed by deploying an
actual Worker entrypoint with the D1 binding. Existing Git integration/settings
remain unchanged. Wrangler is pinned as a development dependency.

All work and verification for this change are local; no deployment or production
D1 writes have been performed. A future authorized deployment will apply the
binding alongside code and assets. Check Domains & Routes and GET `/api/visits`
after that deployment. Do not remove/recreate the existing Worker or DNS records.

Workers version/preview URLs use the deployed version's bindings; unlike Pages,
there is no automatic separate Preview D1 environment here. A deployed preview
with this configuration can write to the production counter. Use local testing,
or explicitly configure a separate test Worker/database before remote preview
counter testing. Local `wrangler dev` and `d1 execute --local` use local D1 only.

## Local verification

- `npm run build`
- `node --test tests/worker.test.mjs tests/visit-counter.test.mjs` (Node 22.18+; uses built-in SQLite)
- `PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs node tests/visit-counter.browser.mjs`
  (Chrome installed; local HTTP server; deterministic simulated API/time)
- `git diff --check`

A plain `astro dev` or `astro preview` does not execute the API. For the complete
local stack, build first, initialize **local** D1, then start Wrangler:

```sh
npm run build
npx wrangler d1 execute kicks-visits --local --file=migrations/0001_daily_visits.sql
npx wrangler dev --local --port 8791
```

With that local server running, run
`PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs node tests/worker.browser.mjs`
to verify real local D1 increments, assets/404 routing, existing pages, and the
English/Korean desktop/mobile counter. This test refuses non-localhost URLs.

Local D1 state is ignored under `.wrangler/`. Never add `--remote` for tests.
Use `npx wrangler deploy --dry-run --outdir=/tmp/kicks-worker-dry-run` to validate
bundling/bindings without deployment. The local unit tests include routing and
binding-configuration checks in `tests/worker.test.mjs`.

English shows `TODAY` above `👀 [count] visitors`; Korean shows
`👀 오늘 방문자 · [count]`. Both use the existing language system.

References:
- https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/d1/worker-api/prepared-statements/
