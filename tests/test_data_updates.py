import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from data_updates import FILES, update_metadata


class DataUpdatesTests(unittest.TestCase):
    def test_noop_and_per_league_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            for name in FILES:
                rows = ([{"id": "A", "latest": False}, {"id": "B", "latest": True}]
                        if name == "leagues.json" else [] if name == "player_profiles.json" else
                        [{"league": "A", "value": 1}, {"league": "B", "value": 1}])
                (folder / name).write_text(json.dumps(rows))
            first = update_metadata(folder, "2026-01-01T00:00:00Z")
            self.assertEqual(first, update_metadata(folder, "2026-01-02T00:00:00Z"))
            rows = json.loads((folder / "matches.json").read_text())
            rows[1]["value"] = 2
            (folder / "matches.json").write_text(json.dumps(rows))
            changed = update_metadata(folder, "2026-01-03T00:00:00Z")
            self.assertEqual(changed["A"], first["A"])
            self.assertEqual(changed["B"]["updated_at"], "2026-01-03T00:00:00Z")
