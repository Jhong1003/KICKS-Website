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
