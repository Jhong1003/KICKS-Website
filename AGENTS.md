## Project Context

KICKS is a UIUC Korean futsal club. This repo is the club's public site plus
the offline pipeline that turns the club's Google Sheet into the data the
site reads.

### Tech stack

- **Astro** (`^7.3.3`, static site, no UI framework added — plain `.astro`
  components), Node `>=22.12.0`.
- Plain CSS in [src/styles/global.css](src/styles/global.css) using CSS
  custom properties for the color palette — no Tailwind or CSS-in-JS.
- Python (`pandas`, see [requirements.txt](requirements.txt)) for the
  Google Sheets → JSON data pipeline.
- Node (built-in `webcrypto`, no extra deps) for the Full Matches password
  manager script.

### Folder structure

- [src/pages/](src/pages/) — one route per file (`index`, `about`,
  `league`, `players`, `players/[id]`, `schedule`, `join`, `partners`,
  `gallery`, `full-matches`).
- [src/components/](src/components/) — Astro components used by the pages
  (e.g. `StandingsTable`, `PlayerStatsTable`, `WeeklyResults`,
  `ScheduleTimeline`, `PlayerCard`, `WeeklyStatsChart`, `PhotoGallery`,
  `PartnerGrid`/`PartnerInquiryForm`, `Header`/`Footer`).
- [src/layouts/BaseLayout.astro](src/layouts/BaseLayout.astro) — shared page
  shell.
- [src/data/](src/data/) — generated JSON the pages read at build/render
  time (`league_table.json`, `matches.json`, `week_summaries.json`,
  `player_leaderboard.json`, `player_profiles.json`, `partners.json`, plus
  the encrypted `full-matches.enc.json`). **Never hand-edit the generated
  files** — regenerate them instead (see pipeline below). Four files in
  this folder are the hand-edited exception, never touched by the
  pipeline: [schedule.json](src/data/schedule.json) (season calendar, see
  below), [team-colors.json](src/data/team-colors.json) (player card
  accent colors per team), [player-photos.json](src/data/player-photos.json)
  (optional real player photos, see "Player profiles" below), and
  [transfer-news.json](src/data/transfer-news.json) (homepage transfer
  banner, see below).
- [src/lib/schedule.ts](src/lib/schedule.ts) — shared helpers (date
  formatting, past/upcoming/next-up flags, month grouping) used by both
  the Schedule page and the homepage's "Next up" card.
- [src/lib/players.ts](src/lib/players.ts) — shared types/helpers for
  player profiles: badge label/description/icon lookup, team color
  lookup, transfer resolution, and the name/team sort (see "Player
  profiles" below).
- [scripts/update_data.py](scripts/update_data.py) — Google Sheets → JSON
  pipeline.
- [scripts/validate_data.py](scripts/validate_data.py) — sanity-checks the
  Sheet before `update_data.py` runs; see "Automated updates" below.
- [scripts/manage_full_matches.mjs](scripts/manage_full_matches.mjs) —
  encrypt/decrypt tool for the Full Matches video list.
- [.github/workflows/update-data.yml](.github/workflows/update-data.yml) —
  runs the two scripts above on a schedule (or on demand) and pushes the
  regenerated JSON if it changed.
- [public/](public/) — static assets served as-is (favicon, logos, partner
  logos).

### Season schedule

[src/data/schedule.json](src/data/schedule.json) is the single source of
truth for the season calendar — the club's events, and the date each
league week falls on. It's edited by hand (not generated), and read by
two things:

- The [Schedule page](src/pages/schedule.astro), which renders it as a
  timeline grouped by month, plus the homepage's "Next up" card.
- [scripts/update_data.py](scripts/update_data.py), which looks up each
  league week's date here instead of computing it from a fixed weekly
  cadence (see League rules below).

Each entry has a `date` (`"YYYY-MM-DD"`, or `null` for fully TBD), a
`title`, a `type` (`league` / `event` / `friendly` / `ceremony`), and for
`league` entries a `week` number. A `league`-type entry's `date` is what
`update_data.py` uses for that week — add or edit one whenever the
season's calendar changes (a new week, a rescheduled event, a new
season). Set `"tbd": true` on an entry that has a tentative date but
still needs confirming — it renders with a "TBD" badge instead of `null`,
which is reserved for events with no date at all (e.g. a friendly not
yet scheduled).

Past/upcoming styling and the "Next up" pick are **not** just baked in at
build time — this is a static site rebuilt manually, so "today" at build
time would otherwise go stale until the next deploy. `ScheduleTimeline.astro`
and `index.astro`'s "Next up" card each embed the raw schedule JSON in a
`data-schedule-events` attribute and re-run `buildScheduleView`/
`getNextUpEvent` (from `src/lib/schedule.ts`) client-side on load against
the visitor's actual date, then patch classes/text/visibility to match.
The server-rendered version (as of build time) is still there as the
no-JS fallback and first paint.

### Google Sheets → Python → JSON pipeline

The League page (standings, match results/fixtures, player leaderboard)
reads from `src/data/league_table.json`, `src/data/matches.json`,
`src/data/week_summaries.json`, and `src/data/player_leaderboard.json`. The
Players pages (`/players` and `/players/[id]`) read from
`src/data/player_profiles.json`. All five are generated by
[scripts/update_data.py](scripts/update_data.py) from three
published-to-web CSV tabs of the club's Google Sheet (`matches`,
`player_stats`, `players`) — **don't hand-edit the JSON files.**

One-time setup:

```sh
pip install -r requirements.txt
```

Every time the Google Sheet changes (new match results, weekly player
stats, roster changes), regenerate the JSON:

```sh
python scripts/update_data.py
```

Then restart/refresh the dev server (or rebuild) to see the changes. This
also happens automatically — see "Automated updates" next — but running it
locally is still useful to preview a change or debug something.

### Automated updates

[.github/workflows/update-data.yml](.github/workflows/update-data.yml) runs
the whole pipeline unattended: validate → regenerate → commit-and-push only
if the JSON actually changed. Cloudflare deploys on that push, so a Sheet
edit alone is enough to update the live site.

- **Triggers**: `schedule` (3x/day baseline, plus every 30 min from Sunday
  9pm to Monday 3am Central — see the cron comments in the workflow file
  for the UTC math) and `workflow_dispatch` (manual run from the Actions
  tab or GitHub mobile app). Cron is UTC-only and doesn't observe DST, so
  the local times drift ±1 hour twice a year — accepted rather than
  worked around.
- **Validation gate**: [scripts/validate_data.py](scripts/validate_data.py)
  runs *before* `update_data.py`. Any error fails that step, which stops
  the job before anything is regenerated or committed — bad Sheet data
  never reaches the site. Full rule list and rationale in README.md's
  "자동 업데이트 (GitHub Actions)" section (keep both in sync if a rule
  changes).
- **Strictness depends on the trigger**: a `schedule` run treats an
  incomplete week (some of a team's matches for that week still unscored)
  as expected mid-entry, and skips just that week's goal-sum cross-check
  with a logged note instead of failing. `workflow_dispatch` (and running
  the script locally) checks every week as-is, incomplete or not — the
  `_is_strict()` helper reads `GITHUB_EVENT_NAME`, overridable with
  `VALIDATE_STRICT=1`/`0`.
- **One-time repo setting required**: Settings → Actions → General →
  Workflow permissions must be "Read and write permissions", or the
  commit step's push is rejected. Also check `main` isn't branch-protected
  in a way that blocks `github-actions[bot]`.
- Needs no secrets — the Sheet is read via the same public "publish to
  web" CSV links `update_data.py` already uses.

### League rules

Implemented in `scripts/update_data.py`; this is where to change them for a
future season.

- **Points**: a win is worth 2 points in weeks 1–3 and 3 points in week 4
  (finals week); a draw is 1 point; a loss is 0
  (`WIN_POINTS_EARLY`, `WIN_POINTS_FINAL`, `FINAL_WEEK`).
- **League table tiebreaker**: participation rate — the share of a team's
  active roster that actually shows up, computed per team as
  `games played by roster / (roster size × games the team played)`
  (`_participation_rates`).
- **Player leaderboard ranking order**: attacking points (goals + assists)
  → goals → assists → attendance (more weeks attended wins ties) — all on
  season totals, not a per-game rate, since missing a week is a missed
  attendance rather than something a rate should reward. One row per
  player for the whole season (grouped by player, not by player+team), so
  a mid-season team change doesn't split their totals into two rows — the
  Team column shows their current team (most recent week's row), the same
  way `build_player_profiles` picks `current_team`.
- **Attendance**: reported as weeks attended out of weeks played so far
  (`GAMES_PER_WEEK = 6` games counts as one full week attended).
- Match week dates are looked up from
  [src/data/schedule.json](src/data/schedule.json) (`_load_league_week_dates`),
  not computed from a fixed weekly cadence — non-league events (friendlies,
  sports day, etc.) interrupt what would otherwise be an every-7-days
  rhythm. Add/edit `{"type": "league", "week": N, "date": "..."}` entries
  there at the start of a new season or whenever the calendar changes.

### Player status

The `players` tab's `status` column has three values:

- **`active`** — on the current active roster. Counts toward
  [League rules](#league-rules)' participation-rate roster (both the
  roster-size denominator and the "games played by the roster"
  numerator) via `active_roster` in `main()`.
- **`new`** — hasn't recorded any `player_stats` rows yet (no team,
  usually). Excluded from the active roster the same way `inactive` is;
  the only difference is what it communicates to a human reading the
  sheet. Once they've played and have a `team`, flip this to `active` —
  nothing else needs to change, their `player_stats` rows already exist
  and drive their profile/leaderboard entry regardless of this column.
- **`inactive`** — a player who has left partway through the season.
  **Don't delete their `players` row or their past `player_stats`
  rows.** Just change `status` to `inactive`; any value other than
  `active` already excludes someone from the participation-rate roster
  (the code only checks `status == "active"`), so `inactive` isn't
  special-cased, it's just the clear, human-readable choice.

What staying off the active roster does *not* affect: `player_profiles.json`
and `player_leaderboard.json` are both built straight from `player_stats`
(see [Player profiles](#player-profiles) below), with no roster-status
filter at all — an inactive player keeps their profile page, leaderboard
row, and every stat/badge they earned while they were playing. Only the
League table's participation-rate tiebreaker (and, by extension, the
active roster used for the OTHER participation-rate factor, "games the
team played") reads this column.

One subtlety worth knowing if you're changing `_participation_rates`
again: "games the team played" (the session-size half of the
denominator) is computed from *every* `player_stats` row, not just the
active roster, specifically so that a departing player doesn't
retroactively shrink a past week's session size just because they're no
longer active today — see that function's docstring.

### Player profiles

The `/players` grid and `/players/[id]` detail pages are a celebration of
the roster, not a second leaderboard — **no overall rating, score, or
ranking ever appears on a player card or profile.** Season stats are shown
plainly (goals, assists, weeks attended), but a player is never compared
to or ranked against another on these pages. If you add anything here,
keep it positive and keep that rule.

`build_player_profiles` in `scripts/update_data.py` computes, per player
who has at least one row in `player_stats`:

- Season totals, current team, and team history (previous teams this
  season, if any — most players only ever have one).
- Week-by-week goals/assists (`weekly_stats`).
- `personal_best_week`: the week with the most attacking points
  (goals + assists), or `null` if the player has never had one — there's
  nothing to spotlight in a scoreless week, so it's skipped rather than
  shown as 0-0.
- Exactly one **play-style tag**, and one or more **achievement badges**.

**Play-style tag** — exactly one per player, checked in this order (first
match wins), thresholds all named constants right above
`_play_style_tag` in `scripts/update_data.py`:

1. **Finisher** — goals lead assists by `FINISHER_GOAL_MARGIN` (2) or more.
2. **Playmaker** — at least 1 assist, and assists ≥ goals.
3. **All-Rounder** — has both goals and assists, within
   `ALL_ROUNDER_MAX_DIFF` (1) of each other.
4. **Iron Man** — attended every week so far, once at least
   `IRON_MAN_MIN_WEEKS_PLAYED` (2) weeks have been played (so it doesn't
   trivially apply to everyone in week 1).
5. **Team Player** — the default for everyone else.

**Achievement badges** — a player can have any number of these; the keys
below are what's stored in `player_profiles.json`, and their
label/description/icon (shown on the detail page and as icons on the
card) live in `BADGES` in [src/lib/players.ts](src/lib/players.ts) — add a
badge in both places if you add a new one:

- `first_goal` — scored at least once this season.
- `first_assist` — assisted at least once this season.
- `brace` — 2+ goals in a single week (`BRACE_GOALS`).
- `hat_trick` — 3+ goals in a single week (`HAT_TRICK_GOALS`, also
  satisfies `brace`).
- `perfect_attendance` — attended every week played so far.
- `week1_starter` — their first recorded week was week 1.
- `rookie` — their first recorded week is the season's latest week (and
  the season is past week 1) — i.e. they just joined.
- `own_goal_award` — 1+ own goal this season (`OWN_GOAL_AWARD_MIN`). Not a
  real "achievement" like the others — the club runs an own-goal award,
  so this celebrates it rather than hiding it. Deliberately lighthearted
  label/description/icon.
- `squad_member` — guaranteed fallback: awarded only if none of the above
  triggered, so **every player has at least one badge** on their card.

**Own goals**: `player_stats`'s `own_goals` column (blank/missing = 0,
normalized once in `load_sheets()` so every caller can assume it exists).
Tracked entirely separately from `goals` — never added into a player's
`goals`, `attacking_points`, or leaderboard rank, since it's the
*opposing* team's match score that an own goal actually contributes to,
not the player's own attacking output. `check_team_goal_sums` in
[scripts/validate_data.py](scripts/validate_data.py) accounts for that on
the match-score side of its comparison — see that function's docstring
for why it checks a whole week at once rather than one team at a time
(a round-robin week has each team facing two different opponents, so an
own goal's weekly total can't be attributed to a specific one).
`check_team_goal_diff_within_own_goal_budget` adds a tighter per-team
check on top: (match goals − that team's player goals) must be between 0
and that week's own goals from the *other* two teams — catches a
same-week error on one team that the whole-week total alone could miss
if it happens to cancel out against an opposite error elsewhere.

**Avatar**: no player photos are collected by the pipeline, so cards show
initials by default (last two characters of the name, or the full name if
it's only two characters — `_avatar_initials`). To show a real photo for a
specific player instead, add it to
[src/data/player-photos.json](src/data/player-photos.json) (hand-edited,
never touched by `update_data.py`) keyed by that player's `id` — e.g.
`{"6c36530d": "/players/jongho.jpg"}` — with the image placed under
`public/players/`.

**Player id**: `player_profiles.json` and `player_leaderboard.json` both
use `_player_id(name)` (a short sha1 hash of the name) as a stable,
URL-safe id for `/players/<id>` links — deterministic across regens, so
links from the League leaderboard to a player's profile don't break when
the Sheet is updated.

**Team colors**: each card's accent color comes from
[src/data/team-colors.json](src/data/team-colors.json) (hand-edited),
keyed by team name, with a `_default` fallback for any team not yet
listed there. Currently placeholder colors — swap in the real bib colors
whenever they're decided.

### Transfer news banner

The homepage can show a dismissible banner above the hero announcing
player moves — controlled entirely by
[src/data/transfer-news.json](src/data/transfer-news.json) (hand-edited,
never touched by the pipeline):

- `"enabled"`: `false` hides the banner without deleting the file.
- `"heading"`: the small label shown before the list (hidden on narrow
  screens to save space, but still read by screen readers).
- `"transfers"`: a list of `{"player": "<exact name>", "to": "<team>",
  "from": "<team>"}` — `from` is optional.

`resolveTransfers` in [src/lib/players.ts](src/lib/players.ts) looks each
`player` up in `player_profiles.json` to get their id (for the profile
link). The team shown as *before* the move is `from` when given;
otherwise it comes from the last entry in `team_history`, falling back to
`current_team` if that's still empty (a transfer is often announced here
before the Sheet has a new week recorded under the new team). **Set
`from` explicitly whenever the Sheet hasn't caught up yet** —
`current_team`/`team_history` can't be trusted as "the pre-move team" in
that window (it may show the old team, or something edited ahead of
time), and this is what actually happened the first time this shipped:
three of four announced transfers ended up reading the wrong team because
the Sheet's week 1/2 rows had been edited inconsistently, and the banner
had no way to tell. `from` is safe to remove once the move shows up in
`team_history` for real after a regen.

Whatever the source, if `from` and `to` end up equal the entry is dropped
rather than rendered as a nonsensical "Team X -> Team X" line — this is
the safety net for exactly that kind of Sheet inconsistency. An entry
whose `player` doesn't match anyone in `player_profiles.json` is also
silently skipped rather than breaking the homepage build.

Dismissing the banner (the ✕) only hides it for that browsing session —
it's stored in `sessionStorage`, not `localStorage`, on purpose, so it
reappears on a later visit rather than being gone for good. On narrow
screens the transfer list scrolls horizontally instead of wrapping to
multiple lines, so the banner stays a single compact row regardless of
how many transfers are listed.

### Full Matches encryption

The `/full-matches` page is locked behind a club password. **The Google
Drive links and the password itself must never be stored in plain text
anywhere in this repo.** `src/data/full-matches.enc.json` holds only an
AES-GCM encrypted blob (PBKDF2-derived key, 250,000 iterations), decrypted
client-side in the visitor's browser via the Web Crypto API after they
enter the correct password
([src/pages/full-matches.astro](src/pages/full-matches.astro)).

To add a new week's video, or change the club password, run locally
(never commit plaintext credentials or links):

```sh
node scripts/manage_full_matches.mjs
```

It prompts for the current password to decrypt the existing list, walks
through adding a video and/or changing the password, then re-encrypts and
overwrites `src/data/full-matches.enc.json`. The PBKDF2/AES-GCM parameters
in that script must stay in sync with `src/pages/full-matches.astro`.
Commit and push the updated `.enc.json` file afterward like any other
change.

### Design

**Keep the current design and styling by default.** Don't introduce a new
CSS framework, restyle components, or change the color palette
(`src/styles/global.css`) unless explicitly asked to.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
