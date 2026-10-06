# KICKS Forecast Protocol — v2

**Status:** v2. FA26-L2 is a pilot league for this protocol, not a season meant to settle anything.
**Applies to:** FA26-L2 (league weeks on Saturdays, Oct 10 – Oct 31, 2026).
**Committed:** before the first FA26-L2 match. This file's git history is the record of what was decided and when.
**Replaces:** [v1](forecast-protocol-v1.md), between leagues as §2 allows — no FA26-L2 match had been
played. See §11 for what changed.

## 1. What this is

Before every league week, KICKS publishes win/draw/loss probabilities for each pairing of teams
(and, since v2, each team's chance of winning the league),
and after the week every match forecast is scored in public, the wrong ones included. The aim is to see
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

### 4.3 Title forecasts (every week)

Alongside the match forecasts, each week also publishes every team's chance of **winning the
league**, as of that week's deadline.

- **Week 1: `baseline`** — 1/3 per team. With no FA26-L2 result, the three teams are identical
  in every respect, so this is exact, not an approximation.
- **From week 2: `poisson-v1-title`** — every remaining FA26-L2 match is simulated with the
  Poisson v1 strengths of §4.2 (same μ, k and λ; one shared implementation in
  `src/lib/poisson-model.ts`), each side's goals drawn independently. The results are added to the
  real table through `data_through_week`, and the champion is decided by this league's rules in
  `src/data/league-config.json`: points (including final-week win points), then participation
  rate, goal difference and goals for.
  - **Participation** is frozen at each team's value in the official table through
    `data_through_week`. Future attendance is not modeled.
  - A tie on every criterion splits that run's title credit equally between the tied teams.
  - **100,000 runs** with a fixed, recorded seed, so anyone can reproduce the numbers exactly.
- A team's title forecast is its average title credit over the runs. The three add up to 1.

Title forecasts use the same deadline, publishing and integrity rules as match forecasts (§5–§7).
The League page's live Title Chances section uses the same model but is recalculated on every
visit; it is not the record. The record is the committed CSV.

## 5. Publishing

- **Deadline: Friday 23:59 America/Chicago**, the night before each Saturday league week.
  For example, week 1 (Sat Oct 10) is due Fri Oct 9, 23:59.
- A forecast counts as published when it is committed to this repository before the deadline.
  The commit time on `main` is the record. Sharing it anywhere else, such as the KICKS group chat
  or the website, is optional and is not part of the rule.
- Week 1 may be generated and committed by hand.
- No forecast may be generated after its deadline.

## 6. Stored fields

Match forecasts (`forecasts/forecasts.csv`), one row per (league, week, pairing, model):

`league`, `week`, `team_a`, `team_b`, `model` (`baseline` | `poisson-v1`), `p_a`, `p_draw`, `p_b`
(at full precision, not rounded), `data_through_week`, `generated_at` (UTC), `code_commit`,
`status`.

Title forecasts (`forecasts/title_forecasts.csv`), one row per (league, week, team, model):

`league`, `week`, `team`, `model` (`baseline` | `poisson-v1-title`), `p_title` (full precision),
`runs`, `seed` (blank for the exact week-1 baseline), `data_through_week`, `generated_at` (UTC),
`code_commit`, `status`.

Scores are never stored. They are recomputed from the forecasts and results every time.

## 7. Integrity rules

- Forecast rows are **append-only**. An existing row is never edited or deleted. A correction is
  a new row, and the scorecard shows it as a correction.
- At most one valid forecast per (league, week, pairing, model), and per (league, week, team,
  model) for title forecasts.
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

### 8.1 Title forecasts: recorded and described, not a headline score

A league has one title outcome, however many matches it has. Every weekly title forecast is judged
against that same single outcome, and those forecasts are strongly linked to each other, so a
league gives effectively one data point.

- After the league, the scorecard shows, for each week, the probability given to the eventual
  champion, as a line over the weeks, plus a multi-class Brier score per week against the actual
  outcome (a shared title counts as an equal split).
- These are **descriptive only**. No claim is made that the model beat or lost to the baseline on
  titles, and the scorecard says why: one outcome per league.
- Title results are never pooled with match-forecast scores.

## 9. After the league only

These are decided now but run only after FA26-L2 ends:

- Sensitivity to k = 3 / 6 / 12. This is reported only and does not change the published
  forecasts.
- Calibration of the draw probability. No direction is assumed in advance.

## 10. Not in v2

- Elo. It may come later as a pre-registered shadow model.
- Modeling future attendance (participation) in title forecasts.

## 11. Changes from v1

- **Added title forecasts (§4.3, §6, §8.1).** v1 left them out until the participation tie rule
  was defined; v2 defines it (participation frozen at the latest official value, full ties split).
- **Why:** to keep a dated, public record of how the title race looked each week, using the same
  model as the match forecasts so the two never disagree on team strength.
- **Unchanged:** the match-forecast models (§4.1, §4.2), deadlines, storage and scoring. The
  FA26-L2 week 1 match forecasts already published under v1 are identical under v2 and stay
  valid.
- **First league:** FA26-L2.
