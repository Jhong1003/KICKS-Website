-- Emoji reactions under each match result (see functions/api/reactions.js).
-- Aggregate counts only: no visitor identifiers, IP addresses or timestamps.
CREATE TABLE IF NOT EXISTS match_reactions (
  match_id TEXT NOT NULL,          -- e.g. FA26-L2-W04-M01
  reaction TEXT NOT NULL,          -- fire | laugh | cry | clap
  count INTEGER NOT NULL CHECK (count >= 0),
  PRIMARY KEY (match_id, reaction)
);
