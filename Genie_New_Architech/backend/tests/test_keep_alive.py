import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from modules import keep_alive, muscle_engine
from modules.keep_alive import _sync_archive
from modules.muscle_engine import MuscleEngine


class KeepAliveTests(unittest.TestCase):
    def test_archive_sync_copies_committed_tables_to_persistent_storage(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source_path = Path(temp_dir) / "active.sqlite3"
            target_path = Path(temp_dir) / "persistent" / "archive.sqlite3"
            with closing(sqlite3.connect(source_path)) as connection:
                connection.execute("CREATE TABLE call_transcripts (utterance TEXT)")
                connection.execute(
                    "INSERT INTO call_transcripts VALUES (?)",
                    ("Meeting notes",),
                )
                connection.commit()

            _sync_archive(source_path, target_path)

            with closing(sqlite3.connect(target_path)) as connection:
                self.assertEqual(
                    connection.execute(
                        "SELECT utterance FROM call_transcripts"
                    ).fetchone()[0],
                    "Meeting notes",
                )

    def test_learned_snapshot_restores_and_persists_synapses(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            local_snapshot = root / "tmp" / "learned_muscle.json.gz"
            backup_snapshot = root / "backup" / "learned_muscle.json.gz"
            source_engine = MuscleEngine(root / "source.sqlite3")
            self.assertTrue(
                source_engine.learn(
                    "What is snapshot restore?",
                    "It reloads durable learned facts.",
                    category="real-world",
                )
            )

            with (
                patch.object(muscle_engine, "LEARNED_SNAPSHOT_LOCAL", local_snapshot),
                patch.object(muscle_engine, "LEARNED_SNAPSHOT_BACKUP", backup_snapshot),
                patch.object(
                    muscle_engine,
                    "get_initialized_muscle_engine",
                    return_value=source_engine,
                ),
            ):
                keep_alive._sync_learned_snapshot()

                restored_engine = MuscleEngine(root / "restored.sqlite3")
                with patch.object(
                    muscle_engine,
                    "get_initialized_muscle_engine",
                    return_value=restored_engine,
                ):
                    keep_alive._sync_learned_snapshot()

            restored = restored_engine.lookup("What is snapshot restore?")
            self.assertIsNotNone(restored)
            self.assertEqual(restored["answer"], "It reloads durable learned facts.")
            self.assertTrue(local_snapshot.is_file())
            self.assertTrue(backup_snapshot.is_file())


if __name__ == "__main__":
    unittest.main()
