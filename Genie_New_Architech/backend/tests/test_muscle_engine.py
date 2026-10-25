import asyncio
import gzip
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from modules.bone_router import sanitize_general_answer
from modules.muscle_engine import (
    MAX_DATABASE_BYTES,
    MuscleEngine,
    database_path,
    fetch_real_world_context,
    match_conversational_reflex,
)


class MuscleEngineSeedTests(unittest.TestCase):
    def test_fuzzy_greetings_handle_repetition_typos_and_common_abbreviations(self):
        for query in ("Heelo", "hiii", "gud mrng"):
            with self.subTest(query=query):
                result = match_conversational_reflex(query)
                self.assertIsNotNone(result)
                expected = "Good morning" if query == "gud mrng" else "Hello"
                self.assertIn(expected, result["answer"])

        self.assertIsNone(match_conversational_reflex("deployment architecture"))

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

    def test_real_world_grounding_uses_wikipedia_search_and_summary(self):
        search_response = MagicMock()
        search_response.json.return_value = {"pages": [{"key": "Grace_Hopper"}]}
        summary_response = MagicMock()
        summary_response.json.return_value = {
            "extract": "Grace Hopper was an American computer scientist.",
            "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Grace_Hopper"}},
        }
        client = MagicMock()
        client.get = AsyncMock(side_effect=[search_response, summary_response])
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=client)
        context.__aexit__ = AsyncMock(return_value=None)

        with patch(
            "modules.muscle_engine.httpx.AsyncClient",
            return_value=context,
        ) as async_client:
            result = asyncio.run(fetch_real_world_context("Who is Grace Hopper?"))

        self.assertIn("Grace Hopper was an American computer scientist.", result)
        self.assertIn("https://en.wikipedia.org/wiki/Grace_Hopper", result)
        self.assertEqual(
            client.get.await_args_list[0].args[0],
            "https://en.wikipedia.org/w/rest.php/v1/search/page",
        )
        self.assertIn(
            "/api/rest_v1/page/summary/Grace_Hopper",
            client.get.await_args_list[1].args[0],
        )
        self.assertEqual(async_client.call_args.kwargs["timeout"].read, 2.5)


if __name__ == "__main__":
    unittest.main()
