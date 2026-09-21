# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## Updating League Data

The League page (standings, match results/fixtures, and the player leaderboard)
reads from `src/data/league_table.json`, `src/data/matches.json`, and
`src/data/player_leaderboard.json`. The Players pages read from
`src/data/player_profiles.json`. All of these are generated from the club's
Google Sheet by `scripts/update_data.py` — don't edit them by hand.

**One-time setup:**

```sh
pip install -r requirements.txt
```

**Every time the Google Sheet is updated** (new match results, weekly player
stats, roster changes), regenerate the JSON files:

```sh
python scripts/update_data.py
```

Then restart/refresh the dev server (or rebuild) to see the changes. This is a
manual step for now — there's no automatic sync set up yet.

**Scoring/ranking rules** (implemented in `scripts/update_data.py`, so this is
where to change them for a future season):

- League points: a win is worth 2 points in weeks 1–3 and 3 points in week 4
  (the finals week), a draw is 1 point, a loss is 0. See `WIN_POINTS_EARLY`,
  `WIN_POINTS_FINAL`, `FINAL_WEEK`.
- League table ties are broken by participation rate (see the
  `_participation_rates` docstring).
- Player leaderboard ranking is attacking points → goals → assists →
  attendance (more weeks attended wins), all on season totals — not a
  per-game rate, since missing a week is a missed attendance, not something
  to reward. "Attendance" itself is reported as weeks attended out of weeks
  played so far (`GAMES_PER_WEEK = 6` games per week attended). One row per
  player even if they changed teams mid-season — the Team column shows
  their current (most recent) team, and their stats are combined across
  both teams, not split into two rows.
- Match week dates are looked up from `src/data/schedule.json`, not
  computed from a fixed weekly cadence — see "Updating the Season
  Schedule" below.

## Player Status (`players` tab)

The `status` column takes three values:

- `active` — on the current roster, counts toward the League table's
  participation rate.
- `new` — hasn't played yet (no `player_stats` rows). Flip to `active`
  once they have — nothing else to do, their stats already flow through
  on their own.
- `inactive` — **use this for someone who left mid-season.** Don't
  delete their row or their past week's stats. Any status other than
  `active` already excludes them from the participation-rate roster;
  their `/players/[id]` profile page and League leaderboard row are
  unaffected either way, since both are built from `player_stats`
  directly and don't look at this column at all.

## Player Profiles

The `/players` and `/players/[id]` pages are meant to celebrate every
player — **there's no overall rating, score, or ranking on a player card,
ever.** (Player *stats* are shown, but never a comparison or rank.)

Each player who has recorded stats gets, from `build_player_profiles` in
`scripts/update_data.py`:

- Season totals, current team + team history (if they changed teams),
  and week-by-week goals/assists.
- A **personal best week** (most attacking points), skipped (`null`) if
  they've never had one.
- Exactly one **play-style tag** — `Finisher` / `Playmaker` / `All-Rounder`
  / `Iron Man` / `Team Player` — picked by threshold checks in that order
  (first match wins). The thresholds (e.g. `FINISHER_GOAL_MARGIN`,
  `ALL_ROUNDER_MAX_DIFF`) are named constants right above
  `_play_style_tag` in `scripts/update_data.py` — tune them there.
- One or more **achievement badges** (`first_goal`, `first_assist`,
  `brace`, `hat_trick`, `perfect_attendance`, `week1_starter`, `rookie`),
  plus a guaranteed `squad_member` fallback so **every player has at least
  one badge**. Badge label/description/icon text lives in `BADGES` in
  `src/lib/players.ts`, keyed by the same badge key — update both files
  together if you add a badge.

**Avatars** are initials by default (last two characters of the name, or
the full name if it's 2 characters — no photo is collected by the
pipeline). To use a real photo for someone, add it to
`src/data/player-photos.json` (hand-edited, keyed by that player's `id`,
never overwritten by the script) with the image under `public/players/`.

**Team colors** for the card accents come from `src/data/team-colors.json`
(hand-edited, keyed by team name, with a `_default` fallback) — currently
placeholders, swap in the real bib colors when they're decided.

## Transfer News Banner

`src/data/transfer-news.json` (hand-edited) controls the dismissible
banner above the homepage hero:

```json
{
  "enabled": true,
  "heading": "이적 소식",
  "transfers": [{ "player": "김하주", "from": "이지선다", "to": "오늘밤 샴페인" }]
}
```

Set `"enabled": false` to turn it off without deleting anything. Each
`player` must match a name in `player_profiles.json` exactly. `from` is
optional — without it, the previous team is looked up automatically from
`team_history` (falling back to `current_team`), which only works once
the Sheet has a week recorded under the new team. **Until then, set
`from` explicitly** — this bit us once already: the Sheet's week 1/2 rows
got edited inconsistently for a real transfer, and without an explicit
`from`, 3 of 4 players showed the wrong "previous team" (in one case
literally "Team X → Team X"). If `from` and `to` ever end up equal, that
entry is dropped instead of shown as a no-op line. Closing the banner
only hides it for that browser session (`sessionStorage`) — it comes back
on a later visit.

## Updating the Season Schedule

`src/data/schedule.json` is the season calendar's source of truth — it's
edited by hand (unlike the other files in `src/data/`, which are
generated). It's read by two things:

- The `/schedule` page and the homepage's "Next up" card.
- `scripts/update_data.py`, which looks up each league week's date there
  instead of computing it from `SEASON_START_DATE + 7 days`. That fixed
  cadence broke once non-league events (friendlies, sports day, etc.)
  started interrupting the weekly rhythm.

To add or move an event, add/edit an entry in the JSON array:

```json
{ "date": "2026-10-11", "title": "League 5", "type": "league", "week": 5 }
```

- `date` is `"YYYY-MM-DD"`, or `null` if there's no date yet at all.
- `type` is `"league"`, `"event"`, `"friendly"`, or `"ceremony"`.
- `week` is required on `league`-type entries — it's what
  `update_data.py` matches against the Google Sheet's `week` column.
- Add `"tbd": true` on an entry that has a tentative date but still needs
  confirming (shows a "TBD" badge on the Schedule page). Use `date: null`
  instead for something with no date at all yet.

After editing `schedule.json`, re-run `python scripts/update_data.py` if
you changed or added a league week's date, then rebuild/restart the dev
server.

## Managing Full Match Videos

The `/full-matches` page is locked behind a club password. The Google Drive
links (and the password itself) are never stored in plain text anywhere in
this repo — `src/data/full-matches.enc.json` holds only an AES-GCM encrypted
blob, decrypted in the visitor's browser after they type the correct
password (Web Crypto API, key derived from the password via PBKDF2).

**To add a new week's video, or to change the club password:**

```sh
node scripts/manage_full_matches.mjs
```

It will ask for the current club password (to decrypt the existing list),
then walk you through adding a new video and/or changing the password, and
re-saves `src/data/full-matches.enc.json`. Nothing is read from a committed
file — the password only ever lives in your terminal session. Commit and
push the updated `.enc.json` file afterward like any other change.

If a newly added video doesn't show up on `/full-matches` after a refresh:

- Make sure you're refreshing, not relying on a page you unlocked a while
  ago — the page remembers your password for the browser tab's session and
  re-decrypts on every load, so a normal refresh (not just leaving the tab
  open) is enough.
- If it still doesn't show up, restart the dev server
  (`astro dev stop` then `astro dev --background`). This project lives in
  iCloud Drive, which can occasionally delay the dev server noticing a file
  changed outside the editor (e.g. from this script).

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
