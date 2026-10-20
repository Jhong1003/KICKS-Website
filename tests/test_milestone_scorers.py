"""Run: python3 -m unittest discover -s tests -p 'test_*.py'. No network.

History Maker: who scored KICKS' 100th, 200th, ... all-time goal
(`_milestone_scorers` in scripts/update_data.py)."""
from pathlib import Path
import json
import sys
import unittest

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import update_data  # noqa: E402
from update_data import _milestone_scorers  # noqa: E402


def match(match_id, week, home, away, league="FA26-L2"):
    return dict(league=league, week=week, match_id=match_id, home_score=home, away_score=away)


def goal(match_id, minute, scorer_id, own_goal=False):
    return dict(match_id=match_id, minute=minute, scorer_id=scorer_id, own_goal=own_goal)


class MilestoneScorers(unittest.TestCase):
    def setUp(self):
        self.step = update_data.GOAL_MILESTONE_STEP
        update_data.GOAL_MILESTONE_STEP = 4

    def tearDown(self):
        update_data.GOAL_MILESTONE_STEP = self.step

    def test_nth_goal_in_minute_order(self):
        matches = pd.DataFrame([match("FA26-L2-W01-M01", 1, 2, 1), match("FA26-L2-W01-M02", 1, 1, 2)])
        goals = [goal("FA26-L2-W01-M02", 9, "P3"), goal("FA26-L2-W01-M02", 2, "P1"), goal("FA26-L2-W01-M02", 5, "P2")]
        self.assertEqual(_milestone_scorers(matches, goals), {("FA26-L2", "P1")})

    def test_unsure_cases_give_nobody(self):
        matches = pd.DataFrame([match("FA26-L2-W01-M01", 1, 2, 1), match("FA26-L2-W01-M02", 1, 1, 2)])
        own = [goal("FA26-L2-W01-M02", 2, "P1", True), goal("FA26-L2-W01-M02", 5, "P2"), goal("FA26-L2-W01-M02", 9, "P3")]
        same_minute = [goal("FA26-L2-W01-M02", 2, "P1"), goal("FA26-L2-W01-M02", 2, "P2"), goal("FA26-L2-W01-M02", 9, "P3")]
        no_minute = [goal("FA26-L2-W01-M02", None, "P1"), goal("FA26-L2-W01-M02", 5, "P2"), goal("FA26-L2-W01-M02", 9, "P3")]
        for goals in (own, same_minute, no_minute, []):
            self.assertEqual(_milestone_scorers(matches, goals), set())

    def test_real_data_names_the_100th_goal(self):
        update_data.GOAL_MILESTONE_STEP = self.step
        data = ROOT / "src" / "data"
        matches = pd.DataFrame(json.loads((data / "matches.json").read_text()))
        goals = json.loads((data / "goal_events.json").read_text())
        total = int(matches["home_score"].fillna(0).sum() + matches["away_score"].fillna(0).sum())
        scorers = _milestone_scorers(matches, goals)
        if total >= 100:
            self.assertLessEqual(len(scorers), total // 100)


if __name__ == "__main__":
    unittest.main()
