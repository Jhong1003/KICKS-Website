"""Run: python3 -m unittest discover -s tests -p 'test_*.py'. No network.

Regression tests for the validation rules added after the 2026-10-09
fault-injection run (qa/README.md). Each test is a defect that used to pass
validation."""
from pathlib import Path
import sys
import unittest

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from validate_data import (  # noqa: E402
    check_absent_with_stats,
    check_active_players_missing_weeks,
    check_assists_within_goals,
    check_duplicate_player_weeks,
    check_team_changes,
)


def stats(*rows):
    cols = ["league", "week", "player", "team", "games", "goals", "assists", "own_goals"]
    return pd.DataFrame([dict(zip(cols, row)) for row in rows])


def finished_matches(league, weeks):
    return pd.DataFrame([
        dict(league=league, week=w, home_team="A", away_team="B", home_score=1, away_score=0) for w in weeks
    ])


class MissingWeeksTests(unittest.TestCase):
    def test_i002_row_deleted_again_after_player_marked_inactive(self):
        # 정경섭 joined in week 3 and played weeks 3-4, then was marked
        # inactive. Deleting his week 3 row used to pass validation.
        players = pd.DataFrame([dict(player="P", status="inactive", joined_week=3)])
        player_stats = stats(("L1", 4, "P", "A", 6, 0, 0, 0))
        errors, _ = check_active_players_missing_weeks(
            finished_matches("L1", [1, 2, 3, 4]), player_stats, players, ["L1"]
        )
        self.assertEqual(len(errors), 1)
        self.assertIn("3주차", errors[0])

    def test_inactive_player_after_last_week_is_not_missing(self):
        # Left after week 2: no rows for weeks 3-4 is a departure, not an error.
        players = pd.DataFrame([dict(player="P", status="inactive", joined_week=1)])
        player_stats = stats(("L1", 1, "P", "A", 6, 0, 0, 0), ("L1", 2, "P", "A", 6, 0, 0, 0))
        errors, _ = check_active_players_missing_weeks(
            finished_matches("L1", [1, 2, 3, 4]), player_stats, players, ["L1"]
        )
        self.assertEqual(errors, [])


class NewRuleTests(unittest.TestCase):
    def test_duplicate_row(self):
        row = ("L1", 1, "P", "A", 6, 0, 0, 0)
        self.assertEqual(len(check_duplicate_player_weeks(stats(row, row))[0]), 1)
        self.assertEqual(check_duplicate_player_weeks(stats(row))[0], [])

    def test_absent_with_stats(self):
        self.assertEqual(len(check_absent_with_stats(stats(("L1", 1, "P", "A", 0, 1, 0, 0)))[0]), 1)
        self.assertEqual(check_absent_with_stats(stats(("L1", 1, "P", "A", 0, 0, 0, 0)))[0], [])

    def test_assists_cannot_outnumber_goals(self):
        bad = stats(("L1", 1, "P", "A", 6, 1, 0, 0), ("L1", 1, "Q", "A", 6, 0, 2, 0))
        ok = stats(("L1", 1, "P", "A", 6, 2, 0, 0), ("L1", 1, "Q", "A", 6, 0, 1, 0))
        self.assertEqual(len(check_assists_within_goals(bad)[0]), 1)
        self.assertEqual(check_assists_within_goals(ok)[0], [])

    def test_team_change_needs_an_approved_transfer(self):
        moved = stats(("L1", 1, "P", "A", 6, 0, 0, 0), ("L1", 2, "P", "B", 6, 0, 0, 0))
        self.assertEqual(len(check_team_changes(moved, [])[0]), 1)
        self.assertEqual(check_team_changes(moved, [{"player": "P", "week": 2, "to": "B"}])[0], [])


if __name__ == "__main__":
    unittest.main()
