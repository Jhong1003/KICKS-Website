# Forecasts

Published match forecasts under [docs/forecast-protocol-v1.md](../docs/forecast-protocol-v1.md).

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
