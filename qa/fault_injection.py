"""Fault injection: how many realistic data-entry defects does the validator
(scripts/validate_data.py) actually catch?

Takes a known-good copy of the Google Sheet (an .xlsx export that passes
validation), seeds ONE defect at a time into it, runs the exact same rule
set the pipeline runs (validate_data.run_all_checks, strict mode), and
records whether the run would have been stopped. Every possible instance of
each defect type is tried (an exhaustive enumeration over the league's
rows, not a random sample), so a rate is "k of all n ways this mistake
could have been made in this data".

The defect types (MODES below) are modelled on real incidents in the
Sheet's issues tab where one exists (I001, I002, I004).

    python qa/fault_injection.py path/to/export.xlsx --league FA26-L1 \
        --out qa/results/after-2026-10-09.json

See qa/README.md for the results and what they mean.
"""

from __future__ import annotations

import argparse
import json
import sys
import warnings
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import update_data  # noqa: E402
import validate_data  # noqa: E402

warnings.filterwarnings("ignore")
TABS = ["matches", "player_stats", "players", "goal_events", "teams"]


def load_xlsx(path: str) -> dict[str, pd.DataFrame]:
    frames = pd.read_excel(path, sheet_name=TABS)
    return {name: frames[name] for name in TABS}


def is_caught(raw: dict[str, pd.DataFrame]) -> bool:
    sheets = update_data.prepare_sheets({name: df.copy() for name, df in raw.items()})
    try:
        errors, _ = validate_data.run_all_checks(sheets, strict=True)
    except Exception:  # a crash also stops the workflow before anything is published
        return True
    return bool(errors)


class Injector:
    """Generates every instance of each defect type against one league."""

    def __init__(self, raw: dict[str, pd.DataFrame], league: str):
        self.raw = raw
        self.m = raw["matches"][raw["matches"]["league"] == league]
        self.ps = raw["player_stats"][raw["player_stats"]["league"] == league]

    def _with(self, tab, change):
        copy = {name: df.copy() for name, df in self.raw.items()}
        copy[tab] = change(copy[tab])
        return copy

    def _set(self, tab, i, col, value):
        def change(df):
            df.at[i, col] = value
            return df
        return self._with(tab, change)

    def _move(self, src, dst, col):
        def change(df):
            df.at[src, col] -= 1
            df.at[dst, col] += 1
            return df
        return self._with("player_stats", change)

    def score_typo(self):
        for i, r in self.m.iterrows():
            for col in ("home_score", "away_score"):
                for d in (1, -1):
                    if r[col] + d >= 0:
                        yield f"{r.match_id} {col}{d:+d}", self._set("matches", i, col, r[col] + d)

    def score_swap(self):
        for i, r in self.m.iterrows():
            if r.home_score != r.away_score:
                def change(df, i=i, r=r):
                    df.loc[i, ["home_score", "away_score"]] = [r.away_score, r.home_score]
                    return df
                yield f"{r.match_id} swapped", self._with("matches", change)

    def match_row_missing(self):
        for i, r in self.m.iterrows():
            yield f"{r.match_id} deleted", self._with("matches", lambda df, i=i: df.drop(i))

    def team_name_typo(self):
        for i, r in self.ps.iterrows():
            yield f"row {i} team '{r.team} '", self._set("player_stats", i, "team", f"{r.team} ")

    def player_name_typo(self):
        for i, r in self.ps.iterrows():
            yield f"row {i} name '{r.player[:-1]}'", self._set("player_stats", i, "player", r.player[:-1])

    def stat_to_teammate(self, col):
        for i, r in self.ps[self.ps[col] > 0].iterrows():
            mates = self.ps[(self.ps.week == r.week) & (self.ps.team == r.team) & (self.ps.index != i)]
            for j in mates.index:
                yield f"{col} row {i} -> teammate row {j}", self._move(i, j, col)

    def stat_to_opponent(self, col):
        for i, r in self.ps[self.ps[col] > 0].iterrows():
            for j in self.ps[(self.ps.week == r.week) & (self.ps.team != r.team)].index:
                yield f"{col} row {i} -> opponent row {j}", self._move(i, j, col)

    def goal_wrong_week(self):
        for i, r in self.ps[self.ps.goals > 0].iterrows():
            for j in self.ps[(self.ps.player == r.player) & (self.ps.week != r.week)].index:
                yield f"goal row {i} -> same player row {j}", self._move(i, j, "goals")

    def count_typo(self, col):
        for i, r in self.ps.iterrows():
            for d in (1, -1):
                if r[col] + d >= 0:
                    yield f"row {i} {col}{d:+d}", self._set("player_stats", i, col, r[col] + d)

    def own_goal_as_goal(self):
        for i, r in self.ps[self.ps.own_goals > 0].iterrows():
            def change(df, i=i):
                df.at[i, "own_goals"] -= 1
                df.at[i, "goals"] += 1
                return df
            yield f"row {i} own goal typed as goal", self._with("player_stats", change)

    def row_missing(self, with_goals):
        scored = self.ps.goals + self.ps.own_goals > 0
        for i in self.ps[scored if with_goals else ~scored].index:
            yield f"row {i} deleted", self._with("player_stats", lambda df, i=i: df.drop(i))

    def attendance_flip(self):
        for i, r in self.ps.iterrows():
            new = 0 if r.games > 0 else 6
            yield f"row {i} games {r.games:g}->{new}", self._set("player_stats", i, "games", new)

    def wrong_team(self):
        for i, r in self.ps.iterrows():
            for team in sorted(set(self.ps.team) - {r.team}):
                yield f"row {i} team -> {team}", self._set("player_stats", i, "team", team)

    def duplicate_row(self):
        for i in self.ps.index:
            yield f"row {i} duplicated", self._with(
                "player_stats", lambda df, i=i: pd.concat([df, df.loc[[i]]], ignore_index=True)
            )

    def wrong_week(self):
        for i, r in self.ps.iterrows():
            for week in sorted(set(self.ps.week) - {r.week}):
                yield f"row {i} week {r.week}->{week}", self._set("player_stats", i, "week", week)


MODES = [
    ("M01", "경기 점수 오타 (±1)", lambda x: x.score_typo()),
    ("M02", "홈/원정 점수 뒤바뀜", lambda x: x.score_swap()),
    ("M03", "경기 행 누락", lambda x: x.match_row_missing()),
    ("M04", "팀 이름 오타 (공백)", lambda x: x.team_name_typo()),
    ("M05", "선수 이름 오타", lambda x: x.player_name_typo()),
    ("M06", "골을 같은 팀 다른 선수에게 기록", lambda x: x.stat_to_teammate("goals")),
    ("M07", "골을 상대 팀 선수에게 기록", lambda x: x.stat_to_opponent("goals")),
    ("M08", "골을 다른 주차에 기록 (I001 유형)", lambda x: x.goal_wrong_week()),
    ("M09", "선수 골 수 오타 (±1)", lambda x: x.count_typo("goals")),
    ("M10", "어시스트를 같은 팀 다른 선수에게 기록", lambda x: x.stat_to_teammate("assists")),
    ("M11", "어시스트 수 오타 (±1)", lambda x: x.count_typo("assists")),
    ("M12", "자책골을 일반 골로 기록", lambda x: x.own_goal_as_goal()),
    ("M13", "골 없는 선수 행 누락 (I002 유형)", lambda x: x.row_missing(False)),
    ("M14", "골 있는 선수 행 누락", lambda x: x.row_missing(True)),
    ("M15", "출석 오입력 6↔0 (I004 유형)", lambda x: x.attendance_flip()),
    ("M16", "선수를 다른 팀으로 기록", lambda x: x.wrong_team()),
    ("M17", "선수 행 중복 입력", lambda x: x.duplicate_row()),
    ("M18", "선수 행 주차 잘못 입력", lambda x: x.wrong_week()),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("xlsx", help="known-good .xlsx export of the Sheet")
    parser.add_argument("--league", default="FA26-L1")
    parser.add_argument("--out", help="write per-mode results (JSON) here")
    args = parser.parse_args()

    raw = load_xlsx(args.xlsx)
    errors, _ = validate_data.run_all_checks(update_data.prepare_sheets({k: v.copy() for k, v in raw.items()}), True)
    if errors:
        sys.exit("The base data must pass validation first:\n  " + "\n  ".join(errors))

    injector = Injector(raw, args.league)
    results = []
    for code, name, generate in MODES:
        n = caught = 0
        missed = []
        for description, mutated in generate(injector):
            n += 1
            if is_caught(mutated):
                caught += 1
            else:
                missed.append(description)
        results.append({"code": code, "mode": name, "n": n, "detected": caught, "missed": missed})
        print(f"{code} {name}: {caught}/{n}", flush=True)

    if args.out:
        Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
