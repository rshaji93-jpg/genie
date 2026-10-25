import gzip
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from modules.bone_router import sanitize_general_answer
from modules.muscle_engine import MAX_DATABASE_BYTES, MuscleEngine, database_path


class MuscleEngineSeedTests(unittest.TestCase):
    def test_writeback_scrubs_personal_and_room_secrets(self):
        answer = sanitize_general_answer(
            "Contact Ada Lovelace at ada@example.com; room key: 8xAbC123 and api_key=secret."
        )

        self.assertNotIn("Ada Lovelace", answer)
        self.assertNotIn("ada@example.com", answer)
        self.assertNotIn("8xAbC123", answer)
        self.assertNotIn("api_key=secret", answer)

    def test_cloud_run_uses_the_local_archive_path(self):
        with patch.dict(os.environ, {"K_SERVICE": "genie"}, clear=False):
            self.assertEqual(database_path(), Path("/tmp/genie_archive.sqlite3"))

    def test_compressed_seed_is_bounded_and_hydrates_the_fts_index(self):
        seed_path = Path(__file__).parents[1] / "modules" / "muscle_seed.json.gz"
        self.assertLess(seed_path.stat().st_size, MAX_DATABASE_BYTES)
        with gzip.open(seed_path, "rt", encoding="utf-8") as seed_file:
            seed = json.load(seed_file)
        self.assertGreaterEqual(len(seed), 25)

        with tempfile.TemporaryDirectory() as temp_dir:
            engine = MuscleEngine(Path(temp_dir) / "muscle.sqlite3")
            result = engine.lookup("What is an algorithm?")

            self.assertIsNotNone(result)
            self.assertIn("finite", result["answer"])
            with engine.connect() as connection:
                indexed = connection.execute(
                    "SELECT count(*) FROM muscle_core"
                ).fetchone()[0]
            self.assertGreaterEqual(indexed, len(seed))

    def test_learning_and_purging_updates_the_fts_index(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            engine = MuscleEngine(Path(temp_dir) / "muscle.sqlite3")
            self.assertTrue(engine.learn("What is a local cache?", "A reusable local result."))
            self.assertEqual(engine.lookup("What is a local cache?")["source"], "learned")

            self.assertTrue(engine.purge("What is a local cache?"))
            self.assertIsNone(engine.lookup("What is a local cache?"))


if __name__ == "__main__":
    unittest.main()
