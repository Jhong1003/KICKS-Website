"""Run: python3 -m unittest discover -s tests -p 'test_*.py'. No network."""
import json
from pathlib import Path
import sys
import unittest
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from update_data import rank_team_rows, league_rules, build_league_table, _match_points, build_standings_history, _check_history


class StandingsTests(unittest.TestCase):
    def test_shared_ranking_cases(self):
        cases = json.loads((ROOT / "tests/standings-cases.json").read_text())
        for case in cases:
            with self.subTest(case=case["name"]):
                rows = rank_team_rows(case["rows"], league_rules("FA26-L1"))
                self.assertEqual([r["team_id"] for r in rows], case["order"])
                self.assertEqual([r["rank"] for r in rows], case["ranks"])

    def test_week_scoring(self):
        self.assertEqual(_match_points(1, 0, "FA26-L1", 3), 2)
        self.assertEqual(_match_points(1, 0, "FA26-L1", 4), 3)
        self.assertEqual(_match_points(1, 1, "FA26-L1", 4), 1)
        self.assertEqual(_match_points(0, 1, "FA26-L1", 4), 0)

    def test_pipeline_league_isolation_and_shared_rank(self):
        matches = pd.DataFrame([
            dict(league="A", week=1, home_team_id="T1", away_team_id="T2", home_score=1, away_score=1),
            dict(league="B", week=4, home_team_id="T1", away_team_id="T2", home_score=0, away_score=2),
        ])
        stats = pd.DataFrame([dict(league=l, week=1, player_id=p, team_id=t, games=6)
                              for l in ["A", "B"] for p, t in [("P1", "T1"), ("P2", "T2")]])
        rows = build_league_table(matches, stats, stats[["league", "player_id", "team_id"]])
        self.assertEqual([r["rank"] for r in rows if r["league"] == "A"], [1, 1])
        b = [r for r in rows if r["league"] == "B"]
        self.assertEqual(b[0]["team_id"], "T2")
        self.assertEqual(b[0]["points"], 3)


    def test_standings_history_ends_at_official_table(self):
        matches = pd.DataFrame([
            dict(league="A", week=1, home_team_id="T1", away_team_id="T2", home_score=1, away_score=0),
            dict(league="A", week=2, home_team_id="T1", away_team_id="T2", home_score=0, away_score=2),
            dict(league="A", week=3, home_team_id="T1", away_team_id="T2", home_score=None, away_score=None),
        ])
        stats = pd.DataFrame([dict(league="A", week=w, player_id=p, team_id=t, games=6)
                              for w in [1, 2] for p, t in [("P1", "T1"), ("P2", "T2")]])
        players = pd.DataFrame([dict(player_id="P1", status="active"), dict(player_id="P2", status="active")])
        history = build_standings_history(matches, stats, players)
        self.assertEqual(sorted({r["week"] for r in history}), [1, 2])  # unplayed week 3 left out
        week1 = {r["team_id"]: r for r in history if r["week"] == 1}
        self.assertEqual((week1["T1"]["rank"], week1["T1"]["points"]), (1, 2))
        table = build_league_table(matches, stats, stats[["league", "player_id", "team_id"]].drop_duplicates())
        _check_history(history, table)  # raises if the last week drifts from the table


if __name__ == "__main__":
    unittest.main()
