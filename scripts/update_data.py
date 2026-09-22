"""Pull KICKS league data from Google Sheets and build the site's JSON data.

Reads three published-to-web CSV tabs (matches, player_stats, players),
computes the league table and player leaderboard with pandas, and writes
the results to src/data/ for the Astro site to read directly.

Run manually after the Google Sheet is updated each week:

    python scripts/update_data.py
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# Published-to-web CSV export links (Google Sheets > File > Share > Publish
# to web), one per tab. `gid` selects the tab.
_SHEET_BASE = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vTXDgJDnllBZEDUnUNNM70nv8ywcjluVXjMGtu08nnUBG7nAFnrcKwqPGnSLj0rEoxc2pn5ESHXQVSa/pub"
)
SHEET_URLS = {
    "matches": f"{_SHEET_BASE}?gid=1550061733&single=true&output=csv",
    "player_stats": f"{_SHEET_BASE}?gid=1936064582&single=true&output=csv",
    "players": f"{_SHEET_BASE}?gid=1375969708&single=true&output=csv",
}

DATA_DIR = Path(__file__).resolve().parent.parent / "src" / "data"
SCHEDULE_PATH = DATA_DIR / "schedule.json"

# League points rule: wins are worth more in the final week.
FINAL_WEEK = 4
WIN_POINTS_EARLY = 2  # weeks 1-3
WIN_POINTS_FINAL = 3  # week 4 (finals)
DRAW_POINTS = 1
LOSS_POINTS = 0


def _load_league_week_dates() -> dict[int, str]:
    """Map league week number -> ISO date, read from schedule.json.

    schedule.json is the season's single source of truth for dates, since
    non-league events (friendlies, sports day, etc.) interrupt what would
    otherwise be an every-7-days cadence — a fixed weeks-since-start formula
    can't account for those gaps. Update schedule.json, not this function,
    at the start of a new season or whenever the calendar changes.
    """
    schedule = json.loads(SCHEDULE_PATH.read_text(encoding="utf-8"))
    return {
        entry["week"]: entry["date"]
        for entry in schedule
        if entry.get("type") == "league" and entry.get("date")
    }


LEAGUE_WEEK_DATES = _load_league_week_dates()


def _week_date(week: int) -> str:
    """ISO date (YYYY-MM-DD) a given league week falls on, per schedule.json."""
    try:
        return LEAGUE_WEEK_DATES[week]
    except KeyError:
        raise ValueError(
            f"No date for league week {week} in schedule.json — add a "
            f'{{"type": "league", "week": {week}, ...}} entry there.'
        ) from None


# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------


def load_sheets() -> dict[str, pd.DataFrame]:
    """Download the three published sheet tabs as DataFrames."""
    sheets = {name: pd.read_csv(url) for name, url in SHEET_URLS.items()}

    # own_goals is a newer player_stats column (blank/absent means 0) -
    # default it in here, once, so every caller (this script and
    # validate_data.py) can just assume the column exists.
    player_stats = sheets["player_stats"]
    if "own_goals" not in player_stats.columns:
        player_stats["own_goals"] = 0
    else:
        player_stats["own_goals"] = player_stats["own_goals"].fillna(0)

    return sheets


# ---------------------------------------------------------------------------
# League table
# ---------------------------------------------------------------------------


def _match_points(goals_for: float, goals_against: float, week: int) -> int:
    """Points a team earns for one match, given the week's scoring rule."""
    if goals_for > goals_against:
        return WIN_POINTS_FINAL if week >= FINAL_WEEK else WIN_POINTS_EARLY
    if goals_for == goals_against:
        return DRAW_POINTS
    return LOSS_POINTS


def _team_match_rows(matches: pd.DataFrame) -> pd.DataFrame:
    """Expand each match into one row per team (home + away perspective).

    This "long" shape makes it a single groupby to tally wins/draws/losses
    and goals for/against per team, instead of tracking home and away stats
    separately and merging them back together.
    """
    played = matches.dropna(subset=["home_score", "away_score"]).copy()

    home_rows = played.rename(columns={"home_team": "team", "away_team": "opponent"})
    home_rows["goals_for"] = played["home_score"]
    home_rows["goals_against"] = played["away_score"]

    away_rows = played.rename(columns={"away_team": "team", "home_team": "opponent"})
    away_rows["goals_for"] = played["away_score"]
    away_rows["goals_against"] = played["home_score"]

    columns = ["week", "team", "opponent", "goals_for", "goals_against"]
    team_rows = pd.concat([home_rows[columns], away_rows[columns]], ignore_index=True)

    team_rows["points"] = team_rows.apply(
        lambda row: _match_points(row["goals_for"], row["goals_against"], row["week"]), axis=1
    )
    team_rows["result"] = np.select(
        [team_rows["goals_for"] > team_rows["goals_against"], team_rows["goals_for"] == team_rows["goals_against"]],
        ["win", "draw"],
        default="loss",
    )
    return team_rows


def _participation_rates(team_rows: pd.DataFrame, player_stats: pd.DataFrame, roster: pd.DataFrame) -> pd.Series:
    """Tiebreaker: how much of each team's active roster actually shows up.

    rate = (total games played by the team's active roster)
           / (active roster size x games the team played)

    "Games the team played" is read week by week: whichever player(s)
    attended every session that week share the same `games` value, so the
    week's max is that team's session size. Those weekly session sizes are
    summed across every week the team has games on record.

    Deliberately computed from *every* recorded player_stats row, not just
    the active roster: it's meant to be an objective fact ("how many
    sessions did this team hold"), independent of anyone's current roster
    status. If it were computed from the roster-filtered rows instead, a
    player leaving mid-season (see AGENTS.md's "Player status" section)
    would retroactively shrink *past* weeks' session size too whenever
    they happened to be the one who set that week's max — silently
    understating how much everyone still on the roster actually showed
    up for. "Games played by the roster" (the numerator, just below) is
    the one figure that's intentionally scoped to today's active roster.
    """
    roster_size = roster.groupby("team")["player"].nunique()

    team_games_per_week = player_stats.groupby(["team", "week"])["games"].max()
    team_total_games = team_games_per_week.groupby("team").sum()

    stats = player_stats.merge(roster[["player", "team"]], on="player", suffixes=("", "_roster"))
    games_played = stats.groupby("team")["games"].sum(min_count=1).fillna(0)

    teams = team_rows["team"].unique()
    rates = {}
    for team in teams:
        members = roster_size.get(team, 0)
        total_games = team_total_games.get(team, 0)
        denominator = members * total_games
        rates[team] = round(games_played.get(team, 0) / denominator, 3) if denominator else 0.0
    return pd.Series(rates, name="participation_rate")


def build_league_table(matches: pd.DataFrame, player_stats: pd.DataFrame, roster: pd.DataFrame) -> list[dict]:
    """Compute the ranked league table from raw match results."""
    team_rows = _team_match_rows(matches)

    table = team_rows.groupby("team").agg(
        played=("team", "size"),
        wins=("result", lambda s: (s == "win").sum()),
        draws=("result", lambda s: (s == "draw").sum()),
        losses=("result", lambda s: (s == "loss").sum()),
        goals_for=("goals_for", "sum"),
        goals_against=("goals_against", "sum"),
        points=("points", "sum"),
    )
    table["goals_for"] = table["goals_for"].astype(int)
    table["goals_against"] = table["goals_against"].astype(int)
    table["goal_difference"] = table["goals_for"] - table["goals_against"]
    table["participation_rate"] = _participation_rates(team_rows, player_stats, roster)

    table = table.sort_values(
        by=["points", "participation_rate", "team"], ascending=[False, False, True]
    ).reset_index()
    table.insert(0, "rank", range(1, len(table) + 1))

    return table.to_dict(orient="records")


# ---------------------------------------------------------------------------
# Match results and upcoming fixtures
# ---------------------------------------------------------------------------


def build_matches(matches: pd.DataFrame) -> list[dict]:
    """All matches (played and upcoming) in sheet order, with a status flag."""
    matches = matches.copy()
    matches["status"] = np.where(matches["home_score"].notna() & matches["away_score"].notna(), "completed", "scheduled")
    matches["date"] = matches["week"].apply(_week_date)
    # Scores come in as float64 (the column holds NaN for upcoming fixtures);
    # cast the played ones to int so completed matches show whole numbers.
    matches["home_score"] = matches["home_score"].astype("Int64")
    matches["away_score"] = matches["away_score"].astype("Int64")
    return matches.to_dict(orient="records")


def build_week_summaries(matches: pd.DataFrame) -> list[dict]:
    """Each team's W/D/L and points for a single week, for the results cards.

    Reuses `_team_match_rows`, which already applies the same points rule as
    the league table, so this can't drift out of sync with it. Weeks with no
    completed matches simply produce no rows here.
    """
    team_rows = _team_match_rows(matches)
    summary = team_rows.groupby(["week", "team"], as_index=False).agg(
        wins=("result", lambda s: int((s == "win").sum())),
        draws=("result", lambda s: int((s == "draw").sum())),
        losses=("result", lambda s: int((s == "loss").sum())),
        points=("points", "sum"),
    )
    summary = summary.sort_values(by=["week", "points"], ascending=[True, False])
    return summary.to_dict(orient="records")


# ---------------------------------------------------------------------------
# Player leaderboard
# ---------------------------------------------------------------------------


GAMES_PER_WEEK = 6  # a player who attends every game in a week racks up 6 games


def _player_id(name: str) -> str:
    """URL-safe id for a player, used in /players/<id> links.

    Player names are Korean and shouldn't end up raw in a URL, so this
    hashes the name into a short stable slug instead. It's deterministic
    (same name -> same id every regen) and shared between the leaderboard
    and the player profiles below, so links between the two always match.
    """
    return hashlib.sha1(name.encode("utf-8")).hexdigest()[:8]


def build_leaderboard(player_stats: pd.DataFrame) -> list[dict]:
    """Season totals per player, ranked by attacking output.

    One row per player for the whole season, even if they changed teams
    partway through (see build_player_profiles's _team_segments for the
    full history) — grouping by player alone, not by (player, team), so a
    mid-season move doesn't split someone's totals across two rows. The
    Team column shows their *current* team (from their most recent week's
    row), matching how build_player_profiles picks current_team.

    We deliberately don't rank by a per-game rate: missing a week means a
    player skipped attendance, which a per-game average would reward rather
    than penalize. Instead the ranking is attacking_points -> goals ->
    assists -> attendance (more weeks attended wins ties), all on raw
    totals. Attendance itself is reported alongside as a secondary, human
    -readable stat ("weeks attended / weeks played so far").
    """
    weeks_played = int(player_stats["week"].nunique())
    player_stats = player_stats.fillna({"games": 0, "goals": 0, "assists": 0})

    current_team = player_stats.sort_values("week").groupby("player")["team"].last()

    totals = player_stats.groupby("player", as_index=False).agg(
        games=("games", "sum"), goals=("goals", "sum"), assists=("assists", "sum")
    )
    totals["team"] = totals["player"].map(current_team)

    totals["goals"] = totals["goals"].astype(int)
    totals["assists"] = totals["assists"].astype(int)
    totals["attacking_points"] = totals["goals"] + totals["assists"]
    totals["weeks_attended"] = (totals["games"] / GAMES_PER_WEEK).astype(int)
    totals["weeks_played"] = weeks_played
    totals["id"] = totals["player"].apply(_player_id)
    totals = totals.drop(columns=["games"])

    totals = totals.sort_values(
        by=["attacking_points", "goals", "assists", "weeks_attended"], ascending=False
    ).reset_index(drop=True)
    totals.insert(0, "rank", range(1, len(totals) + 1))

    return totals.to_dict(orient="records")


# ---------------------------------------------------------------------------
# Player profiles
# ---------------------------------------------------------------------------

# This is a friendly club site, not a scouting report: profiles celebrate
# every player, so there are deliberately no overall ratings, scores, or
# rankings here (that's what player_leaderboard.json is for). Everything
# below is either a season stat, a single positive play-style tag, or a
# badge — and every player ends up with at least one badge (see
# _badges' "squad_member" fallback).

# --- Play-style tag thresholds -------------------------------------------
# Exactly one tag per player. Checked in this order, first match wins, so
# the order below doubles as the priority when a player's stats could fit
# more than one description. Tune these constants as the season's scoring
# patterns become clearer.
FINISHER_GOAL_MARGIN = 2  # goals must lead assists by at least this much
ALL_ROUNDER_MAX_DIFF = 1  # goals/assists within this of each other counts as "balanced"
IRON_MAN_MIN_WEEKS_PLAYED = 2  # need a couple of weeks on record before attendance is a "style"

# --- Badge thresholds ------------------------------------------------------
BRACE_GOALS = 2  # 2+ goals in a single week
HAT_TRICK_GOALS = 3  # 3+ goals in a single week (also counts as a Brace)
OWN_GOAL_AWARD_MIN = 1  # 1+ own goal this season


def _avatar_initials(name: str) -> str:
    """Initials shown on the card in place of a photo.

    For a 3+ character Korean name, the last two characters read as the
    person's given name (e.g. 이종호 -> 종호); a 2-character name is short
    enough to show in full. A real photo can replace this later per player
    without touching this logic - see src/data/player-photos.json, which
    is hand-edited and looked up separately at render time.
    """
    return name if len(name) <= 2 else name[-2:]


def _team_segments(rows: pd.DataFrame) -> list[dict]:
    """Collapse a player's week-by-week rows into contiguous team spans.

    Almost always a single span (their one team all season). Merges
    consecutive weeks with the same team so a mid-season move shows up as
    exactly one extra span rather than one row per week.
    """
    rows = rows.sort_values("week")
    segments: list[dict] = []
    for _, row in rows.iterrows():
        week, team = int(row["week"]), row["team"]
        if segments and segments[-1]["team"] == team:
            segments[-1]["to_week"] = week
        else:
            segments.append({"team": team, "from_week": week, "to_week": week})
    return segments


def _personal_best_week(rows: pd.DataFrame) -> dict | None:
    """The player's highest attacking-points week, or None if they never
    had one (no goals or assists all season) — nothing to celebrate yet,
    so we skip it rather than spotlight a 0-0 week."""
    weekly = rows.assign(attacking_points=rows["goals"] + rows["assists"])
    best = weekly.loc[weekly["attacking_points"].idxmax()]
    if best["attacking_points"] <= 0:
        return None
    return {
        "week": int(best["week"]),
        "goals": int(best["goals"]),
        "assists": int(best["assists"]),
        "attacking_points": int(best["attacking_points"]),
    }


def _play_style_tag(goals: int, assists: int, weeks_attended: int, weeks_played: int) -> str:
    """One positive play-style tag — see the thresholds above for the rules."""
    if goals > 0 and goals >= assists + FINISHER_GOAL_MARGIN:
        return "Finisher"
    if assists >= 1 and assists >= goals:
        return "Playmaker"
    if goals >= 1 and assists >= 1 and abs(goals - assists) <= ALL_ROUNDER_MAX_DIFF:
        return "All-Rounder"
    if weeks_played >= IRON_MAN_MIN_WEEKS_PLAYED and weeks_attended == weeks_played:
        return "Iron Man"
    return "Team Player"


def _badges(
    rows: pd.DataFrame, goals: int, assists: int, own_goals: int, weeks_attended: int, weeks_played: int
) -> list[str]:
    """Every achievement badge a player has earned (a player can have many).

    Badge keys are looked up for their label/description/icon in
    src/lib/players.ts (BADGES) — add a badge in both places if you add a
    new one here. "squad_member" is a guaranteed fallback, not one of the
    "achievements": if nothing else triggered, everyone still gets a
    positive badge on their card.
    """
    first_week = int(rows["week"].min())
    max_week_goals = int(rows["goals"].max())

    badges = []
    if goals >= 1:
        badges.append("first_goal")
    if assists >= 1:
        badges.append("first_assist")
    if max_week_goals >= BRACE_GOALS:
        badges.append("brace")
    if max_week_goals >= HAT_TRICK_GOALS:
        badges.append("hat_trick")
    if weeks_played >= 1 and weeks_attended == weeks_played:
        badges.append("perfect_attendance")
    if first_week == 1:
        badges.append("week1_starter")
    # A "new" first appearance only means something once the season has
    # moved past week 1 - otherwise everyone would be a "Rookie".
    if weeks_played > 1 and first_week == weeks_played:
        badges.append("rookie")
    # A fun one, not a real "achievement" — the club tracks an own-goal
    # award, so this celebrates it rather than hiding it.
    if own_goals >= OWN_GOAL_AWARD_MIN:
        badges.append("own_goal_award")
    if not badges:
        badges.append("squad_member")
    return badges


def build_player_profiles(player_stats: pd.DataFrame) -> list[dict]:
    """One celebratory profile per player who has recorded stats this season.

    Players who haven't played a single game yet (sheet status "new", no
    rows in player_stats) don't have anything to show on a card - they'll
    get one automatically once their first week of stats is entered.
    """
    weeks_played = int(player_stats["week"].nunique())
    player_stats = player_stats.fillna({"games": 0, "goals": 0, "assists": 0, "own_goals": 0})

    profiles = []
    for name, rows in player_stats.groupby("player"):
        rows = rows.sort_values("week")
        goals = int(rows["goals"].sum())
        assists = int(rows["assists"].sum())
        own_goals = int(rows["own_goals"].sum())
        weeks_attended = int((rows["games"].sum()) / GAMES_PER_WEEK)

        segments = _team_segments(rows)

        profiles.append(
            {
                "id": _player_id(name),
                "name": name,
                "avatar_initials": _avatar_initials(name),
                "current_team": segments[-1]["team"],
                "team_history": segments[:-1],
                "season_totals": {
                    "goals": goals,
                    "assists": assists,
                    "attacking_points": goals + assists,
                    "weeks_attended": weeks_attended,
                    "weeks_played": weeks_played,
                },
                "weekly_stats": [
                    {
                        "week": int(row["week"]),
                        "team": row["team"],
                        "games": int(row["games"]),
                        "goals": int(row["goals"]),
                        "assists": int(row["assists"]),
                    }
                    for _, row in rows.iterrows()
                ],
                "personal_best_week": _personal_best_week(rows),
                "play_style_tag": _play_style_tag(goals, assists, weeks_attended, weeks_played),
                "badges": _badges(rows, goals, assists, own_goals, weeks_attended, weeks_played),
            }
        )

    profiles.sort(key=lambda p: (p["current_team"], p["name"]))
    return profiles


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------


def _to_jsonable(value):
    """Convert a numpy/pandas scalar to a plain JSON-safe Python value.

    Dicts/lists/None (e.g. player_profiles' nested season_totals,
    weekly_stats, team_history) are already plain Python from their own
    builder functions, so they pass through as-is - pd.isna() chokes on
    array-likes (dicts/lists) and would otherwise need special-casing here.
    """
    if value is None or isinstance(value, (dict, list)):
        return value
    if pd.isna(value):
        return None
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    return value


def write_json(filename: str, records: list[dict]) -> None:
    """Write a list of records to src/data/<filename> as pretty JSON."""
    clean_records = [{key: _to_jsonable(value) for key, value in row.items()} for row in records]
    path = DATA_DIR / filename
    with path.open("w", encoding="utf-8") as f:
        json.dump(clean_records, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"Wrote {len(clean_records)} records to {path.relative_to(DATA_DIR.parent.parent)}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    sheets = load_sheets()
    matches, player_stats, players = sheets["matches"], sheets["player_stats"], sheets["players"]

    active_roster = players[(players["status"] == "active") & players["team"].notna()]

    write_json("league_table.json", build_league_table(matches, player_stats, active_roster))
    write_json("matches.json", build_matches(matches))
    write_json("week_summaries.json", build_week_summaries(matches))
    write_json("player_leaderboard.json", build_leaderboard(player_stats))
    write_json("player_profiles.json", build_player_profiles(player_stats))


if __name__ == "__main__":
    main()
