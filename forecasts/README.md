# Forecasts

Published forecasts under [docs/forecast-protocol-v2.md](../docs/forecast-protocol-v2.md)
(v2 replaced [v1](../docs/forecast-protocol-v1.md) before FA26-L2 started; the match-forecast rules
are the same).

`forecasts.csv` has one row per (league, week, pairing, model), with the fields from §6 of the
protocol. A row counts as published when its commit lands on `main` before that week's deadline
(Friday 23:59 America/Chicago).

**Append-only.** Never edit or delete an existing row. A correction is a new row (§7).

| Field | Meaning |
|---|---|
| `team_a`, `team_b` | `team_id`s of the pairing, smaller id first |
| `p_a`, `p_draw`, `p_b` | probabilities for one match of that pairing, full precision |
| `data_through_week` | last league week whose results the model used (0 = none) |
| `generated_at` | UTC time the row was made |
| `code_commit` | `main` commit the row was generated from |
| `status` | `published` for a normal on-time forecast |

FA26-L2 week 1 is the baseline only (§4.1): d = FA26-L1 draw rate = 8/36, each win (1 − d)/2.
It was written by hand, as §5 allows.

## Title forecasts

`title_forecasts.csv` has one row per (league, week, team, model): `p_title` is that team's
chance of winning the league as of the week's deadline (§4.3), plus `runs` and `seed` for the
simulation (blank for the exact week-1 baseline). Same append-only rule. Title forecasts are
recorded and described after the league, not used as a headline score (§8.1).

FA26-L2 week 1 is the baseline: 1/3 per team.

## Making a week's forecasts

From week 2 the rows are made by `scripts/make_forecasts.mjs` (see AGENTS.md "Weekly
forecasts"), normally automatically by the **Publish Forecasts** workflow on Thursday and Friday
evenings. By hand:

```sh
node scripts/make_forecasts.mjs --league FA26-L2 --week 2 --dry-run   # look first
node scripts/make_forecasts.mjs --league FA26-L2 --week 2             # append
git add forecasts && git commit -m "Publish FA26-L2 week 2 forecasts" && git push
```

## Scoring

`scripts/score_forecasts.mjs` scores a league's forecasts against the results (protocol §8):
RPS per match (primary), Brier and log loss, averaged per week, and Poisson v1 − baseline on the
same matches. Title forecasts are described only once the league is finished (§8.1). Scores are
recomputed every run, never stored in the CSVs (§6).

It also replays the git history of `forecasts.csv` to check the file was only ever appended to,
and that each week's rows were committed before that week's deadline. Late or invalid rows are
listed and left out of the scores. Unplayed matches are counted as pending, never filled in.

```sh
node scripts/score_forecasts.mjs --league FA26-L2                       # print the scorecard
node scripts/score_forecasts.mjs --league FA26-L2 --markdown forecasts/scorecard-FA26-L2.md
node --test tests/score-forecasts.test.mjs
```

The history check needs a full clone (`git fetch --unshallow` on a shallow one).
