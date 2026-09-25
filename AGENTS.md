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
  `league`, `league/[league]`, `players`, `players/[id]`, `schedule`, `join`, `partners`,
  `gallery`, `full-matches`).
- [src/components/](src/components/) — Astro components used by the pages
  (e.g. `LeagueView`, `StandingsTable`, `PlayerStatsTable`, `WeeklyResults`,
  `ScheduleTimeline`, `PlayerCard`, `WeeklyStatsChart`, `PhotoGallery`,
  `PartnerGrid`/`PartnerInquiryForm`, `Header`/`Footer`).
- [src/layouts/BaseLayout.astro](src/layouts/BaseLayout.astro) — shared page
  shell.
- [src/data/](src/data/) — generated JSON the pages read at build/render
  time (`league_table.json`, `matches.json`, `week_summaries.json`,
  `player_leaderboard.json`, `player_profiles.json`, `leagues.json`,
  `partners.json`, plus the encrypted `full-matches.enc.json`). **Never
  hand-edit the generated files** — regenerate them instead (see pipeline
  below). Four files in this folder are the hand-edited exception, never
  touched by the pipeline: [schedule.json](src/data/schedule.json) (season
  calendar, see below), [league-config.json](src/data/league-config.json)
  (per-league rules, see "Leagues" below),
  [player-photos.json](src/data/player-photos.json) (optional real player
  photos, see "Player profiles" below), and
  [transfer-news.json](src/data/transfer-news.json) (homepage transfer
  banner, see below).
- [src/lib/schedule.ts](src/lib/schedule.ts) — shared helpers (date
  formatting, past/upcoming/next-up flags, month grouping) used by both
  the Schedule page and the homepage's "Next up" card.
- [src/lib/leagues.ts](src/lib/leagues.ts) — loads `leagues.json`: the
  `League` types, `latestLeague`, `getLeague`, and `getTeamColor` (a team's
  color from its league's teams-tab entry). See "Leagues" below.
- [src/lib/players.ts](src/lib/players.ts) — shared types/helpers for
  player profiles: per-league profile sections (`getSection`), badge
  label/description/icon lookup, transfer resolution, and the name/team
  sort (see "Player profiles" below).
- [src/lib/goals.ts](src/lib/goals.ts) — the homepage's all-time goal
  countdown (see "All-time goal countdown" below).
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
`league` entries a `league` id (e.g. `"FA26-L2"`) and a `week` number
*within that league* (weeks restart at 1 in every league). A `league`-type
entry's `date` is what `update_data.py` uses for that league week — add or
edit one whenever the calendar changes (a new week, a rescheduled event, a
new league). Each one also links to `/league/<league>?week=<week>`. Set `"tbd": true` on an entry that has a tentative date but
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

The League pages (standings, match results/fixtures, player leaderboard)
read from `src/data/league_table.json`, `src/data/matches.json`,
`src/data/week_summaries.json`, and `src/data/player_leaderboard.json`. The
Players pages (`/players` and `/players/[id]`) read from
`src/data/player_profiles.json`, and league metadata (teams, colors, which
league is the latest) from `src/data/leagues.json`. All six are generated by
[scripts/update_data.py](scripts/update_data.py) from published-to-web CSV
tabs of the club's Google Sheet (`matches`, `player_stats`, `players`,
`goal_events`, `teams`) — **don't hand-edit the JSON files.** Every row in
`matches` and `player_stats` carries a `league` column.

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

### Names vs ids

People type **names** into the Sheet (players, teams), and that stays that
way. The pipeline swaps them for **ids** right after loading
(`resolve_ids` in `update_data.py`, runs after `load_sheets()`), and from
there on — every calculation and every generated JSON file — works on ids
only. The site joins names back in at render time.

- **Where the ids come from**: `player_id` is the `players` tab's
  `player_id` column; `team_id` is the `teams` tab's `team_id` column.
  `build_id_maps` is the *only* place a name becomes an id.
- **Team ids are per league** (every league has its own `T1`, `T2`, ...),
  so a team is always `(league, team_id)` — any lookup goes through the
  league.
- **Unresolvable name** (not on the players/teams tab): `resolve_ids`
  collects every one and raises, so the run fails instead of silently
  dropping rows. `validate_data.py` reports the same thing first, with
  sheet row numbers (`check_team_names`, `check_player_names_known`,
  `check_player_ids`). A **blank** team on a match is allowed and becomes
  `null` (a fixture whose teams aren't decided yet, e.g. finals week) —
  the site shows it as "TBD".
- **Same-name players aren't supported yet**: a duplicate name on the
  players tab is a validation error. If two members ever share a name,
  change `build_id_maps` (e.g. have staff type a disambiguated name) —
  nothing downstream looks at names.
- `validate_data.py` itself still works on names (it runs on
  `load_sheets()` output, before `resolve_ids`), so its messages quote
  what people actually typed.
- **Generated fields**: `matches.json` has `home_team_id`/`away_team_id`;
  `league_table.json` and `week_summaries.json` have `team_id`;
  `player_leaderboard.json` has `player_id` + `team_id` (no name);
  `player_profiles.json` sections have `current_team_id`, and
  `team_history[]`/`weekly_stats[]` entries have `team_id`. Names live only
  in `leagues.json` (`teams[].name`) and `player_profiles.json` (`name`).
- **Frontend join**: `getTeamName`/`getTeamColor`/`getTeamIdByName` in
  [src/lib/leagues.ts](src/lib/leagues.ts) take a `team_id` and a league.
  [LeagueView.astro](src/components/LeagueView.astro) and `index.astro`
  join names once and hand plain names to `StandingsTable`,
  `WeeklyResults` and `PlayerStatsTable`; player pages pass `teamName` to
  `PlayerCard`.

**Two different player ids — don't mix them up:**

| | Sheet `player_id` | URL slug (`id`) |
|---|---|---|
| Looks like | `P001`, `P024` | `88c25e9d` (8-char sha1 of the name) |
| Comes from | `players` tab, typed by staff | `_player_slug(name)` in `update_data.py` |
| JSON field | `player_id` (profiles, leaderboard) | `id` (profiles, leaderboard) |
| Used for | the player's identity in the data: every join, groupby and roster in the pipeline, and name lookup on the site (`player_id` → `name`) | the public URL only: `/players/<id>` routes/links, the `player-photos.json` key, and `ResolvedTransfer.playerId` |

They're never derived from each other. The slug is kept as a name hash so
existing URLs and photo keys didn't change when ids were introduced — which
also means the slug changes if a player's name is ever corrected on the
Sheet, while `player_id` doesn't.

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

### Leagues

A season can hold several leagues (FA26 has **FA26-L1** and **FA26-L2**).
Each league has its own teams and team names, restarts at week 1, and is
computed completely separately — **nothing is ever summed across leagues**
(standings, leaderboard, profile stats, badges are all per league). The
one deliberate exception is the homepage's club-wide goal total — see
[All-time goal countdown](#all-time-goal-countdown) for why it's allowed
and why it must stay the only one.

- **Ids and order**: a league id like `FA26-L2` is whatever the Sheet's
  `league` columns and `teams` tab say. The **order of leagues is the order
  they first appear on the `teams` tab** (oldest first), not alphabetical —
  append new leagues at the bottom.
- **`match_id`** looks like `FA26-L1-W01-M01` (league, week, match number);
  `goal_events` rows point at matches by it (`_event_key` in
  `update_data.py` pulls out `(league, week)`).
- **Teams and colors** come from the `teams` tab (`league`, `team_id`,
  `team_name`, `color` as `#rrggbb`). Team names and ids are only unique
  *within* a league, so anything that looks a team up (names, colors,
  `resolveTransfers`) goes through its league — see
  [Names vs ids](#names-vs-ids). A blank color falls back to a neutral gray
  (`getTeamColor` in [src/lib/leagues.ts](src/lib/leagues.ts)).
- **Rules** (weeks per league, finals week, points, matches per week) live
  in [src/data/league-config.json](src/data/league-config.json), not in
  code: `"_default"` applies to every league and a league lists only the
  values it overrides (`"FA26-L2": {}` = same as default). Read by both
  `update_data.py` (`league_rules(league)`) and `validate_data.py`.
- **`leagues.json`** (generated): per league its `id`, `teams` (with
  colors), resolved `rules`, `started` (has at least one completed match)
  and `latest`. **`latest` = the most recent league with at least one
  completed match** — so the site keeps showing the current league until
  the next one's first game is actually scored, even if its teams and
  fixtures are entered early.
- **Routes**: `/league` shows the latest league; `/league/<id>` (e.g.
  `/league/FA26-L1`) is a shareable page for any league on the teams tab,
  with a switcher between them. Both render
  [LeagueView.astro](src/components/LeagueView.astro). A league that
  isn't on the `teams` tab has no page (404).
- **Starting a new league** has a step-by-step checklist — README.md's
  "새 리그 시작하기 (체크리스트)". Keep it in sync when this changes.

### League rules

Implemented in `scripts/update_data.py`, per league; the numbers come from
[src/data/league-config.json](src/data/league-config.json).

- **Points**: `win_points` (default 2) for a win, `final_win_points`
  (default 3) for a win in `final_week` (default 4) or later, a draw is
  `draw_points` (1), a loss is 0 (`_match_points`).
- **League table ranking**: points → participation rate → goal difference →
  goals for (all descending), configured in `ranking_criteria`. All four
  equal means shared competition ranks (1, 1, 3); team ids are never a
  sporting tiebreaker. Participation rate is the share of a team's
  active roster that actually shows up, computed per team as
  `games played by roster / (roster size × games the team played)`
  (`_participation_rates`). The roster is per league: see
  [Player status](#player-status).
- **Player leaderboard ranking order**: attacking points (goals + assists)
  → goals → assists → attendance (more weeks attended wins ties) — all on
  the league's totals, not a per-game rate, since missing a week is a
  missed attendance rather than something a rate should reward. One row
  per (league, player), grouped by player and not by player+team, so a
  mid-league team change doesn't split their totals into two rows — the
  Team column shows their team in that league (most recent week's row).
  Ranks restart at 1 in each league. Players with `status` `inactive` are
  hidden from the leaderboard on the site.
- **Attendance**: reported as weeks attended out of weeks played so far *in
  that league* (`GAMES_PER_WEEK = 6` games counts as one full week
  attended).
- Match week dates are looked up from
  [src/data/schedule.json](src/data/schedule.json) by `(league, week)`
  (`_load_league_week_dates`), not computed from a fixed weekly cadence —
  non-league events (friendlies, sports day, etc.) interrupt what would
  otherwise be an every-7-days rhythm. A league week with matches but no
  schedule entry is an error (`validate_data.py` reports it;
  `update_data.py` raises).

### Player status

The `players` tab's `status` column is **global** (not per league) and has
three values:

- **`active`** — currently in the club. An `active` player who has at
  least one `player_stats` row in a league is on that league's **roster**,
  which is what the participation-rate tiebreaker counts (both the
  roster-size denominator and the "games played by the roster" numerator;
  `build_rosters` in `update_data.py`).
- **`new`** — hasn't recorded any `player_stats` rows yet (no team,
  usually). Not on any roster. Once they've played, flip this to
  `active` — nothing else needs to change, their `player_stats` rows
  already drive their profile/leaderboard entry.
- **`inactive`** — a player who **left the club**. Don't delete their
  `players` row or their past `player_stats` rows; just change `status`.
  They drop off every roster, and are hidden from the site's leaderboard
  and `/players` grid — their `/players/[id]` page still exists.

**Sitting out a league is not `inactive`.** A league's roster is derived
from that league's `player_stats` rows, so a player who skips a whole
league (graduated for a term, busy, taking a break) simply has no rows in
it — no status change and no validation error. Once they have *any* row in
a league, though, every finished week of it is expected: a missing week
for a participant is an error (`check_active_players_missing_weeks`) —
enter a `games` 0 row for an absence.

`joined_week` (players tab) is the week they joined **within their first
league** (the earliest league they have any row in); weeks of that league
before it aren't checked. In later leagues they're checked from week 1.
An active player with rows but no `joined_week` is skipped with a warning.

`player_profiles.json` and `player_leaderboard.json` are built straight
from `player_stats` (see [Player profiles](#player-profiles)); `status`
only decides who is on a roster and who is hidden on the site. One
subtlety if you change `_participation_rates` again: "games the team
played" (the session-size half of the denominator) is computed from
*every* `player_stats` row of the league, not just the roster, so a
departing player doesn't retroactively shrink a past week's session size
— see that function's docstring.

### Player profiles

The `/players` grid and `/players/[id]` detail pages are a celebration of
the roster, not a second leaderboard — **no overall rating, score, or
ranking ever appears on a player card or profile.** League stats are shown
plainly (goals, assists, weeks attended), but a player is never compared
to or ranked against another on these pages. If you add anything here,
keep it positive and keep that rule.

`build_player_profiles` in `scripts/update_data.py` gives each player who
has at least one row in `player_stats` one profile with a `leagues` array —
**one section per league they played in, newest first**. Stats, play-style
tag and badges are all computed per league and never combined. There is no
top-level copy of "the current league's" values: a page picks its league
explicitly (`getSection(player, leagueId)` in
[src/lib/players.ts](src/lib/players.ts)). `/players` shows the latest
league's roster (players with a section in it); `/players/[id]` shows every
section, newest first. Each section has:

- League totals, that league's team, and team history (previous teams in
  that league, if any — most players only ever have one).
- Week-by-week goals/assists (`weekly_stats`).
- `personal_best_week`: the week with the most attacking points
  (goals + assists), or `null` if the player has never had one — there's
  nothing to spotlight in a scoreless week, so it's skipped rather than
  shown as 0-0.
- Exactly one **play-style tag**, and one or more **badges**.

**Play-style tag** — exactly one per player, from `_play_style_tag` in
`scripts/update_data.py` (thresholds are named constants above it):

1. **Black Spider** — primary position GK, always, whatever the numbers.
2. With at least `TAG_MIN_ATTACKING_POINTS` (2) goals + assists, an
   attacking style: **Finisher** (goals lead assists by
   `FINISHER_GOAL_MARGIN`, 2+), **Playmaker** (assists lead goals by
   `PLAYMAKER_ASSIST_MARGIN`, 2+), otherwise **All-Rounder**.
3. Otherwise the role of their primary position (`POSITION_TAGS`):
   **Rock** (DF), **Engine** (MF), **Target Man** (FW).
4. **Team Player** — only if the players tab has no primary position yet.

**Badges** — a player can have any number; keys are what's stored in
`player_profiles.json`, and label/description/icon/**tier** live in
`BADGES` in [src/lib/players.ts](src/lib/players.ts) (add a badge in both
places). Tiers are fixed per badge — never recalculated from how many
people hold one — and pages show badges rarest-first (`sortBadges`).
"Attended" means a week with `games > 0`; a player's rows start the week
they joined, so late joiners aren't penalised.

- Common: `off_the_mark` (scored in the league), `provider` (assisted),
  `iron_man` (attended every week since joining), `squad_member`
  (fallback when nothing else triggered, so **everyone has at least one
  badge** per league).
- Rare: `on_fire` (3+ goals + assists in one week), `libero` (primary DF
  with a goal or assist), `the_wall` (primary DF/GK who attended a week
  their team kept 3+ clean sheets), `champion` (on the rank-1 team of a
  *finished* league — every fixture scored), `brace` (2 goals in one match).
- Legendary: `game_changer` (2+ goals and 2+ assists in one week), `crack`
  (2+ goals + assists in each of two consecutive attended weeks — once
  earned it stays), `fox_in_the_box` (5+ league goals), `maestro` (3+
  assists in one week), `delivery_service` (5+ league assists), `hat_trick`
  (3 goals in one match).
- Special (just for fun): `own_goal_award` (1+ own goal — the club runs an
  own-goal award), `journeyman` (played for more than one team in the
  league).

`brace`/`hat_trick` need per-match goals, which only `goal_events` has
(`_max_match_goals`), so they start in FA26-L2; FA26-L1 was recorded as
weekly totals. Team-based badges (`the_wall`, `champion`) are deliberately
few, since they mostly reflect team strength rather than the player.

(There used to be `week1_starter` and `rookie` badges; they were dropped
because teams are re-drawn every league, which made "first week"/"just
joined" meaningless. The old week-based `brace`/`hat_trick` became
`on_fire`, and the Iron Man tag became the `iron_man` badge.)

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
never touched by `update_data.py`) keyed by that player's `id` (the URL
slug, not the Sheet's `P001`-style `player_id`) — e.g.
`{"6c36530d": "/players/jongho.jpg"}` — with the image placed under
`public/players/`.

**Player id vs URL slug**: `player_profiles.json` and
`player_leaderboard.json` both carry `player_id` (the Sheet's `P001`, the
data identity) and `id` (`_player_slug(name)`, a short sha1 hash of the
name, used only for `/players/<id>` links) — deterministic across regens,
so links from the League leaderboard to a player's profile don't break
when the Sheet is updated. See [Names vs ids](#names-vs-ids) for the full
comparison.

**Team colors**: each card's accent color is the `color` of that team on
the Sheet's `teams` tab (see [Leagues](#leagues)), looked up in the
league the card is showing, with a neutral gray fallback if it's blank.

### Transfer news banner

The homepage can show a dismissible banner above the hero announcing
player moves — controlled entirely by
[src/data/transfer-news.json](src/data/transfer-news.json) (hand-edited,
never touched by the pipeline):

- `"enabled"`: `false` hides the banner without deleting the file.
- `"league"`: the league these transfers happened in (e.g. `"FA26-L1"`).
  Teams are re-drawn every league, so a move only means something inside
  one league: the banner shows only while this is the site's latest league
  and **disappears by itself when the next league starts**. To announce
  moves inside a new league, set this to that league's id.
- `"heading"`: the small label shown before the list (hidden on narrow
  screens to save space, but still read by screen readers).
- `"transfers"`: a list of `{"player": "<exact name>", "to": "<team>",
  "from": "<team>"}` — `from` is optional.

`resolveTransfers` in [src/lib/players.ts](src/lib/players.ts) looks each
`player` up in `player_profiles.json` to get their id (for the profile
link. The team shown as *before* the move is `from` when given;
otherwise it comes from the last entry in that league section's
`team_history`, falling back to its `current_team_id` if that's still empty (a transfer is often announced here
before the Sheet has a new week recorded under the new team). **Set
`from` explicitly whenever the Sheet hasn't caught up yet** —
`current_team_id`/`team_history` can't be trusted as "the pre-move team" in
that window (it may show the old team, or something edited ahead of
time), and this is what actually happened the first time this shipped:
three of four announced transfers ended up reading the wrong team because
the Sheet's week 1/2 rows had been edited inconsistently, and the banner
had no way to tell. `from` is safe to remove once the move shows up in
`team_history` for real after a regen.

Whatever the source, if `from` and `to` end up equal the entry is dropped
rather than rendered as a nonsensical "Team X -> Team X" line — this is
the safety net for exactly that kind of Sheet inconsistency. An entry
whose `player` doesn't match anyone in `player_profiles.json`, or whose
`to`/`from` isn't one of that league's team names, is also silently
skipped rather than breaking the homepage build. The file itself stays
name-based (it's typed by hand); `resolveTransfers` turns the names into
`team_id`s and compares ids.

Dismissing the banner (the ✕) only hides it for that browsing session —
it's stored in `sessionStorage`, not `localStorage`, on purpose, so it
reappears on a later visit rather than being gone for good. On narrow
screens the transfer list scrolls horizontally instead of wrapping to
multiple lines, so the banner stays a single compact row regardless of
how many transfers are listed.

### All-time goal countdown

The homepage hero shows a line right under "Next up", e.g. "KICKS 통산
93골 · 100호 골까지 7골": every completed match's score (`home_score` +
`away_score`, so own goals count, as they do in the match score) summed
across **all leagues**, and how many goals are left until the next
milestone. For `MILESTONE_CELEBRATION_DAYS` (7) after the match that
crossed a milestone, it switches to a celebration message instead ("KICKS
통산 100골 달성! 🎉"). Both constants, plus `GOAL_MILESTONE_STEP` (100),
are in [src/lib/goals.ts](src/lib/goals.ts).

**This is the only place on the site that sums across leagues, on
purpose.** The no-cross-league rule exists because teams are re-drawn and
rosters change every league, so adding up standings, player stats or
badges across leagues would compare things that aren't comparable, and
would rank someone on numbers from a different setup. The goal total
doesn't rank or compare anyone: no team, no player, just one number for
the whole club celebrating how much it has played together. That's the
test for any future exception: a club-wide number that nobody is ranked
or compared on. Anything per team or per player stays per league.

It's computed on the frontend from `matches.json` rather than in
`update_data.py`. It's a plain sum of data that's already generated, and
whether a milestone is still "recent" depends on the visitor's date, so it
has to be re-checked client-side anyway. Same pattern as the "Next up"
card: the build-time render is the fallback, and `index.astro`'s script
re-runs `isCelebratingMilestone` against today's date. The line is hidden
while the total is 0.

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

Each video has a `league` and a `week` within it (weeks restart at 1 per
league); the page sorts by date and shows the league on each card.
Videos saved before leagues existed have no `league` — the script offers
to label them (once per run) when it finds any. It prompts for the current
password to decrypt the existing list, walks
through adding a video and/or changing the password, then re-encrypts and
overwrites `src/data/full-matches.enc.json`. The PBKDF2/AES-GCM parameters
in that script must stay in sync with `src/pages/full-matches.astro`.
Commit and push the updated `.enc.json` file afterward like any other
change.

### Languages (EN / 한)

The site is bilingual. Every translatable string is rendered in **both**
languages and CSS shows only the one matching `<html lang>` — switching never
re-renders anything. Pieces:

- [src/components/T.astro](src/components/T.astro): `<T en="..." ko="..." />`
  (or `slot="en"` / `slot="ko"` fragments for text with links); `as="p"` etc.
  picks the wrapping element.
- [src/lib/i18n.ts](src/lib/i18n.ts): `formatShortDate` ("Sun, Sep 27" /
  "9월 27일 (일)"), `weekLabel`, and `bilingualHtml` for text written by
  client-side scripts.
- The inline script at the top of
  [BaseLayout.astro](src/layouts/BaseLayout.astro) picks the language before
  first paint: a saved choice (localStorage `kicks-lang`) wins, otherwise
  Korean browsers get Korean and everyone else English. It also defines
  `window.kicksSetLang` (used by the header's EN | 한 button) and fills
  translated attributes from `data-i18n-attrs`. No JavaScript = English.

**Stays English in both languages, on purpose**: the nav menu, hero slogan
and brand labels, h1/h2 headings and ALL-CAPS section labels, badge and
play-style tag names (except Brace → 멀티골), and hand-edited JSON content
(partner names, video titles). The transfer banner has `heading` (Korean)
and `heading_en` in transfer-news.json. Schedule titles
are translated through an optional `title_ko` on each schedule.json entry
(league weeks build their own title). Sentences, buttons, table labels, empty-state
messages and badge descriptions are translated. When adding new visible
text, add both versions.

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


### Championship simulator

`ChampionshipSimulator.astro` runs only in the browser, using
`src/lib/championship-simulator.ts` and `src/lib/standings.ts`. Python's
`rank_team_rows` and the browser read the same `ranking_criteria` through
league-config → generated leagues.json. Shared cases in
`tests/standings-cases.json` verify both ranking implementations.
Player Stats keeps its existing consecutive visible ranks.

Every week (including week 4) has three matches per pair of teams, nine
matches overall and six per team. Four weeks total 36 matches / 24 per
team. `matches_per_pair_per_week` records this in league-config. There is
no knockout or separate final: cumulative week 1–4 standings decide the
championship. The final-week win points still apply.

Future goals are independent Poisson draws with the SAME lambda for both
teams: the current league's completed-match total goals / (2 × completed
matches). No other league, team strength or home advantage is used. User
scenario scores never change lambda. Participation stays at its current,
pipeline-rounded value. All four criteria tied means each co-leader gets
1 / number-of-co-leaders championship credit. UI percentages are mean
credit, not probability of sole victory or inclusion in a shared title.

The documentation records sample-size and model limits and the lambda
formula; the website shows only read-only results. The core calculation
API retains exact future score overrides for tests and other callers.
No observations blocks random simulation; a fully specified scenario can still be evaluated.
Lambda zero generates only 0–0. Finished leagues and fixed scenarios are
evaluated without random trials. Other scenarios run 10,000 trials in
small batches to keep the browser responsive.

Missing/TBD fixtures are filled as virtual pair slots within each league
and week, without modifying Sheet data, JSON, or assigning real match ids
to guesses. Duplicate/conflicting fixtures block simulation. Completed
match totals are accumulated exactly once; standings supplies participation.

Verification (offline):
- `python3 -m unittest discover -s tests -p 'test_*.py'`
- `node --test tests/championship-simulator.test.mjs` (Node 22.18+ for native
  TypeScript stripping, or Node 22.12+ with `--experimental-strip-types`)
- `npm run build`


### League sections and Title Race UI

League pages keep their existing paths and offer OVERVIEW / PLAYER STATS
sub-navigation. Overview contains League Table → Match Results → Title Race;
Player Stats contains the unchanged full leaderboard with consecutive ranks.
`#player-stats` selects that panel; `#overview` or no hash selects Overview.
The existing `#player-stats-title` anchor also selects Player Stats.
`?week=N#results` opens Overview and preserves the existing week selection.
Tabs retain query parameters and support reload, history navigation and
keyboard controls. Without JavaScript, both sections remain available.

Title Race automatically runs the existing 10,000-trial simulation once per
page load. Team rows stay in generated official standings order, including
tied teams' presentation order; only percentages and bars change. Teams
without standings rows are appended in league team order. TITLE RACE is the
primary heading, with no subtitle or interactive controls.

The site shows a read-only result, a simulations / remaining matches line,
and "Equal team strength · Poisson model". Scenario inputs, Run/Reset and
How it works are removed from the UI; unused UI event handlers and styles
are removed too. Tab changes do not rerun the simulation. Detailed model
assumptions remain documented above. The core simulator still supports
fixed scores for callers and tests, but the website does not expose them.
Exact/no-data states are labeled without claiming 10,000 random trials.

Browser regression: after `npm run build`, run
`node tests/league-ui.browser.mjs` with `playwright-core` available and Chrome
installed. `PLAYWRIGHT_MODULE` can point to an external installation's
`index.mjs`, avoiding changes to project dependencies. The check uses a
local temporary HTTP server, closed automatically after completion.
