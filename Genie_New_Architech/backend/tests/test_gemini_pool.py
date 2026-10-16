import os
import unittest
from unittest.mock import Mock, patch

import requests

from gemini_pool import GeminiPool


class GeminiPoolTests(unittest.TestCase):
    def make_pool(self):
        with patch.dict(
            os.environ,
            {
                "GENIE_GEMINI_FREE_KEYS": "free-one,free-two",
                "GENIE_GEMINI_MASTER_KEYS": "master-one",
            },
            clear=True,
        ):
            return GeminiPool()

    def test_free_pool_rotates_and_retries_after_rate_limit(self):
        pool = self.make_pool()
        throttled = Mock()
        throttled.status_code = 429
        rate_limit = requests.HTTPError(response=throttled)
        ready = Mock()
        ready.raise_for_status.return_value = None

        with patch("gemini_pool.requests.post", side_effect=[rate_limit, ready]) as post:
            result = pool._generate("gemini-2.5-flash", [{"role": "user", "content": "Hello"}])

        self.assertIs(result, ready)
        self.assertEqual(post.call_args_list[0].kwargs["params"]["key"], "free-one")
        self.assertEqual(post.call_args_list[1].kwargs["params"]["key"], "free-two")
        self.assertGreater(pool.cooldowns["free-one"], 0)
        self.assertEqual(pool.availability()["genie_pro_available"], True)

    def test_master_keys_are_separate_and_thinking_level_is_sent(self):
        pool = self.make_pool()
        ready = Mock()
        ready.raise_for_status.return_value = None

        with patch("gemini_pool.requests.post", return_value=ready) as post:
            pool._generate(
                "gemini-2.5-pro",
                [{"role": "user", "content": "Review"}],
                master=True,
                thinking_level="deep",
            )

        self.assertEqual(post.call_args.kwargs["params"]["key"], "master-one")
        self.assertEqual(
            post.call_args.kwargs["json"]["generationConfig"]["thinkingConfig"]["thinkingBudget"],
            24576,
        )

    def test_availability_reports_master_cooldown_without_free_key_fallback(self):
        pool = self.make_pool()
        pool.cooldowns.update({"master-one": 4_000_000_000, "free-one": 4_000_000_000, "free-two": 4_000_000_000})
        status = pool.availability()
        self.assertFalse(status["genie_master_available"])
        self.assertFalse(status["genie_pro_available"])
        with self.assertRaisesRegex(RuntimeError, "cooling down"):
            pool._generate("gemini-2.5-pro", [{"role": "user", "content": "Review"}], master=True)


if __name__ == "__main__":
    unittest.main()
