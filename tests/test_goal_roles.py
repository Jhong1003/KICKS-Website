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
from update_data import GOAL_ROLES, _goal_role_counts, _tag_goal_roles  # noqa: E402

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

    def test_a_draw_has_an_opener_and_an_equalizer_but_no_winner(self):
        rows = goals("A", "B")
        _tag_goal_roles(rows, match(1, 1))
        self.assertEqual(roles_of(rows), [["opener"], ["equalizer"]])

    def test_going_ahead_from_level_is_not_a_comeback(self):
        # 1-1 then A again: A led throughout or was level, never behind.
        rows = goals("A", "B", "A")
        _tag_goal_roles(rows, match(2, 1))
        self.assertEqual(roles_of(rows), [["opener"], ["equalizer"], ["winner"]])

    def test_comeback_needs_the_team_to_have_trailed(self):
        # 0-1, 1-1, 2-1 to B... from A's point of view: A scores, B levels,
        # B goes ahead having been behind - that third goal is the comeback.
        rows = goals("A", "B", "B")
        _tag_goal_roles(rows, match(1, 2))
        self.assertEqual(roles_of(rows), [["opener"], ["equalizer"], ["comeback", "winner"]])

    def test_the_winner_is_counted_from_the_losers_final_score(self):
        # 3-2, A leading or level all the way: B finish on 2, so it's A's
        # *third* goal they were never caught after, not their first. A was
        # never behind, so neither of their go-ahead goals is a comeback.
        rows = goals("A", "B", "A", "B", "A")
        _tag_goal_roles(rows, match(3, 2))
        self.assertEqual(
            roles_of(rows),
            [["opener"], ["equalizer"], [], ["equalizer"], ["winner"]],
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
        self.assertEqual(roles_of(rows), [["opener"], ["equalizer"]])


class GoalRoleCountTests(unittest.TestCase):
    def test_counts_are_per_league_and_player_with_late_winners_split_out(self):
        rows = goals("A", "B", "B", minutes=[2, 5, 11])
        _tag_goal_roles(rows, match(1, 2))
        counts = _goal_role_counts(rows)
        self.assertEqual(counts[("L", "P0")]["opener"], 1)
        self.assertEqual(counts[("L", "P0")]["late_winner"], 0)
        p2 = counts[("L", "P2")]
        self.assertEqual(p2["comeback"], 1)
        self.assertEqual(p2["winner"], 1)
        self.assertEqual(p2["late_winner"], 1)

    def test_one_goal_two_roles_counts_once_for_the_profile(self):
        # A 1-0 match's only goal is both the opener and the winner. Counting
        # every role makes a two-goal player read as three; the primary_ keys
        # are the ones a profile shows, and they count the goal once.
        rows = goals("A")
        _tag_goal_roles(rows, match(1, 0))
        tally = _goal_role_counts(rows)[("L", "P0")]
        self.assertEqual((tally["opener"], tally["winner"]), (1, 1))
        primary = {role: tally[f"primary_{role}"] for role in GOAL_ROLES}
        self.assertEqual(sum(primary.values()), 1)
        self.assertEqual(primary["winner"], 1)
        self.assertEqual(primary["opener"], 0)

    def test_primary_counts_never_exceed_the_goals_scored(self):
        # 홍지환's real week 1: a 1-0 winner that was also the opener, then an
        # equalizer. Two goals, so the profile must not show three.
        first = goals("A", minutes=[4])
        _tag_goal_roles(first, match(1, 0))
        second = goals("A", "B", minutes=[7, 11])
        _tag_goal_roles(second, match(1, 1))
        second[1]["scorer_id"] = "P0"  # the same player got the equalizer
        tally = _goal_role_counts(first + [second[1]])[("L", "P0")]
        primary = {role: tally[f"primary_{role}"] for role in GOAL_ROLES}
        self.assertEqual(sum(primary.values()), 2)
        self.assertEqual(primary, {"opener": 0, "equalizer": 1, "comeback": 0, "winner": 1})

    def test_a_winner_before_the_last_three_minutes_is_not_a_late_winner(self):
        rows = goals("A", minutes=[9])
        _tag_goal_roles(rows, match(1, 0))
        self.assertEqual(_goal_role_counts(rows)[("L", "P0")]["late_winner"], 0)


if __name__ == "__main__":
    unittest.main()
