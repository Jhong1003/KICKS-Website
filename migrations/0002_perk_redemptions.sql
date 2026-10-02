-- Member perk redemptions (see docs/member-perks.md).
-- One row per coupon screen a member opened at a partner restaurant.
CREATE TABLE IF NOT EXISTS perk_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  perk_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  redeemed_at TEXT NOT NULL,   -- ISO 8601 UTC, server time
  chicago_date TEXT NOT NULL   -- YYYY-MM-DD in America/Chicago
);

CREATE INDEX IF NOT EXISTS perk_redemptions_lookup
  ON perk_redemptions (player_id, perk_id, redeemed_at);
