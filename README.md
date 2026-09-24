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

The League pages (standings, match results/fixtures, and the player leaderboard)
read from `src/data/league_table.json`, `src/data/matches.json`,
`src/data/week_summaries.json`, and `src/data/player_leaderboard.json`. The
Players pages read from `src/data/player_profiles.json`, and league metadata
(teams, colors, which league is the latest) comes from `src/data/leagues.json`.
All of these are generated from the club's Google Sheet by
`scripts/update_data.py` — don't edit them by hand.

A season can have several **leagues** (FA26 has `FA26-L1` and `FA26-L2`), each
with its own teams, restarting at week 1. Everything is computed **per league —
nothing is ever summed across leagues.** `/league` shows the latest league (the
most recent one with at least one scored match) and `/league/FA26-L1`,
`/league/FA26-L2`, … are shareable pages for each league.

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

**Scoring/ranking rules** (implemented in `scripts/update_data.py`, per league;
the numbers live in `src/data/league-config.json`, not in code):

- League points: `win_points` (2) for a win, `final_win_points` (3) for a win in
  the `final_week` (week 4) or later, `draw_points` (1) for a draw, 0 for a loss.
  A league can override any of these — see `league-config.json`.
- League table ties are broken by participation rate (see the
  `_participation_rates` docstring). A league's roster is the `active` players
  who have at least one `player_stats` row in that league.
- Player leaderboard ranking is attacking points → goals → assists →
  attendance (more weeks attended wins), all on that league's totals — not a
  per-game rate, since missing a week is a missed attendance, not something
  to reward. "Attendance" itself is reported as weeks attended out of weeks
  played so far in the league (`GAMES_PER_WEEK = 6` games per week attended).
  One row per player per league even if they changed teams mid-league — the
  Team column shows their current (most recent) team in it, and their stats
  are combined across both teams, not split into two rows.
- Match week dates are looked up from `src/data/schedule.json` by (league,
  week), not computed from a fixed weekly cadence — see "Updating the Season
  Schedule" below.

## 새 리그 시작하기 (체크리스트)

같은 학기 안에서 새 리그(예: `FA26-L2`)를 여는 절차입니다. **위에서 아래 순서대로**
하면 됩니다. 리그 id는 `학기연도-L번호` 형식(`FA26-L2`, `SP27-L1` …)이고, 아래
모든 곳에서 **글자 하나까지 똑같이** 써야 합니다.

**A. 리그 시작 전 (경기 입력 전에 끝내기)**

1. **`teams` 탭에 새 리그 팀 추가** — 열: `league`, `team_id`, `team_name`, `color`.
   팀 이름은 그 리그 안에서 겹치면 안 되고, `color`는 `#rrggbb` 형식입니다
   (비우면 회색으로 나오고 경고가 뜹니다). 새 리그는 **표의 맨 아래**에 추가하세요 —
   리그 순서는 이 탭에 등장하는 순서(오래된 것부터)로 정해집니다.
2. **`src/data/league-config.json`에 리그 추가** — `"FA26-L2": {}`처럼 한 줄.
   규칙(주차 수, 결승 주차, 승점, 주당 경기 수)이 `_default`와 같으면 `{}`로 두고,
   다르면 다른 값만 적습니다. 예: `"FA26-L2": { "weeks": 5, "final_week": 5 }`.
3. **`src/data/schedule.json`에 리그 주차 추가** — 주차마다 한 줄:
   `{ "date": "2026-10-11", "title": "FA26-L2 · Week 1", "type": "league", "league": "FA26-L2", "week": 1 }`.
   `week`는 **그 리그 안의** 번호(1부터)입니다. 날짜가 없으면 파이프라인이 실패합니다.
4. **1~3번을 커밋·푸시** — 이게 배포된 뒤에 Sheet에 경기를 입력하세요. (순서가
   바뀌면 검증이 "teams 탭에 없는 리그" / "schedule.json에 날짜 없음"으로 막아서
   사이트는 안전하지만, 자동 실행 실패 메일이 옵니다.) 이때부터 `/league/FA26-L2`가
   "upcoming"으로 생기고 리그 전환 버튼에도 나타납니다. 기본 리그는 아직 L1입니다.
5. **`matches` 탭에 새 리그 대진 입력(선택, 미리 해도 됨)** — `league`,
   `match_id`(`FA26-L2-W01-M01` 형식), `week`(1부터), `round`, 팀 이름은 새 리그
   `teams` 탭의 이름. 점수는 비워 둡니다. 미리 넣어도 첫 경기 점수가 들어가기
   전까지는 L1이 기본으로 보입니다.
6. **`players` 탭 점검** — 새로 들어온 사람 추가(`status`는 `new`, 첫 기록이 생기면
   `active`). **동아리를 떠난 사람만 `inactive`.** 이번 리그를 쉬는 사람은 그냥 두면
   됩니다 (아래 D 참고). `joined_week`는 그 선수의 *첫 리그* 안에서의 주차이고,
   그 이후 리그에서는 신경 쓰지 않아도 됩니다.

**B. 이적 배너**

7. **`src/data/transfer-news.json`의 `league` 정리** — 새 리그가 시작되면 배너는
   (`league`가 `FA26-L1`인 채로 두면) 저절로 사라집니다. 새 리그 안에서의 이적을
   알리고 싶을 때만 `"league": "FA26-L2"`로 바꾸고 `transfers`를 새로 채웁니다.

**C. 첫 경기 날 (예: 2026-10-11)**

8. **`player_stats` 탭에 그 리그 기록 입력** — 모든 행에 `league`(`FA26-L2`)와
   그 리그 기준 `week`(1)를 넣습니다. 참가한 선수는 결석하더라도 `games` 0으로
   한 줄을 넣어야 합니다 (참가자 기록 누락 검사).
9. **`matches` 탭에 첫 경기 점수 입력** — 첫 점수가 들어가는 순간 사이트의 기본
   리그(`/league`, 홈 순위표, `/players`)가 자동으로 L2로 바뀝니다. 이전 리그는
   `/league/FA26-L1`에서 계속 볼 수 있습니다.

**D. 이번 리그를 쉬는 선수**

10. 그 리그에 `player_stats` 행을 **아예 넣지 않으면** 불참으로 처리됩니다 —
    `inactive`로 바꿀 필요도, 검증 오류도 없습니다. 단, 한 번이라도 행이 생기면
    끝난 모든 주차에 행이 있어야 합니다.

**E. Full Matches 영상**

11. **`node scripts/manage_full_matches.mjs`** — 처음 실행하면 `league`가 없는 기존
    영상에 붙일 리그를 물어봅니다(`FA26-L1` 입력). 이후 영상 추가 때마다 리그와
    (그 리그 안의) 주차를 입력합니다. 생성된 `src/data/full-matches.enc.json`도
    커밋·푸시하세요.

**F. 확인**

12. 사이트에서 확인: `/`(홈 순위표가 새 리그인지), `/league`, `/league/FA26-L1`,
    `/league/FA26-L2`, `/players`(새 리그 참가자만 나오는지), 선수 상세 페이지의
    리그별 섹션. 안 바뀐 것 같으면 GitHub Actions 탭에서 "Update League Data" 실행 결과와
    실패 메일부터 확인하세요.

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
| 리그 구조 | 오류/경고 | `matches`/`player_stats`의 모든 행에 `league`가 있고 `teams` 탭에 있는 리그여야 함. `teams` 탭에는 빈 값·중복된 팀 이름/id가 없어야 하고 `color`는 `#rrggbb` 형식이어야 함(빈 color는 경고). `matches`의 모든 (리그, 주차)에 `schedule.json` 날짜가 있어야 함. 이 검사에서 오류가 나면 다른 검사는 돌리지 않고 이것만 먼저 보고함 |
| 팀 이름이 teams 탭과 일치 | 오류 | `matches`/`player_stats`는 **그 행의 리그**의 `teams` 탭 팀 이름과, `players`는 어느 리그든 `teams` 탭에 있는 이름과 띄어쓰기까지 정확히 일치해야 함 |
| 선수 이름 일치 | 오류 | `player_stats`의 모든 이름이 `players` 탭에 있어야 함 (역방향은 검사 안 함 — 아직 기록 없는 신규 멤버는 정상) |
| 점수는 0 이상 정수 | 오류 | 빈 점수(아직 안 한 경기)는 검사 대상에서 제외 |
| 주차별 경기 수 | 오류 | 리그마다 `league-config.json`의 `matches_per_week`(기본 9 = 3팀 라운드로빈 × 3라운드)개여야 하고, 주차가 그 리그의 `weeks`(기본 4)를 넘으면 안 됨 |
| 주차별 득점 합 일치 | 오류 | (리그·주차별로) 그 주 경기 기록 득점 합(전체 팀) = 그 주 선수 골 합 + 그 주 자책골(`own_goals`) 합. 팀별이 아니라 주 전체로 검사함 — 한 주에 두 팀을 상대하는 라운드로빈이라 자책골을 특정 상대팀에 귀속시킬 수 없기 때문. 자동 실행 중 아직 다 안 끝난 주차는 실패 대신 로그만 남기고 건너뜀 — 수동 실행/로컬에서는 건너뛰지 않고 그대로 검사 |
| 팀별 득점 차이가 자책골 범위 안인지 | 오류 | (경기 득점 − 그 팀 선수 골 합)이 0 이상이어야 하고, 그 주 **상대 두 팀** 선수들의 자책골 합을 넘으면 안 됨. 선수 골 합이 경기 득점보다 많으면 자책골 여부와 무관하게 무조건 오류(자동/수동 모두). 위 주차 전체 합계 검사로는 서로 다른 팀의 오류가 우연히 상쇄돼 안 잡히는 경우가 있어서 팀별로 한 번 더 좁혀서 검사함 |
| games 값 | 오류/경고 | 0~6 범위 밖이면 오류, 0 또는 6이 아닌 값은 경고만 |
| 참가자 기록 누락 | 오류 | 어떤 리그에 `player_stats` 행이 하나라도 있는 `active` 선수는 그 리그의 끝난 모든 주차에 행이 있어야 함 (첫 리그는 `joined_week`부터). 그 리그에 행이 아예 없으면 불참으로 보고 검사하지 않음 (`joined_week`가 비어 있으면 경고 후 건너뜀. 상태값은 "Player Status" 섹션 참고) |
| goal_events | 오류/경고 | 각 이벤트가 `matches`에 있는 `match_id`를 가리키고, 득점자·어시스트가 그 경기 팀 소속이며, 경기별 골 수가 공식 스코어와 같아야 함. 이벤트가 있는 리그·주차의 `player_stats` 골 값은 무시되므로 값이 있으면 경고 |

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

The `status` column is global (not per league) and takes three values:

- `active` — currently in the club. An `active` player with at least one
  `player_stats` row in a league is on that league's roster, which is what the
  League table's participation rate counts.
- `new` — hasn't played yet (no `player_stats` rows). Flip to `active` once
  they have — nothing else to do, their stats already flow through on their
  own.
- `inactive` — **use this only for someone who left the club.** Don't delete
  their row or their past stats. They drop off every roster and are hidden from
  the leaderboard and the `/players` grid (their `/players/[id]` page still
  exists).

**Sitting out a league is not `inactive`.** If someone skips a whole league,
just don't enter any `player_stats` rows for them in it — they're treated as
not taking part, with no validation error. (Once they have any row in a league,
every finished week of it needs a row, `games` 0 for an absence.)

`joined_week` is the week someone joined *within their first league*; it only
affects that first league's missing-week check.

## Player Profiles

The `/players` and `/players/[id]` pages are meant to celebrate every
player — **there's no overall rating, score, or ranking on a player card,
ever.** (Player *stats* are shown, but never a comparison or rank.)

Each player who has recorded stats gets, from `build_player_profiles` in
`scripts/update_data.py`, **one section per league they played in** (newest
first on their profile page; the `/players` grid shows the latest league's
roster). Stats, tag and badges are per league and never combined. Each section
has:

- League totals, that league's team + team history (if they changed teams),
  and week-by-week goals/assists.
- A **personal best week** (most attacking points), skipped (`null`) if
  they've never had one.
- Exactly one **play-style tag** — `Finisher` / `Playmaker` / `All-Rounder`
  / `Iron Man` / `Team Player` — picked by threshold checks in that order
  (first match wins). The thresholds (e.g. `FINISHER_GOAL_MARGIN`,
  `ALL_ROUNDER_MAX_DIFF`) are named constants right above
  `_play_style_tag` in `scripts/update_data.py` — tune them there.
- One or more **achievement badges** (`first_goal`, `first_assist`,
  `brace`, `hat_trick`, `perfect_attendance`, `own_goal_award`), plus a guaranteed `squad_member` fallback so **every
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

**Team colors** for the card accents come from the `color` column of the
Sheet's `teams` tab (one row per team per league; blank falls back to gray).

## Transfer News Banner

`src/data/transfer-news.json` (hand-edited) controls the dismissible
banner above the homepage hero:

```json
{
  "enabled": true,
  "league": "FA26-L1",
  "heading": "이적 소식",
  "transfers": [{ "player": "김하주", "from": "이지선다", "to": "오늘밤 샴페인" }]
}
```

Set `"enabled": false` to turn it off without deleting anything. `league` is
the league the moves happened in — teams are re-drawn every league, so the
banner only shows while that league is the site's latest one and goes away by
itself when the next league starts (set it to the new league id to announce
moves inside it). Each
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
- `scripts/update_data.py`, which looks up each league week's date there by
  (league, week) instead of computing it from `SEASON_START_DATE + 7 days`. That fixed
  cadence broke once non-league events (friendlies, sports day, etc.)
  started interrupting the weekly rhythm.

To add or move an event, add/edit an entry in the JSON array:

```json
{ "date": "2026-10-11", "title": "FA26-L2 · Week 1", "type": "league", "league": "FA26-L2", "week": 1 }
```

- `date` is `"YYYY-MM-DD"`, or `null` if there's no date yet at all.
- `type` is `"league"`, `"event"`, `"friendly"`, or `"ceremony"`.
- `league` and `week` are required on `league`-type entries — they're what
  `update_data.py` matches against the Google Sheet's `league` and `week`
  columns. `week` counts from 1 *within that league*.
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

Each video has a league (e.g. `FA26-L2`) and a week within it (weeks restart at
1 per league). The page sorts by date and shows the league on each card. Videos
saved before leagues existed have no league — the script asks which league to
label them with the first time it finds any.

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
