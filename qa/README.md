# Measuring the inspection: fault injection on the KICKS data validator

Every result on kicksuiuc.com starts as a row typed into a Google Sheet.
Before anything is published, `scripts/validate_data.py` inspects the
Sheet and stops the pipeline if a rule fails. This folder answers the
question every inspection step should have to answer:

> **Of the mistakes that can realistically be made, what fraction does the
> inspection actually catch, and which ones go straight to the site?**

Inspection is usually assumed to work. Here it is measured.

## Method

1. **Known-good unit.** An export of the real Sheet that passes validation
   (FA26-L1, four finished weeks: 36 matches, 113 player-week rows).
2. **Defect catalog.** 18 defect types a person entering data could make
   (below). Where the Sheet's `issues` tab has a real incident, the type is
   modelled on it: I001 (goal booked in the wrong week), I002 (a player's
   whole week missing), I004 (attendance typed as present instead of absent).
3. **Seed one defect at a time, every way it can occur.** For each type, every
   instance possible in this data is generated (exhaustive, not sampled):
   every score ±1, every goal moved to every teammate, every row deleted,
   and so on. 2,954 defective copies in total.
4. **Inspect with the production rules.** Each copy runs through
   `validate_data.run_all_checks` in strict mode — the same function the
   GitHub Actions workflow calls, so nothing here is a reimplementation.
5. **Detection rate** = copies that would have stopped the pipeline / copies
   generated.

```sh
python qa/fault_injection.py <sheet-export.xlsx> --league FA26-L1 --out qa/results/<name>.json
```

## Results (2026-10-09, before FA26-L2 began)

Same 2,954 defects, scored against the validator before and after the
rule changes this study led to.

| | Defect type | n | Before | After |
|---|---|---:|---:|---:|
| M01 | Match score typo (±1) | 121 | 100% | 100% |
| M02 | Home/away scores swapped | 28 | 93% | 93% |
| M03 | Match row missing | 36 | 100% | 100% |
| M04 | Team name typo (trailing space) | 113 | 100% | 100% |
| M05 | Player name typo | 113 | 100% | 100% |
| M06 | Goal credited to a teammate | 292 | **0%** | 13% |
| M07 | Goal credited to an opponent | 658 | 96% | 97% |
| M08 | Goal booked in the wrong week (I001) | 97 | 100% | 100% |
| M09 | Player goal count typo (±1) | 148 | 100% | 100% |
| M10 | Assist credited to a teammate | 294 | **0%** | 13% |
| M11 | Assist count typo (±1) | 148 | **0%** | 31% |
| M12 | Own goal typed as a goal | 2 | 100% | 100% |
| M13 | Row missing, player without goals (I002) | 76 | 86% | 92% |
| M14 | Row missing, player with goals | 37 | 100% | 100% |
| M15 | Attendance flipped 6↔0 (I004) | 113 | **0%** | 49% |
| M16 | Row typed under the wrong team | 226 | 31% | **98%** |
| M17 | Row duplicated | 113 | 33% | **100%** |
| M18 | Row typed under the wrong week | 339 | 91% | 99% |

Raw per-defect results: [`results/2026-10-09-before.json`](results/2026-10-09-before.json),
[`results/2026-10-09-after.json`](results/2026-10-09-after.json) (the
latter also lists every defect that still passes).

No overall percentage is reported on purpose: the mix of defect types is
set by how many ways each can occur in this data, not by how often people
actually make them, so a pooled rate would mostly measure the catalog.

## Key finding: a corrective action that had silently stopped working

I002 (a goalkeeper's entire week 3 row missing, found by a person, not by
validation) was closed on 2026-09-23 by adding a missing-row check. Seeding
**that exact defect** again on 2026-10-09 passed validation.

The check only looked at `active` players. Three players, including the
I002 goalkeeper, had since been marked `inactive` (none of them is playing
in FA26-L2) — and that switched off protection for their *past* weeks as
well. Nothing failed and nothing warned; the fix was
simply no longer there. 10 of the 11 undetected row deletions in M13 were
this.

Correction: non-active players are now checked from when they joined to
their last recorded week, and `tests/test_validate.py` pins the I002 case so
a future edit cannot quietly undo it again. The general lesson is that a
corrective action needs a regression test of the original defect, not just
the original fix.

## Rules added

| Rule | Closes |
|---|---|
| Non-active players checked joined → last recorded week | M13 (the I002 regression) |
| One row per (league, week, player) | M17 |
| `games` 0 with goals/assists/own goals is an error | part of M15, M06, M10 |
| Team assists ≤ team goals, per week | part of M11 |
| Mid-league team changes must be in `src/data/transfers.json` | M16, part of M18 |

Every new rule was run against the full real Sheet (FA26-L1 plus the empty
FA26-L2 week 1) before merging: zero errors, so no false alarm on game
night. Building the transfer rule surfaced one real but unrecorded move
(a player who switched teams for week 4); it was confirmed with the club
and added to `transfers.json` rather than treated as an error.

## What this validator can never catch

Some defects leave every number internally consistent. Moving a goal
between two teammates who both played, or flipping attendance for a
player with no goals, changes no total anywhere. M06, M10 and most of M15
stay low **by design**: no rule based on the Sheet alone can detect them,
only a comparison with an independent source (the match video). They are
controlled at entry instead, and this study is what identified them as the
defect types needing that control.

The remaining M13 misses are a player's *last* recorded week: without a
recorded leaving date, a deleted final row looks the same as leaving.

## Real escaped defects: what actually reached the site

Fault injection says what the validator *could* catch. Git history says
what actually got through. Every data commit is a snapshot of what
kicksuiuc.com showed (Cloudflare redeploys on each push), so
[`published_history.py`](published_history.py) replays all of them,
normalises the schema changes along the way (team names → ids, one season
→ leagues), and lists every change to a week that was already finished
when it went public.

```sh
python qa/published_history.py --out qa/results/published-history.json
```

FA26-L1 had **4 escaped defects**, all in `player_stats`, none in match
scores:

| Defect | On the site for | Logged in issues tab | Today's validator |
|---|---:|---|---|
| Week 3 row missing (new member) | 1.2 days | **no** | caught (missing-row check) |
| Week 2 own goal published as a week 1 goal (I001) | 1.9 days† | I001 | caught (weekly goal sums) |
| Week 3 row missing (goalkeeper) (I002) | 1.2 days | I002 | caught (missing-row check, incl. after the player went inactive) |
| Week 2 attendance 0 published as 6 (I004) | 3.7 days | I004 | **passes** (M15: no internal check can see it) |

† Counted from when player pages first existed; the inflated total was in
the leaderboard earlier.

- **All four were found by a person, not by validation.** Validation at
  the time checked weekly goal totals only.
- **3 of 4 would now be stopped before publishing.** The fourth is exactly
  the class fault injection predicted no rule can catch, which is the
  independent confirmation that the defect catalog and the measured gaps
  reflect reality, not just the catalog's design.
- **The issues tab captured 3 of 4.** The unlogged one was fixed by hand
  in the Sheet and never recorded. A defect log that misses a quarter of
  defects would understate the defect rate by the same quarter, so the
  published history is the more complete source.
- 4 of the 113 player-week rows (3.5%) were wrong when first published;
  0 of 36 match rows. Weekly totals per player, typed by hand, are where
  the risk is, which is what per-goal recording (`goal_events`, from
  FA26-L2) is meant to address.

## Data-driven FMEA: what to protect next

An FMEA ranks failure modes by RPN = Severity × Occurrence × Detection.
Usually all three are scored by gut feel in a meeting. Here only severity
is a judgement, made once per *effect* by the league organiser; the other
two come from the measurements above ([`fmea.py`](fmea.py) →
[`results/fmea.csv`](results/fmea.csv)).

- **S** (organiser, 2026-10-09): wrong match scores (standings, champion)
  = 9; goals/assists on the wrong player (records, Golden Boot, badges) = 9;
  attendance only (participation rate, a points-tie tiebreaker) = 2.
- **O**: escaped defects of that type in FA26-L1 (0 → 2, 1 → 5, 2+ → 7).
- **D**: measured detection after the new rules (≥99% → 1, ≥90% → 3,
  ≥50% → 5, ≥20% → 7, below → 9).

| RPN | S·O·D | Failure mode | Detected |
|---:|---|---|---:|
| 162 | 9·2·9 | Goal credited to a teammate | 13% |
| 162 | 9·2·9 | Assist credited to a teammate | 13% |
| 126 | 9·2·7 | Assist count typo | 31% |
| 70 | 2·5·7 | Attendance flipped (I004) | 49% |
| 54 | 9·2·3 | Home/away scores swapped | 93% |
| 54 | 9·2·3 | Goal credited to an opponent | 97% |
| 45 | 9·5·1 | Goal booked in the wrong week (I001) | 100% |
| 42 | 2·7·3 | Row missing, no goals (I002) | 92% |
| ≤18 | | the other ten modes | ≥98% |

**Reading it.** The defects that actually happened (I001, I002, I004) are
now either well detected or low severity. The top of the list is something
the history never showed: goals and assists credited to the wrong teammate.
That is not reassurance. These are the modes no Sheet rule can see, so if
one had happened, nothing in the published history would show it either —
"never observed" is exactly what an undetectable defect looks like. O = 2
for them is a floor, not an estimate.

**Next control.** Since no rule can catch them, the only inspector is the
person whose record it is. The weekly results post already shows every
player's goals and assists; making it an explicit check ("tell us if your
record is wrong") and logging each report in the issues tab with
`how_found` = member report turns the players into the detection step for
the top three modes, and makes that step measurable next league.

## Limits

- One league of data. Rates describe this dataset's structure; a different
  roster or scoring pattern would shift them somewhat.
- One defect at a time. Two defects can cancel out (e.g. the two missed
  score swaps in M02 sit inside the own-goal allowance for that week).
- M12 has only two instances, since FA26-L1 had two own goals.
- `goal_events` (per-goal records, used from FA26-L2) is not covered yet:
  the tab was empty at the time. Planned once L2 has a few weeks of data.
