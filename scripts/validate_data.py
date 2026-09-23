"""Validate the club's Google Sheet before scripts/update_data.py turns it
into the site's JSON. Every rule here is documented in README.md's
"자동 업데이트 (GitHub Actions)" section — keep both in sync if you change
a rule.

Run manually:

    python scripts/validate_data.py

Exit code 0 means no errors (warnings, if any, are still printed but don't
fail the run). Exit code 1 means at least one error was found — in the
GitHub Actions workflow this stops the run before update_data.py touches
anything, so nothing bad ever gets committed.

Strictness: a week's matches are often entered before that week is fully
played, so a mismatch caused purely by an incomplete week isn't a real
error. When this runs from a GitHub Actions `schedule` trigger, that kind
of mismatch is logged and skipped instead of failing the run. Any other
trigger (workflow_dispatch, or running this locally) checks every week
as-is, including incomplete ones — override either way with
VALIDATE_STRICT=1 or VALIDATE_STRICT=0.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from update_data import GAMES_PER_WEEK, load_sheets  # noqa: E402 (needs sys.path set first)

# ---------------------------------------------------------------------------
# Config — the rules themselves live in the check_* functions below; these
# are just the constants they check against.
# ---------------------------------------------------------------------------

VALID_TEAMS = {"이지선다", "문전박대", "오늘밤 샴페인"}
MATCHES_PER_WEEK = 9  # 3 teams round-robin, 3 rounds/week -> 9 matches

CheckResult = tuple[list[str], list[str]]  # (errors, warnings)


def _is_strict() -> bool:
    override = os.environ.get("VALIDATE_STRICT")
    if override is not None:
        return override not in ("0", "false", "False", "")
    # GitHub sets GITHUB_EVENT_NAME automatically; anything other than a
    # scheduled run (workflow_dispatch, or no value at all when run locally)
    # is treated as strict.
    return os.environ.get("GITHUB_EVENT_NAME") != "schedule"


def _sheet_row(index: int) -> int:
    """Turn a pandas row index into an approximate sheet row number (the
    header is row 1, so data starts at row 2). Approximate because a
    published CSV export doesn't carry the sheet's real row numbers if
    rows were ever reordered — good enough to find the row quickly."""
    return index + 2


# ---------------------------------------------------------------------------
# Individual rules
# ---------------------------------------------------------------------------


def check_team_names(matches: pd.DataFrame, player_stats: pd.DataFrame, players: pd.DataFrame) -> CheckResult:
    """Rule: every team name must be exactly one of the 3 canonical names
    (spacing included) — catches typos that would silently create a 4th
    team bucket somewhere in the pipeline."""
    errors = []
    for label, df, cols in [
        ("matches", matches, ["home_team", "away_team"]),
        ("player_stats", player_stats, ["team"]),
        ("players", players, ["team"]),
    ]:
        for col in cols:
            for idx, value in df[col].items():
                if pd.isna(value):
                    continue  # e.g. a "new" status player with no team yet
                if value not in VALID_TEAMS:
                    errors.append(
                        f"{label} {_sheet_row(idx)}행: {col} 값 '{value}' — 허용된 팀명이 아닙니다 "
                        f"(허용: {', '.join(sorted(VALID_TEAMS))})"
                    )
    return errors, []


def check_games_values(player_stats: pd.DataFrame) -> CheckResult:
    """Rule: games must be within 0..GAMES_PER_WEEK. Exactly 0 or
    GAMES_PER_WEEK is the normal case (absent all week / present all
    week); anything else in between is unusual but not necessarily wrong
    (partial attendance), so it's a warning, not an error."""
    errors, warnings = [], []
    for idx, row in player_stats.iterrows():
        games = row["games"]
        if pd.isna(games):
            continue
        where = f"player_stats {_sheet_row(idx)}행 ({row['week']}주차, {row['player']})"
        if games < 0 or games > GAMES_PER_WEEK:
            errors.append(f"{where}: games 값이 {games} — 0~{GAMES_PER_WEEK} 범위를 벗어났습니다")
        elif games not in (0, GAMES_PER_WEEK):
            warnings.append(
                f"{where}: games 값이 {games} — 보통 0 또는 {GAMES_PER_WEEK}인데 다른 값입니다 "
                "(오류는 아니니 확인만 해주세요)"
            )
    return errors, warnings


def check_player_names_known(player_stats: pd.DataFrame, players: pd.DataFrame) -> CheckResult:
    """Rule: every name in player_stats must exist in the players tab.
    (The reverse isn't checked — a "new" status player with no games yet
    is normal.)"""
    errors = []
    known = set(players["player"])
    for idx, row in player_stats.iterrows():
        if row["player"] not in known:
            errors.append(f"player_stats {_sheet_row(idx)}행: '{row['player']}'은(는) players 탭에 없는 이름입니다")
    return errors, []


def check_scores_valid(matches: pd.DataFrame) -> CheckResult:
    """Rule: a filled-in score must be a non-negative integer. A blank
    score means the match hasn't been played yet and is out of scope for
    this check entirely (not an error)."""
    errors = []
    for idx, row in matches.iterrows():
        for col in ("home_score", "away_score"):
            value = row[col]
            if pd.isna(value):
                continue
            if value < 0 or value != int(value):
                errors.append(
                    f"matches {_sheet_row(idx)}행 ({row['week']}주차): {col} 값이 {value} — "
                    "0 이상의 정수여야 합니다"
                )
    return errors, []


def check_matches_per_week(matches: pd.DataFrame) -> CheckResult:
    """Rule: every week must have exactly MATCHES_PER_WEEK rows, regardless
    of whether scores are filled in yet — this is a row-count/structure
    check, not a "did they play" check."""
    errors = []
    for week, count in matches.groupby("week").size().items():
        if count != MATCHES_PER_WEEK:
            errors.append(f"matches: {week}주차 행이 {count}개 — {MATCHES_PER_WEEK}개여야 합니다")
    return errors, []


def check_team_goal_sums(matches: pd.DataFrame, player_stats: pd.DataFrame, strict: bool) -> CheckResult:
    """Rule: each week's total match goals (summed across all teams) must
    equal that week's total player goals plus that week's total own goals.

    This checks the whole week rather than one team at a time on purpose:
    a week is a 3-team round robin (3 rounds x 3 pairings = 9 matches),
    so any given team actually plays *both* other teams multiple times
    that week. An own goal recorded in player_stats is a weekly total per
    player, not tied to a specific match/round, so there's no way to tell
    from this data alone which of a team's two opponents it should be
    credited to - only the league-wide weekly total can be checked
    exactly. (own_goals column: see AGENTS.md's "Player profiles" section
    on the Own Goal Award badge.)

    A week whose matches aren't all scored yet is "incomplete" - the two
    sheets are expected to disagree until it's finished. In non-strict
    (scheduled) runs that's just a skipped, logged note; strict runs
    (workflow_dispatch or local) check it anyway and report a mismatch as
    an error regardless, since the point of a manual/strict run is to
    surface exactly that kind of thing for a human to look at.
    """
    errors, warnings = [], []

    played = matches.dropna(subset=["home_score", "away_score"])
    home = played[["week", "home_score"]].rename(columns={"home_score": "goals"})
    away = played[["week", "away_score"]].rename(columns={"away_score": "goals"})
    week_match_goals = pd.concat([home, away]).groupby("week")["goals"].sum()

    stats = player_stats.fillna({"goals": 0, "own_goals": 0})
    week_player_goals = stats.groupby("week")["goals"].sum()
    week_own_goals = stats.groupby("week")["own_goals"].sum()

    weeks = sorted(set(matches["week"].unique()) | set(player_stats["week"].unique()))
    for week in weeks:
        week_matches = matches[matches["week"] == week]
        is_complete = not week_matches[["home_score", "away_score"]].isna().any().any()
        if not is_complete and not strict:
            warnings.append(f"{week}주차: 아직 경기 결과가 다 채워지지 않아 득점 합계 검증을 건너뜁니다")
            continue

        m_goals = int(week_match_goals.get(week, 0))
        p_goals = int(week_player_goals.get(week, 0))
        og = int(week_own_goals.get(week, 0))
        if m_goals != p_goals + og:
            incomplete_note = " (이 주차는 아직 경기 결과가 다 채워지지 않았습니다 — 그래서일 수도 있습니다)"
            errors.append(
                f"{week}주차: 경기 기록 득점 합({m_goals}) ≠ 선수 골 합({p_goals}) + 자책골 합({og}) = "
                f"{p_goals + og}{incomplete_note if not is_complete else ''} — 어느 팀·선수가 원인인지는 이 "
                "검증만으로 특정하기 어려우니 (한 주에 두 팀을 상대하기 때문), player_stats의 goals/own_goals "
                "값을 확인해주세요."
            )
    return errors, warnings


def check_team_goal_diff_within_own_goal_budget(
    matches: pd.DataFrame, player_stats: pd.DataFrame, strict: bool
) -> CheckResult:
    """Rule: for each (week, team), (match goals for that team) minus
    (that team's own players' goal total) must be:

      - >= 0 — a team's players can never be credited with more goals
        than the match result actually shows, own goals or not. Checked
        unconditionally (every trigger, even an incomplete week), because
        this direction can never be explained away: more matches getting
        scored later only *raises* a team's match-goal total, so an
        already-negative gap only gets worse, never resolves itself.
      - <= that week's own goals from players on the *other* two teams —
        an own goal is the only thing that can inflate a team's match
        score beyond what its own players are credited with, and only an
        opponent's player can score an own goal that benefits this team.
        A gap bigger than that budget isn't explainable by own goals at
        all. This half follows the usual incomplete-week leniency (see
        check_team_goal_sums) since it depends on the week being done.

    This is a tighter, per-team companion to check_team_goal_sums's
    whole-week total — that one can miss a same-week error on one team
    that's canceled out by an opposite error on another (e.g. a goal
    logged under the wrong week for one team, and a missing own_goal
    entry for another, happening to sum to the right league-wide total).
    This check catches that kind of thing per team instead.
    """
    errors: list[str] = []

    played = matches.dropna(subset=["home_score", "away_score"])
    home = played.rename(columns={"home_team": "team", "home_score": "goals"})[["week", "team", "goals"]]
    away = played.rename(columns={"away_team": "team", "away_score": "goals"})[["week", "team", "goals"]]
    match_goals = pd.concat([home, away]).groupby(["week", "team"])["goals"].sum()

    stats = player_stats.fillna({"goals": 0, "own_goals": 0})
    player_goals = stats.groupby(["week", "team"])["goals"].sum()
    own_goals = stats.groupby(["week", "team"])["own_goals"].sum()
    week_own_goals_total = stats.groupby("week")["own_goals"].sum()

    weeks = sorted(set(matches["week"].unique()) | set(player_stats["week"].unique()))
    for week in weeks:
        week_matches = matches[matches["week"] == week]
        week_total_og = int(week_own_goals_total.get(week, 0))

        for team in VALID_TEAMS:
            team_matches = week_matches[(week_matches["home_team"] == team) | (week_matches["away_team"] == team)]
            if team_matches.empty:
                continue

            m_goals = int(match_goals.get((week, team), 0))
            p_goals = int(player_goals.get((week, team), 0))
            diff = m_goals - p_goals

            if diff < 0:
                errors.append(
                    f"{week}주차 {team}: 선수 골 합({p_goals})이 경기 득점({m_goals})보다 많습니다 — "
                    "선수 개인 골 합은 팀의 경기 득점보다 많을 수 없습니다 (자책골과 무관하게 무조건 오류)"
                )
                continue

            is_complete = not team_matches[["home_score", "away_score"]].isna().any().any()
            if not is_complete and not strict:
                continue  # incomplete-week note already logged by check_team_goal_sums

            own_goals_for_team = int(own_goals.get((week, team), 0))
            opponents_own_goals = week_total_og - own_goals_for_team
            if diff > opponents_own_goals:
                errors.append(
                    f"{week}주차 {team}: 경기 득점({m_goals}) - 선수 골 합({p_goals}) = {diff} — 이 주 상대 팀 "
                    f"선수들의 자책골 합({opponents_own_goals})으로 설명되는 범위를 넘습니다. player_stats의 "
                    "goals/own_goals 값을 확인해주세요."
                )
    return errors, []


def check_active_players_missing_weeks(
    matches: pd.DataFrame, player_stats: pd.DataFrame, players: pd.DataFrame
) -> CheckResult:
    """Rule: an active player must have a player_stats row for every fully
    played week since they joined.

    A missing row isn't caught by any of the goal-sum checks above: a
    player who didn't score contributes 0 either way, so their whole row
    can vanish and every total still balances. It still matters — the
    league table's participation-rate tiebreaker counts that player in
    the roster while counting none of their games, understating their
    team (see the issues tab, I002).

    joined_week (players tab) is what makes this an error rather than a
    warning. Without it, every mid-season joiner looked "missing" for
    every week before they arrived, and a real omission sat buried in
    that noise. Weeks before a player joined are simply out of scope.

    A player with no joined_week at all is skipped with a warning rather
    than assumed to have been here since week 1 — guessing would
    reintroduce exactly the false alarms this is meant to remove.
    """
    errors, warnings = [], []
    finished_weeks = [
        week
        for week, group in matches.groupby("week")
        if not group[["home_score", "away_score"]].isna().any().any()
    ]
    have_row = set(zip(player_stats["player"], player_stats["week"]))
    active_players = players[players["status"] == "active"]

    for _, player_row in active_players.iterrows():
        name = player_row["player"]
        joined = player_row.get("joined_week")
        if pd.isna(joined):
            warnings.append(
                f"players 탭: '{name}'의 joined_week가 비어 있어 주차별 기록 누락 검사를 건너뜁니다"
            )
            continue
        for week in finished_weeks:
            if week >= int(joined) and (name, week) not in have_row:
                errors.append(
                    f"player_stats: {week}주차가 끝났는데 '{name}'의 기록이 없습니다 "
                    f"({joined}주차 합류, active 상태) — 결석했다면 games 0으로 한 줄 추가해주세요"
                )
    return errors, warnings

def check_goal_events(
    matches: pd.DataFrame, player_stats: pd.DataFrame, goal_events: pd.DataFrame
) -> CheckResult:
    """Rules for the goal_events tab, which records one row per goal.

    From the week this tab starts being used it's the source of truth for
    goals and assists (see update_data.load_sheets), so these checks are
    the only thing standing between a mistyped row and the site: unlike
    the weekly totals typed into player_stats, an event can name a player
    who wasn't even in that match, and nothing downstream would notice.

    Each event is tied to a specific match, which makes a much tighter
    check possible than the weekly ones above: a match has exactly two
    teams and one official score, so goals can be attributed exactly
    rather than only summed league-wide. An own goal is credited to the
    scorer's opponent in that match.

    Which team a player belongs to is read from player_stats for that
    week, not from the players tab, since players change teams mid-season
    (see AGENTS.md's "Player status" section).
    """
    errors, warnings = [], []

    events = goal_events.dropna(subset=["match_id", "scorer"])
    if events.empty:
        return errors, warnings

    # match_id -> the two teams and the official score
    match_info = {}
    for _, row in matches.iterrows():
        if pd.isna(row.get("match_id")):
            continue
        match_info[row["match_id"]] = row

    # (week, player) -> team that week, and games played
    week_team = {}
    week_games = {}
    for _, row in player_stats.iterrows():
        week_team[(row["week"], row["player"])] = row["team"]
        week_games[(row["week"], row["player"])] = row["games"]

    scored = {}  # (match_id, team) -> goals counted from events
    event_weeks = set()

    for idx, row in events.iterrows():
        where = f"goal_events {_sheet_row(idx)}행"
        match_id = row["match_id"]
        scorer = row["scorer"]
        assist = row["assist"] if not pd.isna(row.get("assist")) else None
        is_own_goal = str(row.get("own_goal", "")).strip().upper() == "Y"

        match = match_info.get(match_id)
        if match is None:
            errors.append(f"{where}: match_id '{match_id}'가 matches 탭에 없습니다")
            continue

        week = int(match["week"])
        event_weeks.add(week)
        teams = (match["home_team"], match["away_team"])

        scorer_team = week_team.get((week, scorer))
        if scorer_team is None:
            errors.append(f"{where}: '{scorer}'의 {week}주차 player_stats 기록이 없습니다")
            continue
        if scorer_team not in teams:
            errors.append(
                f"{where}: '{scorer}'는 {week}주차에 {scorer_team} 소속인데 이 경기는 "
                f"{teams[0]} vs {teams[1]} 입니다"
            )
            continue
        if week_games.get((week, scorer), 0) == 0:
            errors.append(f"{where}: '{scorer}'는 {week}주차 결석(games 0)인데 골 기록이 있습니다")

        # An own goal counts for the opponent.
        credited = teams[1] if scorer_team == teams[0] else teams[0]
        credited_team = credited if is_own_goal else scorer_team
        scored[(match_id, credited_team)] = scored.get((match_id, credited_team), 0) + 1

        if assist is not None:
            if is_own_goal:
                errors.append(f"{where}: 자책골에는 어시스트를 기록하지 않습니다")
            elif assist == scorer:
                errors.append(f"{where}: 득점자와 어시스트가 같은 선수입니다 ('{scorer}')")
            else:
                assist_team = week_team.get((week, assist))
                if assist_team is None:
                    errors.append(f"{where}: '{assist}'의 {week}주차 player_stats 기록이 없습니다")
                elif assist_team != scorer_team:
                    errors.append(
                        f"{where}: 어시스트 '{assist}'({assist_team})가 득점자 "
                        f"'{scorer}'({scorer_team})와 다른 팀입니다"
                    )

    # Per-match totals must match the official score.
    for match_id, match in match_info.items():
        if pd.isna(match["home_score"]) or pd.isna(match["away_score"]):
            continue
        home_counted = scored.get((match_id, match["home_team"]), 0)
        away_counted = scored.get((match_id, match["away_team"]), 0)
        if home_counted == 0 and away_counted == 0:
            continue  # no events for this match yet (or a pre-goal_events week)
        for team, official in ((match["home_team"], match["home_score"]),
                               (match["away_team"], match["away_score"])):
            counted = scored.get((match_id, team), 0)
            if counted != int(official):
                errors.append(
                    f"{match_id} {team}: 공식 스코어 {int(official)}골인데 goal_events에는 "
                    f"{counted}골이 기록돼 있습니다"
                )

    # In an event week, player_stats' goal columns are ignored entirely -
    # a value typed there is silently discarded, so say so rather than
    # letting the two records drift apart unnoticed.
    for idx, row in player_stats.iterrows():
        if int(row["week"]) not in event_weeks:
            continue
        for col in ("goals", "assists", "own_goals"):
            value = row.get(col)
            if not pd.isna(value) and value != 0:
                warnings.append(
                    f"player_stats {_sheet_row(idx)}행 ({row['week']}주차, {row['player']}): "
                    f"{col}에 값이 있지만 이 주차는 goal_events로 계산되므로 무시됩니다"
                )

    return errors, warnings

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    sheets = load_sheets()
    matches, player_stats, players = sheets["matches"], sheets["player_stats"], sheets["players"]
    goal_events = sheets["goal_events"]
    strict = _is_strict()

    print(f"검증 모드: {'엄격 (수동 실행/로컬)' if strict else '완화 (자동 스케줄 실행)'}\n")

    checks: list[CheckResult] = [
        check_team_names(matches, player_stats, players),
        check_games_values(player_stats),
        check_player_names_known(player_stats, players),
        check_scores_valid(matches),
        check_matches_per_week(matches),
        check_team_goal_sums(matches, player_stats, strict),
        check_team_goal_diff_within_own_goal_budget(matches, player_stats, strict),
        check_active_players_missing_weeks(matches, player_stats, players),
        check_goal_events(matches, player_stats, goal_events),
    ]

    all_errors = [message for errors, _ in checks for message in errors]
    all_warnings = [message for _, warnings in checks for message in warnings]

    if all_warnings:
        print(f"⚠️  경고 {len(all_warnings)}건 (실패 처리는 안 됨):")
        for message in all_warnings:
            print(f"  - {message}")
        print()

    if all_errors:
        print(f"❌ 오류 {len(all_errors)}건 — 시트를 수정한 뒤 다시 실행해주세요:")
        for message in all_errors:
            print(f"  - {message}")
        sys.exit(1)

    print("✅ 검증 통과 — 오류 없음.")


if __name__ == "__main__":
    main()
