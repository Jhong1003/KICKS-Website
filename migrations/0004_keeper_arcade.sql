-- Nicknames are public and not verified identities. Browser tokens identify personal bests.
CREATE TABLE IF NOT EXISTS keeper_runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  seed INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0, 1))
);
CREATE INDEX IF NOT EXISTS keeper_runs_player ON keeper_runs(player_id, started_at);
CREATE TABLE IF NOT EXISTS keeper_scores (
  player_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  saves INTEGER NOT NULL,
  perfect INTEGER NOT NULL,
  best_combo INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS keeper_scores_rank ON keeper_scores(score DESC, perfect DESC, updated_at ASC);
