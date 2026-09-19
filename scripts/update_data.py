"""Pull KICKS league data from Google Sheets and build the site's JSON data.

Reads three published-to-web CSV tabs (matches, player_stats, players),
computes the league table and player leaderboard with pandas, and writes
the results to src/data/ for the Astro site to read directly.

Run manually after the Google Sheet is updated each week:

    python scripts/update_data.py
"""

from __future__ import annotations

import json
from datetime import date, timedelta
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

# League points rule: wins are worth more in the final week.
FINAL_WEEK = 4
WIN_POINTS_EARLY = 2  # weeks 1-3
WIN_POINTS_FINAL = 3  # week 4 (finals)
DRAW_POINTS = 1
LOSS_POINTS = 0

# Week 1 falls on this date; every later week is exactly 7 days after the
# last. Update this one line at the start of each new season.
SEASON_START_DATE = date(2026, 9, 6)


def _week_date(week: int) -> str:
    """ISO date (YYYY-MM-DD) for the Sunday a given week falls on."""
    return (SEASON_START_DATE + timedelta(weeks=week - 1)).isoformat()


# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------


def load_sheets() -> dict[str, pd.DataFrame]:
    """Download the three published sheet tabs as DataFrames."""
    return {name: pd.read_csv(url) for name, url in SHEET_URLS.items()}


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
    """
    roster_size = roster.groupby("team")["player"].nunique()

    stats = player_stats.merge(roster[["player", "team"]], on="player", suffixes=("", "_roster"))
    games_played = stats.groupby("team")["games"].sum(min_count=1).fillna(0)

    team_games_per_week = stats.groupby(["team", "week"])["games"].max()
    team_total_games = team_games_per_week.groupby("team").sum()

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


def build_leaderboard(player_stats: pd.DataFrame) -> list[dict]:
    """Season totals per player, ranked by attacking output.

    We deliberately don't rank by a per-game rate: missing a week means a
    player skipped attendance, which a per-game average would reward rather
    than penalize. Instead the ranking is attacking_points -> goals ->
    assists -> attendance (more weeks attended wins ties), all on raw
    totals. Attendance itself is reported alongside as a secondary, human
    -readable stat ("weeks attended / weeks played so far").
    """
    weeks_played = int(player_stats["week"].nunique())

    totals = (
        player_stats.fillna({"games": 0, "goals": 0, "assists": 0})
        .groupby(["player", "team"], as_index=False)
        .agg(games=("games", "sum"), goals=("goals", "sum"), assists=("assists", "sum"))
    )

    totals["goals"] = totals["goals"].astype(int)
    totals["assists"] = totals["assists"].astype(int)
    totals["attacking_points"] = totals["goals"] + totals["assists"]
    totals["weeks_attended"] = (totals["games"] / GAMES_PER_WEEK).astype(int)
    totals["weeks_played"] = weeks_played
    totals = totals.drop(columns=["games"])

    totals = totals.sort_values(
        by=["attacking_points", "goals", "assists", "weeks_attended"], ascending=False
    ).reset_index(drop=True)
    totals.insert(0, "rank", range(1, len(totals) + 1))

    return totals.to_dict(orient="records")


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------


def _to_jsonable(value):
    """Convert a numpy/pandas scalar to a plain JSON-safe Python value."""
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


if __name__ == "__main__":
    main()
