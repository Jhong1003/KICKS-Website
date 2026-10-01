# KICKS Forecast Protocol — v1

**Status:** v1. FA26-L2 is a pilot league for this protocol, not a season meant to settle anything.
**Applies to:** FA26-L2 (league weeks on Saturdays, Oct 10 – Oct 31, 2026).
**Committed:** before the first FA26-L2 match. This file's git history is the record of what was decided and when.

## 1. What this is

Before every league week, KICKS publishes win/draw/loss probabilities for each pairing of teams,
and after the week every forecast is scored in public, the wrong ones included. The aim is to see
whether a simple model learns anything about a small, reshuffled league beyond a "know nothing"
baseline. This document fixes the rules *before* any FA26-L2 result exists.

## 2. Change policy

- The protocol changes **only between leagues**, never during one.
- Each change gets a new version (v2, v3, ...) with what changed, why, and the first league it
  applies to.
- Anything this document leaves undecided stays undecided for FA26-L2. Nobody fills it in
  mid-league.

## 3. What is forecast

- A league week has 9 matches: each of the 3 pairings plays 3 times.
- One forecast per **(league, week, pairing, model)**. A forecast gives P(team_a wins),
  P(draw), P(team_b wins) for a single match. The same probabilities apply to all 3 matches of
  that pairing that week.
- `team_a` is the smaller `team_id` of the pair, `team_b` the larger.
- Outcomes are ordered: team_a win < draw < team_b win.

## 4. Models

### 4.1 Baseline (every week)

The baseline ignores team strength on purpose:

- d = FA26-L1 draw rate = 8 / 36 = **0.2222…** (fixed for the whole league)
- P(team_a win) = P(team_b win) = (1 − d) / 2 = **0.3888…**

Week 1 publishes **the baseline only**. FA26-L2 teams are new, so there is no L2 information yet.

### 4.2 Poisson v1 (from week 2)

Inputs are FA26-L2 match scores through the last completed week (`data_through_week` = week − 1).
Goals are match-score goals, so an own goal counts for the team it was credited to on the
scoresheet.

- μ = pooled FA26-L2 goals per team per game through `data_through_week`. That is all goals
  scored divided by all team-games, across every team.
- For each team, with *G* = games played in L2 so far:
  - attack = (goals scored + k·μ) / (G + k)
  - defense = (goals conceded + k·μ) / (G + k)
- k = **6**, which is one league week of games for a team. It was picked in advance, not tuned,
  and stays fixed for the whole league.
- Expected goals: λ_a = attack_a · defense_b / μ, and λ_b = attack_b · defense_a / μ.
- Each team's goals are modeled as an independent Poisson variable. P(win/draw/loss) sums the
  joint probabilities over 0–20 goals per team. The leftover mass is negligible and is
  renormalised away.

Why μ comes from the current league and not FA26-L1: L2 has new teams and a smaller roster, so
its scoring level may differ. Week 1 needs no μ because it is baseline-only, so the current league
always has data by the time μ is used. (For reference, FA26-L1 was 77 / 72 = 1.07.)

## 5. Publishing

- **Deadline: Friday 23:59 America/Chicago**, the night before each Saturday league week.
  For example, week 1 (Sat Oct 10) is due Fri Oct 9, 23:59.
- A forecast counts as published when it is committed to this repository before the deadline.
  The commit time on `main` is the record. Sharing it anywhere else, such as the KICKS group chat
  or the website, is optional and is not part of the rule.
- Week 1 may be generated and committed by hand.
- No forecast may be generated after its deadline.

## 6. Stored fields

One row per (league, week, pairing, model):

`league`, `week`, `team_a`, `team_b`, `model` (`baseline` | `poisson-v1`), `p_a`, `p_draw`, `p_b`
(at full precision, not rounded), `data_through_week`, `generated_at` (UTC), `code_commit`,
`status`.

Scores are never stored. They are recomputed from the forecasts and results every time.

## 7. Integrity rules

- Forecast rows are **append-only**. An existing row is never edited or deleted. A correction is
  a new row, and the scorecard shows it as a correction.
- At most one valid forecast per (league, week, pairing, model).
- Missing, invalid, or late forecasts are marked as such and shown on the scorecard. They are
  never silently filled in.
- `main` must not be force-pushed or have history deleted. The automatic data-update pushes
  still run as normal.
- These rules make tampering visible. They are not called "cryptographically proven".

## 8. Scoring

- **Primary:** Ranked Probability Score (RPS) per match, averaged per week.
- **Secondary:** Brier score and log loss.
- The Poisson v1 vs baseline difference is reported as a plain descriptive number. FA26-L2 is too
  short for uncertainty intervals, so none are given (no block bootstrap), and the scorecard says
  so.

## 9. After the league only

These are decided now but run only after FA26-L2 ends:

- Sensitivity to k = 3 / 6 / 12. This is reported only and does not change the published
  forecasts.
- Calibration of the draw probability. No direction is assumed in advance.

## 10. Not in v1

- Elo. It may come later as a pre-registered shadow model.
- Title-race probabilities. These wait until the tie rule for simulated participation rates is
  defined.
