-- Free kick challenge. Same model as the keeper game: nicknames are public and
-- not verified identities; a browser token keeps one personal best.
CREATE TABLE IF NOT EXISTS freekick_runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  seed INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0, 1))
);
CREATE INDEX IF NOT EXISTS freekick_runs_player ON freekick_runs(player_id, started_at);
CREATE TABLE IF NOT EXISTS freekick_scores (
  player_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  goals INTEGER NOT NULL,
  best_kick INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS freekick_scores_rank ON freekick_scores(score DESC, goals DESC, updated_at ASC);
