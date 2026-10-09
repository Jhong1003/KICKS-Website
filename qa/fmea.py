"""Data-driven FMEA for the Sheet -> site pipeline.

Severity (S) is the club's judgement, given once per *effect* by the person
who runs the league. Occurrence (O) and detection (D) are not judgement
calls here: D comes from the fault-injection results and O from the
defects that actually reached the site (published_history.py). RPN = S*O*D.

    python qa/fmea.py   # writes qa/results/fmea.csv and prints the table
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
DETECTION_RESULTS = HERE / "results" / "2026-10-09-after.json"

# Severity per effect, rated by the league organiser on 2026-10-09
# ("매우 심각" = 9, "꽤 심각" = 5, "가벼움" = 2).
SEVERITY = {
    "standings": 9,     # match scores wrong: table / champion can change
    "individual": 9,    # goals/assists on the wrong player: records, Golden Boot, badges
    "attendance": 2,    # participation rate only (a points-tie tiebreaker)
}

# What each defect type can change. S = the worst effect it can have.
EFFECTS = {
    "M01": ["standings"], "M02": ["standings"], "M03": ["standings"],
    "M04": ["attendance"], "M05": ["individual"],
    "M06": ["individual"], "M07": ["individual"], "M08": ["individual"], "M09": ["individual"],
    "M10": ["individual"], "M11": ["individual"], "M12": ["individual"],
    "M13": ["attendance"], "M14": ["individual", "attendance"], "M15": ["attendance"],
    "M16": ["attendance"], "M17": ["individual", "attendance"], "M18": ["individual", "attendance"],
}

# Escaped defects of each type found in FA26-L1's published history
# (qa/results/published-history.json): I001 -> M08; I002 and the unlogged
# week-3 row -> M13; I004 -> M15.
ESCAPED = {"M08": 1, "M13": 2, "M15": 1}


def occurrence(count: int) -> int:
    """Seen 0 times in one league: possible, not observed. 1: has happened.
    2+: recurring. Coarse on purpose: one league is 113 player-week rows."""
    return 2 if count == 0 else 5 if count == 1 else 7


def detection(rate: float) -> int:
    """Measured share of seeded defects the validator stops (higher D = more
    likely to reach the site)."""
    if rate >= 0.99:
        return 1
    if rate >= 0.90:
        return 3
    if rate >= 0.50:
        return 5
    if rate >= 0.20:
        return 7
    return 9


def main() -> None:
    rows = []
    for r in json.loads(DETECTION_RESULTS.read_text(encoding="utf-8")):
        code = r["code"]
        rate = r["detected"] / r["n"]
        s = max(SEVERITY[e] for e in EFFECTS[code])
        o = occurrence(ESCAPED.get(code, 0))
        d = detection(rate)
        rows.append(dict(code=code, mode=r["mode"], effects="+".join(EFFECTS[code]), S=s,
                         escaped_in_L1=ESCAPED.get(code, 0), O=o,
                         detection_rate=f"{rate:.0%}", D=d, RPN=s * o * d))
    rows.sort(key=lambda row: -row["RPN"])
    out = HERE / "results" / "fmea.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    for row in rows:
        print(f"{row['RPN']:>4}  S{row['S']} O{row['O']} D{row['D']}  {row['code']} {row['mode']} ({row['detection_rate']})")


if __name__ == "__main__":
    main()
