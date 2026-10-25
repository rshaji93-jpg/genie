import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from modules.keep_alive import _sync_archive


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


if __name__ == "__main__":
    unittest.main()
