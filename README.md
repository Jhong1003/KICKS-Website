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

Then restart/refresh the dev server (or rebuild) to see the changes.

This also runs automatically on a schedule and pushes the result straight to
`main` — see "자동 업데이트 (GitHub Actions)" below. Running it locally is
still useful for previewing changes before they'd go live, or for
troubleshooting.

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

## 자동 업데이트 (GitHub Actions)

`.github/workflows/update-data.yml`이 구글 시트 → JSON 파이프라인을
자동으로 돌립니다: 시트 입력만 해두면, 검증 → `update_data.py` 재생성 →
(값이 바뀌었을 때만) `main`에 커밋·푸시까지 자동으로 됩니다. Cloudflare가
그 푸시를 보고 알아서 재배포합니다.

**실행 시간표** (전부 UTC 기준 cron이라 서머타임을 못 따라가서, 연 2회
±1시간 밀리는 건 감수합니다):

| 용도 | Cron (UTC) | 대략 현지시각(CDT) |
|---|---|---|
| 평상시 매일 3회 | `0 13,19,1 * * *` | 오전 8시 / 오후 2시 / 오후 8시 |
| 일요일 경기 집중 (30분마다) | `*/30 2-8 * * 1` | 일요일 밤 9시 ~ 월요일 새벽 3시 |

**수동 실행**: GitHub 저장소 → Actions 탭 → "Update League Data" →
"Run workflow" 버튼. (모바일 GitHub 앱에서도 동일하게 가능합니다.)

**검증 (`scripts/validate_data.py`)**: `update_data.py`를 돌리기 *전에*
먼저 시트를 검사합니다. 오류가 하나라도 있으면 그 자리에서 실패 처리되고
이후 단계(재생성·커밋)는 아예 실행되지 않습니다 — 잘못된 데이터가
사이트에 올라가는 일은 없습니다. 실패하면 GitHub이 저장소 관리자에게
자동으로 이메일을 보냅니다.

| 규칙 | 오류/경고 | 설명 |
|---|---|---|
| 팀 이름이 정해진 3팀인지 | 오류 | `matches`/`player_stats`/`players` 전체에서, 띄어쓰기까지 정확히 일치해야 함 |
| 선수 이름 일치 | 오류 | `player_stats`의 모든 이름이 `players` 탭에 있어야 함 (역방향은 검사 안 함 — 아직 기록 없는 신규 멤버는 정상) |
| 점수는 0 이상 정수 | 오류 | 빈 점수(아직 안 한 경기)는 검사 대상에서 제외 |
| 주차별 경기 수 9개 | 오류 | 3팀 라운드로빈 × 3라운드 |
| 주차별 득점 합 일치 | 오류 | 그 주 경기 기록 득점 합(전체 팀) = 그 주 선수 골 합 + 그 주 자책골(`own_goals`) 합. 팀별이 아니라 주 전체로 검사함 — 한 주에 두 팀을 상대하는 라운드로빈이라 자책골을 특정 상대팀에 귀속시킬 수 없기 때문. 자동 실행 중 아직 다 안 끝난 주차는 실패 대신 로그만 남기고 건너뜀 — 수동 실행/로컬에서는 건너뛰지 않고 그대로 검사 |
| 팀별 득점 차이가 자책골 범위 안인지 | 오류 | (경기 득점 − 그 팀 선수 골 합)이 0 이상이어야 하고, 그 주 **상대 두 팀** 선수들의 자책골 합을 넘으면 안 됨. 선수 골 합이 경기 득점보다 많으면 자책골 여부와 무관하게 무조건 오류(자동/수동 모두). 위 주차 전체 합계 검사로는 서로 다른 팀의 오류가 우연히 상쇄돼 안 잡히는 경우가 있어서 팀별로 한 번 더 좁혀서 검사함 |
| games 값 | 경고 | 0 또는 6이 정상, 그 사이 값은 오류는 아니고 경고만 |
| active인데 기록 누락 | 경고 | 끝난 주차에 active 선수의 player_stats 행이 없으면 경고 (players 탭 상태값은 "Player Status" 섹션 참고) |

로컬에서 직접 확인하고 싶으면:

```sh
python scripts/validate_data.py
```

기본은 "엄격" 모드(수동 실행과 동일)로 검사합니다 — `VALIDATE_STRICT=0`
환경변수로 완화 모드(자동 스케줄 실행과 동일)를 흉내낼 수 있습니다.

**한 번만 해두면 되는 저장소 설정**: 이 워크플로가 커밋·푸시하려면
저장소의 Actions 권한이 "Read and write"로 되어 있어야 합니다 (기본값은
읽기 전용이라 안 바꾸면 푸시가 거부됩니다):

1. GitHub 저장소 페이지 → **Settings** 탭
2. 왼쪽 메뉴에서 **Actions** → **General**
3. 아래로 스크롤해서 **Workflow permissions** 섹션
4. **Read and write permissions** 선택
5. **Save**

`main` 브랜치에 브랜치 보호 규칙이 걸려 있다면, 그 규칙이 `github-actions[bot]`의
푸시도 막을 수 있으니 함께 확인해주세요.

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
  `brace`, `hat_trick`, `perfect_attendance`, `week1_starter`, `rookie`,
  `own_goal_award`), plus a guaranteed `squad_member` fallback so **every
  player has at least one badge**. Badge label/description/icon text lives
  in `BADGES` in `src/lib/players.ts`, keyed by the same badge key —
  update both files together if you add a badge.
- **Own goals** (`player_stats`'s `own_goals` column, blank = 0): counted
  separately from `goals` everywhere — they never add to a player's
  goals, attacking points, or leaderboard rank, only to the fun
  `own_goal_award` badge. They still count toward the *opposing* team's
  match score, which is why the data-validation goal-sum check (see
  "자동 업데이트" below) adds them back in on that side of the equation.

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
