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
`src/data/player_leaderboard.json`. These are generated from the club's Google
Sheet by `scripts/update_data.py` — don't edit them by hand.

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
  played so far (`GAMES_PER_WEEK = 6` games per week attended).
- Match week dates are looked up from `src/data/schedule.json`, not
  computed from a fixed weekly cadence — see "Updating the Season
  Schedule" below.

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
