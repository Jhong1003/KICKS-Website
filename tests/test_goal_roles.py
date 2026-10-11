"""Run: python3 -m unittest discover -s tests -p 'test_*.py'. No network.

What a goal did to the score (`_tag_goal_roles` in scripts/update_data.py).
Replaying a match's goals in order is the whole point, so these cases are
written as score sequences rather than as single goals."""
from pathlib import Path
import sys
import unittest

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from update_data import _goal_role_counts, _tag_goal_roles  # noqa: E402

MATCH = "L-W01-M01"


def match(home_score, away_score):
    return pd.DataFrame([
        dict(match_id=MATCH, home_team_id="A", away_team_id="B",
             home_score=home_score, away_score=away_score)
    ])


def goals(*scorers, minutes=None, own=()):
    """One row per goal, in the order given. `scorers` are the credited teams."""
    minutes = minutes or list(range(1, len(scorers) + 1))
    return [
        dict(league="L", week=1, match_id=MATCH, minute=minute, scorer_id=f"P{index}",
             assist_id=None, own_goal=index in own, team_id=team, scorer_team_id=team)
        for index, (team, minute) in enumerate(zip(scorers, minutes))
    ]


def roles_of(rows):
    return [row["roles"] for row in rows]


class GoalRoleTests(unittest.TestCase):
    def test_the_only_goal_of_a_1_0_is_both_opener_and_winner(self):
        rows = goals("A")
        _tag_goal_roles(rows, match(1, 0))
        self.assertEqual(roles_of(rows), [["opener", "winner"]])

    def test_a_goal_that_only_extends_a_lead_has_no_role(self):
        # 2-0: the first goal is the one they were never caught after.
        rows = goals("A", "A")
        _tag_goal_roles(rows, match(2, 0))
        self.assertEqual(roles_of(rows), [["opener", "winner"], []])

    def test_a_draw_has_an_opener_and_an_equaliser_but_no_winner(self):
        rows = goals("A", "B")
        _tag_goal_roles(rows, match(1, 1))
        self.assertEqual(roles_of(rows), [["opener"], ["equaliser"]])

    def test_going_ahead_from_level_is_not_a_comeback(self):
        # 1-1 then A again: A led throughout or was level, never behind.
        rows = goals("A", "B", "A")
        _tag_goal_roles(rows, match(2, 1))
        self.assertEqual(roles_of(rows), [["opener"], ["equaliser"], ["winner"]])

    def test_comeback_needs_the_team_to_have_trailed(self):
        # 0-1, 1-1, 2-1 to B... from A's point of view: A scores, B levels,
        # B goes ahead having been behind - that third goal is the comeback.
        rows = goals("A", "B", "B")
        _tag_goal_roles(rows, match(1, 2))
        self.assertEqual(roles_of(rows), [["opener"], ["equaliser"], ["comeback", "winner"]])

    def test_the_winner_is_counted_from_the_losers_final_score(self):
        # 3-2, A leading or level all the way: B finish on 2, so it's A's
        # *third* goal they were never caught after, not their first. A was
        # never behind, so neither of their go-ahead goals is a comeback.
        rows = goals("A", "B", "A", "B", "A")
        _tag_goal_roles(rows, match(3, 2))
        self.assertEqual(
            roles_of(rows),
            [["opener"], ["equaliser"], [], ["equaliser"], ["winner"]],
        )

    def test_an_own_goal_moves_the_score_but_is_not_the_scorers_credit(self):
        # P0 puts through their own net, so the goal is credited to B.
        rows = goals("B", minutes=[3], own={0})
        rows[0]["scorer_team_id"] = "A"
        _tag_goal_roles(rows, match(0, 1))
        self.assertEqual(roles_of(rows), [["opener", "winner"]])
        self.assertEqual(_goal_role_counts(rows), {})

    def test_an_untimed_match_is_left_untagged_rather_than_guessed(self):
        rows = goals("A", "B")
        rows[1]["minute"] = None
        _tag_goal_roles(rows, match(1, 1))
        self.assertEqual(roles_of(rows), [[], []])

    def test_an_unfinished_match_still_gets_the_roles_that_dont_need_a_result(self):
        rows = goals("A", "B")
        _tag_goal_roles(rows, match(None, None))
        self.assertEqual(roles_of(rows), [["opener"], ["equaliser"]])


class GoalRoleCountTests(unittest.TestCase):
    def test_counts_are_per_league_and_player_with_late_winners_split_out(self):
        rows = goals("A", "B", "B", minutes=[2, 5, 11])
        _tag_goal_roles(rows, match(1, 2))
        counts = _goal_role_counts(rows)
        self.assertEqual(counts[("L", "P0")]["opener"], 1)
        self.assertEqual(counts[("L", "P0")]["late_winner"], 0)
        self.assertEqual(counts[("L", "P2")], {
            "opener": 0, "equaliser": 0, "comeback": 1, "winner": 1, "late_winner": 1,
        })

    def test_a_winner_before_the_last_three_minutes_is_not_a_late_winner(self):
        rows = goals("A", minutes=[9])
        _tag_goal_roles(rows, match(1, 0))
        self.assertEqual(_goal_role_counts(rows)[("L", "P0")]["late_winner"], 0)


if __name__ == "__main__":
    unittest.main()
