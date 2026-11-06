"""Track actual per-league JSON changes, keeping timestamps stable on no-op syncs."""
import hashlib
import json
from datetime import datetime, timezone

FILES = ("leagues.json", "league_table.json", "standings_history.json", "matches.json",
         "week_summaries.json", "goal_events.json", "player_leaderboard.json", "player_profiles.json")


def update_metadata(data_dir, now=None):
    path = data_dir / "data-updates.json"
    previous = json.loads(path.read_text()) if path.exists() else {}
    data = {name: json.loads((data_dir / name).read_text()) for name in FILES}
    result = {}
    for league in data["leagues.json"]:
        league_id = league["id"]
        snapshot = {}
        for name, rows in data.items():
            if name == "player_profiles.json":
                snapshot[name] = [dict(player, leagues=[s for s in player["leagues"] if s["league"] == league_id])
                                  for player in rows if any(s["league"] == league_id for s in player["leagues"])]
            elif name == "leagues.json":
                # Moving the site's default league does not change an old league's records.
                snapshot[name] = [{k: v for k, v in league.items() if k != "latest"}]
            else:
                snapshot[name] = [row for row in rows if row.get("league") == league_id]
        digest = hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        old = previous.get(league_id, {})
        result[league_id] = old if old.get("digest") == digest else {
            "digest": digest,
            "updated_at": now or datetime.now(timezone.utc).isoformat(),
        }
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result
