# Member benefits (`/benefits`)

A members-only coupon screen for partner restaurants (FA26: SGD and Kung Fu
Tea), with a real-time usage log for staff. Not in the header menu: the
Partners page links to it ("Member Benefits"), and both pages are
`noindex`. Internals (API, config, table, secrets) keep the older "perks" name.

## How members use it

1. Open `kicksuiuc.com/benefits` (link shared in the group chat; save it to the
   home screen).
2. First time on a phone: pick your name and enter the **member code** from
   the group chat. The phone remembers both (localStorage
   `kicks-perks-member`).
3. At the counter: tap "Use now" → a confirm box ("Open the coupon? Each
   open is recorded as a use") → "Use it" logs the use and opens a
   full-screen coupon with the
   restaurant, the offer, the member's name, a **live ticking clock** and a
   pulsing dot. Staff just check the clock is moving (a screenshot can't).
   The screen closes itself after 10 minutes.

If staff change the member code, the next tap fails, the phone forgets the
old code and asks for the new one (the name stays selected).

## How it's built

- **Config** — [src/data/perks.json](../src/data/perks.json) (hand-edited,
  never touched by the pipeline): one entry per restaurant with
  `perk_id`, `name`, `offer_en` / `offer_ko`, `valid_until` (last day,
  Chicago date) and `active`. `active: false` shows the card as
  "Coming soon / 준비 중" and the API refuses it.
- **Members** — everyone in `player_profiles.json` whose `status` isn't
  `inactive`, plus club staff who don't play (managers etc.) listed by hand
  as board members in [src/data/board.json](../src/data/board.json) with a
  `member_id` (`"M001"`, ...) instead of a `player_id` — `M` ids never
  clash with a player's `P001`. Board members who play use their
  `player_id` and are already members as players. Same list on the page, in the API and in the
  staff log. A new player who hasn't played a league week yet isn't in it
  until the next data regeneration.
- **API** — [functions/api/perks.js](../functions/api/perks.js), routed by
  [worker/index.js](../worker/index.js) (`/api/perks/*` is Worker-first in
  `wrangler.jsonc`):
  - `POST /api/perks/verify` `{code, player_id}` — checks the code; logs
    nothing.
  - `POST /api/perks/redeem` `{code, player_id, perk_id}` — logs one use and
    returns the server time. Opening the same restaurant again within 30
    minutes reuses the same row (`REPEAT_WINDOW_MS`), so double taps don't
    inflate the count.
  - `GET /api/perks/log` with `Authorization: Bearer <staff key>` — totals
    per restaurant (uses, distinct members) and the latest 1,000 uses.
  - POSTs require a same-origin `Origin` header. Secrets are compared in
    constant time.
- **Storage** — table `perk_redemptions` in the existing D1 database
  (binding `VISITS_DB`, `kicks-visits`), created by
  [migrations/0002_perk_redemptions.sql](../migrations/0002_perk_redemptions.sql).
  Stored per use: restaurant, `player_id`, time. No IP, device or name.
- **Staff log** — `/benefits/admin`: enter the staff key (kept for that tab
  only), see live totals and every use, refresh every 60s, download CSV for
  the end-of-season partner report.

## Secrets (never commit these)

Set in Cloudflare (Workers → `kicks-website` → Settings → Variables and
Secrets, type **Secret**) or with Wrangler:

```sh
npx wrangler secret put PERKS_CODE        # the code members type
npx wrangler secret put PERKS_ADMIN_KEY   # the staff key for /benefits/admin
```

Use something longer than 4 digits for `PERKS_CODE` (e.g. two words and a
number) — there's no attempt limit. To change it mid-season, run the same
command again; members are asked for the new code on their next tap.

Until both are set, the API answers 503 and the page shows "Benefits aren't
available right now".

## One-time setup (production)

```sh
npx wrangler d1 migrations apply kicks-visits --remote
```

This only adds the new table; `0001_daily_visits` is already applied and is
skipped.

## Turning a restaurant on

When the partner confirms the offer, edit its entry in `perks.json`:
set `offer_en` / `offer_ko` (e.g. "10% off your order" / "주문 금액 10% 할인"),
`valid_until`, and `"active": true`, then commit and push.

## Tests

```sh
node --test tests/perks.test.mjs tests/worker.test.mjs
```
