import asyncio
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

    def test_probe_keeps_keys_active_for_transient_and_model_errors(self):
        key = "AIza" + "A" * 35
        with patch("gemini_pool.load_gemini_keys", return_value=[key]):
            pool = GeminiPool()

        for status_code in (404, 429, 500):
            response = Mock(status_code=status_code)
            with self.subTest(status_code=status_code), patch(
                "gemini_pool.requests.get", return_value=response
            ):
                pool.health_probe(model="gemini-test-flash")
                self.assertNotIn(key, pool._invalid_keys)
                self.assertEqual(pool._key_health[key], "active")

        with patch(
            "gemini_pool.requests.get",
            side_effect=requests.Timeout("probe timed out"),
        ):
            pool.health_probe(model="gemini-test-flash")
        self.assertNotIn(key, pool._invalid_keys)
        self.assertEqual(pool._key_health[key], "active")

    def test_probe_marks_keys_invalid_only_for_401_or_403(self):
        key = "AIza" + "A" * 35
        with patch("gemini_pool.load_gemini_keys", return_value=[key]):
            pool = GeminiPool()

        for status_code in (401, 403):
            with self.subTest(status_code=status_code), patch(
                "gemini_pool.requests.get",
                return_value=Mock(status_code=status_code),
            ):
                pool.health_probe(model="gemini-test-flash")
                self.assertIn(key, pool._invalid_keys)
                self.assertEqual(pool._key_health[key], "invalid")

    def test_daily_probe_waits_until_telemetry_pool_is_enabled(self):
        pool = self.make_pool()

        async def verify_gate():
            with patch.object(pool, "_refresh_model_and_key_routes") as refresh:
                task = asyncio.create_task(pool.run_daily_model_and_key_probe())
                await asyncio.wait_for(pool.routing_ready.wait(), timeout=0.2)
                await asyncio.sleep(0)
                refresh.assert_not_called()
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task

        asyncio.run(verify_gate())

    def test_call_google_sends_request_system_context_as_system_instruction(self):
        pool = GeminiPool()
        pool.free_keys = ["free-test-key"]
        response = Mock(status_code=200, text="")
        response.json.return_value = {
            "candidates": [{"content": {"parts": [{"text": "It is Thursday."}]}}]
        }

        with (
            patch.object(pool, "_acquire_key", return_value="free-test-key"),
            patch.object(pool, "_release_key"),
            patch("gemini_pool.requests.post", return_value=response) as post,
        ):
            answer = pool._call_google(
                [
                    {
                        "role": "system",
                        "content": "Current date and time: Thursday, 22 October 2026, 04:55 PM IST.",
                    },
                    {"role": "user", "content": "What day is it?"},
                ]
            )

        self.assertEqual(answer, "It is Thursday.")
        payload = post.call_args.kwargs["json"]
        self.assertIn("Current date and time:", payload["systemInstruction"]["parts"][0]["text"])
        self.assertEqual(payload["contents"][0]["parts"][0]["text"], "What day is it?")


if __name__ == "__main__":
    unittest.main()
