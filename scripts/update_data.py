"""Pull KICKS league data from Google Sheets and build the site's JSON data.

Reads the published-to-web CSV tabs (matches, player_stats, players,
goal_events, teams), computes the league table, player leaderboard and
player profiles with pandas, and writes the results to src/data/ for the
Astro site to read directly.

Names only exist at the edges: people type player and team *names* into the
sheet, resolve_ids() swaps them for ids (players tab player_id, teams tab
team_id) right after loading, and everything after that - and every
generated JSON file - works on ids. The site joins names back in only when
rendering.

Everything is computed per league (e.g. FA26-L1, FA26-L2): each league has
its own teams and restarts at week 1, and nothing is summed across leagues.
Per-league rules (points, finals week, ...) live in src/data/league-config.json.

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
    "goal_events": f"{_SHEET_BASE}?gid=271544291&single=true&output=csv",
    "teams": f"{_SHEET_BASE}?gid=561676455&single=true&output=csv",
}

DATA_DIR = Path(__file__).resolve().parent.parent / "src" / "data"
SCHEDULE_PATH = DATA_DIR / "schedule.json"

LEAGUE_CONFIG_PATH = DATA_DIR / "league-config.json"

LOSS_POINTS = 0


def _load_league_config() -> dict:
    return json.loads(LEAGUE_CONFIG_PATH.read_text(encoding="utf-8"))


LEAGUE_CONFIG = _load_league_config()


def league_rules(league: str) -> dict:
    """Rules for one league: league-config.json's "_default" overlaid with
    whatever that league lists for itself (a league not listed at all just
    gets the defaults)."""
    return {**LEAGUE_CONFIG["_default"], **LEAGUE_CONFIG.get(league, {})}


def _load_league_week_dates() -> dict[tuple[str, int], str]:
    """Map (league, league week number) -> ISO date, read from schedule.json.

    schedule.json is the season's single source of truth for dates, since
    non-league events (friendlies, sports day, etc.) interrupt what would
    otherwise be an every-7-days cadence — a fixed weeks-since-start formula
    can't account for those gaps. Update schedule.json, not this function,
    at the start of a new league or whenever the calendar changes.
    """
    schedule = json.loads(SCHEDULE_PATH.read_text(encoding="utf-8"))
    return {
        (entry["league"], entry["week"]): entry["date"]
        for entry in schedule
        if entry.get("type") == "league" and entry.get("date")
    }


LEAGUE_WEEK_DATES = _load_league_week_dates()


def _week_date(league: str, week: int) -> str:
    """ISO date (YYYY-MM-DD) a given league week falls on, per schedule.json."""
    try:
        return LEAGUE_WEEK_DATES[(league, week)]
    except KeyError:
        raise ValueError(
            f"No date for {league} week {week} in schedule.json — add a "
            f'{{"type": "league", "league": "{league}", "week": {week}, ...}} entry there.'
        ) from None


# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------


def _event_key(match_id: str) -> tuple[str, int] | None:
    """Pull (league, league week) out of a match_id like "FA26-L1-W03-M07"."""
    if not isinstance(match_id, str):
        return None
    parts = match_id.split("-")
    for index, part in enumerate(parts):
        if part.startswith("W") and part[1:].isdigit() and index > 0:
            return "-".join(parts[:index]), int(part[1:])
    return None


def _merge_goal_events(player_stats: pd.DataFrame, goal_events: pd.DataFrame) -> pd.DataFrame:
    """Recompute goals/assists/own_goals from goal_events, week by week.

    From the week goal_events starts being used, that tab is the source of
    truth: staff enter one row per goal and leave player_stats' goals,
    assists and own_goals blank. Earlier weeks were only ever recorded as
    weekly totals typed straight into player_stats, so they're left
    untouched — a (league, week) is rewritten only if it has at least one
    event.

    Every player row in a rewritten week is reset to 0 first, so a player
    who didn't score reads as an observed 0 rather than a blank.
    """
    events = goal_events.dropna(subset=["match_id", "scorer"]).copy()
    if events.empty:
        return player_stats

    keys = events["match_id"].apply(_event_key)
    events = events[keys.notna()].copy()
    if events.empty:
        return player_stats

    keys = keys[keys.notna()]
    events["league"] = keys.apply(lambda key: key[0])
    events["week"] = keys.apply(lambda key: key[1])
    events["is_own_goal"] = events["own_goal"].astype(str).str.strip().str.upper() == "Y"

    goals = events[~events["is_own_goal"]].groupby(["league", "week", "scorer"]).size()
    own_goals = events[events["is_own_goal"]].groupby(["league", "week", "scorer"]).size()
    assisted = events.dropna(subset=["assist"])
    assists = assisted.groupby(["league", "week", "assist"]).size()

    event_weeks = set(zip(events["league"], events["week"]))
    stats = player_stats.copy()
    rewrite = pd.MultiIndex.from_frame(stats[["league", "week"]]).isin(list(event_weeks))
    stats.loc[rewrite, ["goals", "assists", "own_goals"]] = 0

    for idx in stats.index[rewrite]:
        key = (stats.at[idx, "league"], stats.at[idx, "week"], stats.at[idx, "player"])
        stats.at[idx, "goals"] = int(goals.get(key, 0))
        stats.at[idx, "assists"] = int(assists.get(key, 0))
        stats.at[idx, "own_goals"] = int(own_goals.get(key, 0))

    return stats


def load_sheets() -> dict[str, pd.DataFrame]:
    """Download the published sheet tabs as DataFrames."""
    sheets = {name: pd.read_csv(url) for name, url in SHEET_URLS.items()}

    # Drop the all-blank rows a wide dropdown range leaves in the CSV export.
    sheets["goal_events"] = sheets["goal_events"].dropna(how="all")

    # own_goals is a newer player_stats column (blank/absent means 0) -
    # default it in here, once, so every caller (this script and
    # validate_data.py) can just assume the column exists.
    player_stats = sheets["player_stats"]
    if "own_goals" not in player_stats.columns:
        player_stats["own_goals"] = 0
    else:
        player_stats["own_goals"] = player_stats["own_goals"].fillna(0)

    sheets["player_stats"] = _merge_goal_events(player_stats, sheets["goal_events"])

    return sheets


# ---------------------------------------------------------------------------
# Names -> ids
# ---------------------------------------------------------------------------


def build_id_maps(players: pd.DataFrame, teams: pd.DataFrame) -> tuple[dict[str, str], dict[tuple[str, str], str]]:
    """The only place a typed name is turned into an id.

    - player name -> player_id (players tab). Names are assumed unique for
      now; a duplicate is an error rather than a silent guess. If two
      members ever share a name, this is the function to change (e.g. have
      staff type a disambiguated name, or the player_id itself, in the
      other tabs) - nothing downstream looks at names.
    - (league, team_name) -> team_id (teams tab). Team names and ids are
      only unique within a league (every league has its own T1, T2, ...).
    """
    problems = []
    names = players["player"]
    ids = players["player_id"]
    for label, column in (("player", names), ("player_id", ids)):
        if column.isna().any():
            problems.append(f"players tab has rows with a blank `{label}`")
        duplicated = sorted(set(column[column.duplicated() & column.notna()]))
        if duplicated:
            problems.append(f"players tab has duplicate {label}(s): {duplicated}")
    if problems:
        raise ValueError("; ".join(problems))

    player_ids = dict(zip(names, ids))
    team_ids = {
        (league, name): team_id
        for league, name, team_id in zip(teams["league"], teams["team_name"], teams["team_id"])
    }
    return player_ids, team_ids


def resolve_ids(sheets: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    """Swap every player/team name in matches and player_stats for its id.

    matches: home_team/away_team -> home_team_id/away_team_id.
    player_stats: player/team -> player_id/team_id.
    players keeps both `player` (the display name) and `player_id` - it's
    the table names are joined back from. goal_events has already been
    folded into player_stats by load_sheets() and isn't used after that.

    A name that doesn't resolve fails the whole run, listing every one at
    once. validate_data.py (check_team_names / check_player_names_known /
    check_player_ids) reports the same problems first, with sheet row
    numbers - this is the backstop for running update_data.py on its own.
    """
    players, teams = sheets["players"].copy(), sheets["teams"].copy()
    # A stray space around an id would otherwise split one player/team in two.
    players["player_id"] = players["player_id"].str.strip()
    teams["team_id"] = teams["team_id"].str.strip()
    player_ids, team_ids = build_id_maps(players, teams)
    unknown: set[str] = set()

    def team_id(league: str, name: str) -> str | None:
        if pd.isna(name):
            return None
        if (league, name) not in team_ids:
            unknown.add(f"team '{name}' ({league})")
        return team_ids.get((league, name))

    def player_id(name: str) -> str | None:
        if name not in player_ids:
            unknown.add(f"player '{name}'")
        return player_ids.get(name)

    matches = sheets["matches"].copy()
    for side in ("home", "away"):
        matches[f"{side}_team"] = [team_id(l, n) for l, n in zip(matches["league"], matches[f"{side}_team"])]
    matches = matches.rename(columns={"home_team": "home_team_id", "away_team": "away_team_id"})

    stats = sheets["player_stats"].copy()
    stats["player"] = stats["player"].map(player_id)
    stats["team"] = [team_id(l, n) for l, n in zip(stats["league"], stats["team"])]
    stats = stats.rename(columns={"player": "player_id", "team": "team_id"})

    if unknown:
        raise ValueError(
            "Names not found on the players/teams tabs (run validate_data.py for row numbers): "
            + ", ".join(sorted(unknown))
        )
    return {**sheets, "matches": matches, "player_stats": stats, "players": players, "teams": teams}


# ---------------------------------------------------------------------------
# League table
# ---------------------------------------------------------------------------


def _match_points(goals_for: float, goals_against: float, league: str, week: int) -> int:
    """Points a team earns for one match, given that league's scoring rule."""
    rules = league_rules(league)
    if goals_for > goals_against:
        return rules["final_win_points"] if week >= rules["final_week"] else rules["win_points"]
    if goals_for == goals_against:
        return rules["draw_points"]
    return LOSS_POINTS


def _team_match_rows(matches: pd.DataFrame) -> pd.DataFrame:
    """Expand each match into one row per team (home + away perspective).

    This "long" shape makes it a single groupby to tally wins/draws/losses
    and goals for/against per team, instead of tracking home and away stats
    separately and merging them back together.
    """
    played = matches.dropna(subset=["home_score", "away_score"]).copy()

    home_rows = played.rename(columns={"home_team_id": "team_id", "away_team_id": "opponent_id"})
    home_rows["goals_for"] = played["home_score"]
    home_rows["goals_against"] = played["away_score"]

    away_rows = played.rename(columns={"away_team_id": "team_id", "home_team_id": "opponent_id"})
    away_rows["goals_for"] = played["away_score"]
    away_rows["goals_against"] = played["home_score"]

    columns = ["league", "week", "team_id", "opponent_id", "goals_for", "goals_against"]
    team_rows = pd.concat([home_rows[columns], away_rows[columns]], ignore_index=True)

    team_rows["points"] = team_rows.apply(
        lambda row: _match_points(row["goals_for"], row["goals_against"], row["league"], row["week"]), axis=1
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
    roster_size = roster.groupby("team_id")["player_id"].nunique()

    team_games_per_week = player_stats.groupby(["team_id", "week"])["games"].max()
    team_total_games = team_games_per_week.groupby("team_id").sum()

    stats = player_stats.merge(roster[["player_id", "team_id"]], on="player_id", suffixes=("", "_roster"))
    games_played = stats.groupby("team_id")["games"].sum(min_count=1).fillna(0)

    teams = team_rows["team_id"].unique()
    rates = {}
    for team in teams:
        members = roster_size.get(team, 0)
        total_games = team_total_games.get(team, 0)
        denominator = members * total_games
        rates[team] = round(games_played.get(team, 0) / denominator, 3) if denominator else 0.0
    return pd.Series(rates, name="participation_rate")


def rank_team_rows(rows: list[dict], rules: dict) -> list[dict]:
    """Official descending criteria; equal tuples share competition rank (1, 1, 3).

    Stable ordering is presentation only. Team ids never decide a winner.
    """
    criteria = rules["ranking_criteria"]
    ordered = sorted(rows, key=lambda row: tuple(-row[key] for key in criteria))
    previous = None
    rank = 0
    result = []
    for position, row in enumerate(ordered, 1):
        key = tuple(row[field] for field in criteria)
        if key != previous:
            rank = position
        result.append({**row, "rank": rank})
        previous = key
    return result


def build_league_table(matches: pd.DataFrame, player_stats: pd.DataFrame, roster: pd.DataFrame) -> list[dict]:
    """Compute each league's ranked table from raw match results.

    One table per league (ranks restart at 1 in each), concatenated in
    sheet order with a `league` column. A league with no completed match
    yet (e.g. next league's fixtures entered ahead of time) has no table.
    """
    records: list[dict] = []
    for league, league_matches in matches.groupby("league", sort=False):
        team_rows = _team_match_rows(league_matches)
        if team_rows.empty:
            continue

        table = team_rows.groupby("team_id").agg(
            played=("team_id", "size"),
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
        table["participation_rate"] = _participation_rates(
            team_rows,
            player_stats[player_stats["league"] == league],
            roster[roster["league"] == league],
        )

        table = table.reset_index()
        table.insert(0, "rank", 0)
        table.insert(0, "league", league)
        records.extend(rank_team_rows(table.to_dict(orient="records"), league_rules(league)))

    return records


# ---------------------------------------------------------------------------
# Match results and upcoming fixtures
# ---------------------------------------------------------------------------


def build_matches(matches: pd.DataFrame) -> list[dict]:
    """All matches (played and upcoming) in sheet order, with a status flag."""
    matches = matches.copy()
    matches["status"] = np.where(matches["home_score"].notna() & matches["away_score"].notna(), "completed", "scheduled")
    matches["date"] = [_week_date(league, int(week)) for league, week in zip(matches["league"], matches["week"])]
    # Scores come in as float64 (the column holds NaN for upcoming fixtures);
    # cast the played ones to int so completed matches show whole numbers.
    matches["home_score"] = matches["home_score"].astype("Int64")
    matches["away_score"] = matches["away_score"].astype("Int64")
    return matches.to_dict(orient="records")


def build_week_summaries(matches: pd.DataFrame) -> list[dict]:
    """Each team's W/D/L and points for a single league week, for the results cards.

    Reuses `_team_match_rows`, which already applies the same points rule as
    the league table, so this can't drift out of sync with it. Weeks with no
    completed matches simply produce no rows here.
    """
    team_rows = _team_match_rows(matches)
    summary = team_rows.groupby(["league", "week", "team_id"], as_index=False).agg(
        wins=("result", lambda s: int((s == "win").sum())),
        draws=("result", lambda s: int((s == "draw").sum())),
        losses=("result", lambda s: int((s == "loss").sum())),
        points=("points", "sum"),
    )
    league_order = {league: index for index, league in enumerate(dict.fromkeys(matches["league"]))}
    summary = summary.sort_values(
        by=["league", "week", "points"],
        ascending=[True, True, False],
        key=lambda column: column.map(league_order) if column.name == "league" else column,
    )
    return summary.to_dict(orient="records")


# ---------------------------------------------------------------------------
# Player leaderboard
# ---------------------------------------------------------------------------


GAMES_PER_WEEK = 6  # a player who attends every game in a week racks up 6 games


def _player_slug(name: str) -> str:
    """URL slug for a player, used in /players/<slug> links (the `id` field
    in player_leaderboard.json / player_profiles.json).

    Not the same thing as player_id (the players tab's P001, ...), which is
    the player's identity in the data: this is only the public URL. Player
    names are Korean and shouldn't end up raw in a URL, so this hashes the
    name into a short stable slug instead. It's deterministic (same name ->
    same slug every regen), which keeps existing links and
    player-photos.json keys working.
    """
    return hashlib.sha1(name.encode("utf-8")).hexdigest()[:8]


def build_leaderboard(player_stats: pd.DataFrame, players: pd.DataFrame) -> list[dict]:
    """Per-league totals per player, ranked by attacking output.

    One row per (league, player) — nothing is summed across leagues, and
    ranks restart at 1 in each. Within a league it's still one row per
    player even if they changed teams partway through (see
    build_player_profiles's _team_segments for the full history) —
    grouping by player alone, not by (player, team), so a mid-league move
    doesn't split someone's totals across two rows. The Team column shows
    their *current* team in that league (from their most recent week's
    row), matching how build_player_profiles picks current_team.

    We deliberately don't rank by a per-game rate: missing a week means a
    player skipped attendance, which a per-game average would reward rather
    than penalize. Instead the ranking is attacking_points -> goals ->
    assists -> attendance (more weeks attended wins ties), all on raw
    totals. Attendance itself is reported alongside as a secondary, human
    -readable stat ("weeks attended / weeks played so far").
    """
    statuses = players.set_index("player_id")["status"]
    names = players.set_index("player_id")["player"]

    records: list[dict] = []
    for league, league_stats in player_stats.groupby("league", sort=False):
        weeks_played = int(league_stats["week"].nunique())
        league_stats = league_stats.fillna({"games": 0, "goals": 0, "assists": 0})

        current_team = league_stats.sort_values("week").groupby("player_id")["team_id"].last()

        totals = league_stats.groupby("player_id", as_index=False).agg(
            games=("games", "sum"), goals=("goals", "sum"), assists=("assists", "sum")
        )
        totals["team_id"] = totals["player_id"].map(current_team)
        totals["status"] = totals["player_id"].map(statuses).fillna("active")

        totals["goals"] = totals["goals"].astype(int)
        totals["assists"] = totals["assists"].astype(int)
        totals["attacking_points"] = totals["goals"] + totals["assists"]
        totals["weeks_attended"] = (totals["games"] / GAMES_PER_WEEK).astype(int)
        totals["weeks_played"] = weeks_played
        totals["id"] = totals["player_id"].map(names).apply(_player_slug)
        totals = totals.drop(columns=["games"])

        # Full ties fall back to name order (display only, not a real tiebreaker).
        totals["_name"] = totals["player_id"].map(names)
        totals = (
            totals.sort_values(
                by=["attacking_points", "goals", "assists", "weeks_attended", "_name"],
                ascending=[False, False, False, False, True],
            )
            .drop(columns=["_name"])
            .reset_index(drop=True)
        )
        totals.insert(0, "rank", range(1, len(totals) + 1))
        totals.insert(0, "league", league)
        records.extend(totals.to_dict(orient="records"))

    return records


# ---------------------------------------------------------------------------
# Player profiles
# ---------------------------------------------------------------------------

# This is a friendly club site, not a scouting report: profiles celebrate
# every player, so there are deliberately no overall ratings, scores, or
# rankings here (that's what player_leaderboard.json is for). Everything
# below is either a league stat, a single positive play-style tag, or a
# badge — and every player ends up with at least one badge per league (see
# _badges' "squad_member" fallback). All of it is computed per league;
# nothing carries over between leagues.

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
OWN_GOAL_AWARD_MIN = 1  # 1+ own goal in the league


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
        week, team_id = int(row["week"]), row["team_id"]
        if segments and segments[-1]["team_id"] == team_id:
            segments[-1]["to_week"] = week
        else:
            segments.append({"team_id": team_id, "from_week": week, "to_week": week})
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
    """Every achievement badge a player has earned in one league (a player can have many).

    Badge keys are looked up for their label/description/icon in
    src/lib/players.ts (BADGES) — add a badge in both places if you add a
    new one here. "squad_member" is a guaranteed fallback, not one of the
    "achievements": if nothing else triggered, everyone still gets a
    positive badge on their card.
    """
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
    # A fun one, not a real "achievement" — the club tracks an own-goal
    # award, so this celebrates it rather than hiding it.
    if own_goals >= OWN_GOAL_AWARD_MIN:
        badges.append("own_goal_award")
    if not badges:
        badges.append("squad_member")
    return badges

def _positions_for(player_id: str, positions: pd.DataFrame) -> list[str]:
    """A player's positions, primary first, skipping any that are blank.
    ...
    """
    if player_id not in positions.index:
        return []
    row = positions.loc[player_id]
    return [value for value in (row["primary_position"], row["secondary_position"]) if not pd.isna(value)]


def _league_section(league: str, rows: pd.DataFrame, weeks_played: int) -> dict:
    """One player's profile for a single league (stats, tag, badges)."""
    rows = rows.sort_values("week")
    goals = int(rows["goals"].sum())
    assists = int(rows["assists"].sum())
    own_goals = int(rows["own_goals"].sum())
    weeks_attended = int((rows["games"].sum()) / GAMES_PER_WEEK)

    segments = _team_segments(rows)

    return {
        "league": league,
        "current_team_id": segments[-1]["team_id"],
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
                "team_id": row["team_id"],
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


def build_player_profiles(player_stats: pd.DataFrame, players: pd.DataFrame, league_order: list[str]) -> list[dict]:
    """One celebratory profile per player who has recorded stats in any league.

    A profile has one section per league the player has played in
    (`leagues`, newest first) — stats, play-style tag and badges are all
    per league, never combined. There is deliberately no top-level copy of
    "the current league's" fields: which league a page shows is the page's
    decision (the site's latest league, or a specific one), not whichever
    one this player happened to play last.

    Players who haven't played a single game yet (sheet status "new", no
    rows in player_stats) don't have anything to show on a card - they'll
    get one automatically once their first week of stats is entered.
    """
    weeks_played = player_stats.groupby("league")["week"].nunique().to_dict()
    player_stats = player_stats.fillna({"games": 0, "goals": 0, "assists": 0, "own_goals": 0})
    by_id = players.set_index("player_id")
    positions = by_id[["primary_position", "secondary_position"]]
    statuses = by_id["status"].dropna()
    league_rank = {league: index for index, league in enumerate(league_order)}

    profiles = []
    for player_id, player_rows in player_stats.groupby("player_id"):
        name = by_id.at[player_id, "player"]
        sections = [
            _league_section(league, rows, int(weeks_played[league]))
            for league, rows in player_rows.groupby("league", sort=False)
        ]
        sections.sort(key=lambda section: league_rank[section["league"]], reverse=True)

        profiles.append(
            {
                "id": _player_slug(name),
                "player_id": player_id,
                "name": name,
                "avatar_initials": _avatar_initials(name),
                "positions": _positions_for(player_id, positions),
                "status": statuses.get(player_id, "active"),
                "leagues": sections,
            }
        )

    profiles.sort(key=lambda p: p["name"])
    return profiles


# ---------------------------------------------------------------------------
# Leagues (teams, colors, which one is latest)
# ---------------------------------------------------------------------------


def build_leagues(teams: pd.DataFrame, matches: pd.DataFrame) -> list[dict]:
    """The list of leagues, in teams-tab order, each with its teams and rules.

    "latest" is the most recent league that has at least one completed
    match — not just the most recent one on the teams tab — so the site
    keeps showing the current league until the next one's first game is
    actually played, even if its teams and fixtures are entered early.
    """
    order = list(dict.fromkeys(teams["league"]))
    started = set(matches.dropna(subset=["home_score", "away_score"])["league"])
    latest = next((league for league in reversed(order) if league in started), order[-1])

    leagues = []
    for league in order:
        league_teams = teams[teams["league"] == league]
        leagues.append(
            {
                "id": league,
                "latest": league == latest,
                "started": league in started,
                "rules": league_rules(league),
                "teams": [
                    {
                        "team_id": row["team_id"],
                        "name": row["team_name"],
                        "color": None if pd.isna(row["color"]) else str(row["color"]).strip(),
                    }
                    for _, row in league_teams.iterrows()
                ],
            }
        )
    return leagues


def build_rosters(player_stats: pd.DataFrame, players: pd.DataFrame) -> pd.DataFrame:
    """Each league's active roster: (league, player_id, team_id).

    Derived from that league's player_stats rows (a player belongs to a
    league's roster if they have at least one row there) rather than from
    the players tab, whose single `team` column can only describe the
    newest league. Their team is the one on their most recent row in the
    league. Only `active` players count — same rule as before, applied to
    the global `status` column.
    """
    statuses = players.set_index("player_id")["status"]
    roster = (
        player_stats.sort_values("week")
        .groupby(["league", "player_id"], as_index=False)["team_id"]
        .last()
    )
    roster["status"] = roster["player_id"].map(statuses).fillna("active")
    return roster[roster["status"] == "active"][["league", "player_id", "team_id"]]


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


def _check_leagues(teams: pd.DataFrame, matches: pd.DataFrame, player_stats: pd.DataFrame) -> None:
    """Fail loudly on a missing/unknown `league` instead of silently dropping
    those rows (a blank league would vanish from every per-league groupby)."""
    known = set(teams["league"].dropna())
    for name, df in [("matches", matches), ("player_stats", player_stats)]:
        if df["league"].isna().any():
            raise ValueError(f"{name} tab has rows with a blank `league`")
        unknown = set(df["league"]) - known
        if unknown:
            raise ValueError(f"{name} tab uses league(s) {sorted(unknown)} that aren't on the teams tab")


def main() -> None:
    sheets = load_sheets()
    _check_leagues(sheets["teams"], sheets["matches"], sheets["player_stats"])
    sheets = resolve_ids(sheets)
    matches, player_stats, players, teams = (
        sheets["matches"],
        sheets["player_stats"],
        sheets["players"],
        sheets["teams"],
    )

    leagues = build_leagues(teams, matches)
    league_order = [league["id"] for league in leagues]
    rosters = build_rosters(player_stats, players)

    write_json("leagues.json", leagues)
    write_json("league_table.json", build_league_table(matches, player_stats, rosters))
    write_json("matches.json", build_matches(matches))
    write_json("week_summaries.json", build_week_summaries(matches))
    write_json("player_leaderboard.json", build_leaderboard(player_stats, players))
    write_json("player_profiles.json", build_player_profiles(player_stats, players, league_order))


if __name__ == "__main__":
    main()
