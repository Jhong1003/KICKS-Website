-- Staff player ratings for team balancing (/rate). Link-only and private:
-- a session is created and read only with the staff key (PERKS_ADMIN_KEY);
-- raters open it by its random id. Rows are deleted with their session.
CREATE TABLE IF NOT EXISTS rating_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  players TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rating_results (
  session_id TEXT NOT NULL,
  rater_token TEXT NOT NULL,
  rater TEXT NOT NULL,
  scores TEXT NOT NULL,
  comparisons TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, rater_token)
);
