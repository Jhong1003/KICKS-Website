"""Escaped defects: values the site published for a finished week that a
later data commit changed.

Every data commit in git history is a snapshot of what kicksuiuc.com showed
(Cloudflare redeploys on every push to main). This replays those snapshots,
normalises each one to the same records despite schema changes along the
way (team names -> ids, single season -> leagues), and lists every change
to a week that was already fully played when it was first published.

    python qa/published_history.py --out qa/results/published-history.json
"""
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime
from zoneinfo import ZoneInfo

CHICAGO = ZoneInfo("America/Chicago")
from collections import Counter, defaultdict

DATA = ["src/data/matches.json", "src/data/player_profiles.json"]


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def show(commit, path):
    try:
        return json.loads(git("show", f"{commit}:{path}"))
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        return None


def team_names(commit):
    """(league, team_id) -> name, for snapshots that store ids."""
    leagues = show(commit, "src/data/leagues.json") or []
    return {(l["id"], t["team_id"]): t["name"] for l in leagues for t in l["teams"]}


def snapshot(commit):
    names = team_names(commit)
    matches = {}
    seen = Counter()
    for m in show(commit, DATA[0]) or []:
        if "week" not in m:
            return {}, {}  # hand-typed placeholder data from before the Sheet pipeline existed
        league = m.get("league", "FA26-L1")
        home = m.get("home_team") or names.get((league, m.get("home_team_id")), m.get("home_team_id"))
        away = m.get("away_team") or names.get((league, m.get("away_team_id")), m.get("away_team_id"))
        base = (league, m["week"], home, away)
        seen[base] += 1  # the k-th meeting of this pairing that week
        matches[(*base, seen[base])] = (m.get("home_score"), m.get("away_score"))

    players = {}
    profiles = show(commit, DATA[1]) or []
    profiles = profiles if isinstance(profiles, list) else list(profiles.values())
    for p in profiles:
        sections = p.get("leagues") or [{"league": "FA26-L1", **p}]
        for s in sections:
            for w in s.get("weekly_stats", []):
                team = w.get("team") or names.get((s["league"], w.get("team_id")), w.get("team_id"))
                players[(s["league"], w["week"], p["name"])] = {
                    "team": team, "games": w.get("games"), "goals": w.get("goals"), "assists": w.get("assists"),
                }
    return matches, players


def finished_weeks(matches):
    weeks = defaultdict(list)
    for (league, week, *_), score in matches.items():
        weeks[(league, week)].append(None not in score)
    return {k for k, done in weeks.items() if all(done)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    args = ap.parse_args()

    log = git("log", "origin/main", "--reverse", "--format=%h|%aI|%an|%s", "--", *DATA).strip().splitlines()
    events = []
    first_seen_finished = {}  # (league, week) -> commit date it was first published finished
    prev = None
    since = {}  # record key -> date its current value (or absence) first went public in a finished week
    for line in log:
        commit, date, author, subject = line.split("|", 3)
        matches, players = snapshot(commit)
        if not matches:
            continue
        done = finished_weeks(matches)
        for key in done:
            first_seen_finished.setdefault(key, date)
        if prev:
            p_matches, p_players, p_done, p_date = prev
            def record(kind, key, before, after):
                lw = (key[0], key[1])
                if lw in p_done:  # only weeks that were already finished and public
                    wrong_since = since.get(key, first_seen_finished.get(lw))
                    events.append(dict(commit=commit, date=date, author=author, subject=subject, kind=kind,
                                       league=key[0], week=key[1], what=list(key[2:]), before=before, after=after,
                                       wrong_since=wrong_since,
                                       days_public=round((datetime.fromisoformat(date) - datetime.fromisoformat(wrong_since)).total_seconds() / 86400, 1)))
                since[key] = date
            for key in set(p_matches) | set(matches):
                if p_matches.get(key) != matches.get(key):
                    record("match", key, p_matches.get(key), matches.get(key))
            # The first snapshot with player pages isn't a correction of anything.
            for key in (set(p_players) | set(players)) if p_players else ():
                b, a = p_players.get(key), players.get(key)
                if b == a:
                    continue
                if b and a:
                    changed = {f: (b[f], a[f]) for f in b if b[f] != a.get(f)}
                    record("player_field", key, {f: v[0] for f, v in changed.items()}, {f: v[1] for f, v in changed.items()})
                else:
                    record("player_row_added" if a else "player_row_removed", key, b, a)
        for key in list(matches) + list(players):
            if (key[0], key[1]) in done:
                since.setdefault(key, date)
        if players and not (prev and prev[1]):
            for key in done:  # player pages start here: absences in finished weeks count from now
                first_seen_finished[key] = max(first_seen_finished[key], date)
        prev = (matches, players, done, date)

    for e in events:
        print(datetime.fromisoformat(e["date"]).astimezone(CHICAGO).strftime("%m-%d %H:%M CT"), e["commit"], e["author"][:12], f"{e['days_public']}d", e["kind"], e["league"], f"W{e['week']}", e["what"], e["before"], "->", e["after"])
    if args.out:
        json.dump(events, open(args.out, "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
