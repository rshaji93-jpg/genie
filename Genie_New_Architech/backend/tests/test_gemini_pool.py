import asyncio
import time
import unittest
from urllib.parse import parse_qs, urlsplit
from unittest.mock import Mock, patch

import requests

from gemini_pool import GeminiPool


class GeminiPoolTests(unittest.TestCase):
    def make_pool(self):
        with patch("gemini_pool.load_gemini_keys", return_value=["free-one", "free-two"]):
            return GeminiPool()

    def test_free_pool_rotates_and_retries_after_rate_limit(self):
        pool = self.make_pool()
        throttled = Mock()
        throttled.status_code = 429
        throttled.text = "rate limit"
        ready = Mock()
        ready.status_code = 200
        ready.text = ""
        ready.json.return_value = {
            "candidates": [{"content": {"parts": [{"text": "A natural answer."}]}}]
        }

        with patch("gemini_pool.requests.post", side_effect=[throttled, ready]) as post:
            result = pool._call_google([{"role": "user", "content": "Hello"}])

        self.assertEqual(result, "A natural answer.")
        self.assertEqual(parse_qs(urlsplit(post.call_args_list[0].args[0]).query)["key"], ["free-one"])
        self.assertEqual(parse_qs(urlsplit(post.call_args_list[1].args[0]).query)["key"], ["free-two"])
        self.assertGreater(pool._key_backoff_until["free-one"], time.monotonic())
        self.assertEqual(pool.availability()["genie_pro_available"], True)

    def test_master_keys_are_separate_from_free_pool(self):
        pool = self.make_pool()
        pool.master_key = "master-one"
        ready = Mock()
        ready.status_code = 200
        ready.text = ""
        ready.json.return_value = {
            "candidates": [{"content": {"parts": [{"text": "A private answer."}]}}]
        }

        with patch("gemini_pool.requests.post", return_value=ready) as post:
            answer = pool._call_google(
                [{"role": "user", "content": "Review"}],
                master=True,
            )

        self.assertEqual(answer, "A private answer.")
        self.assertEqual(parse_qs(urlsplit(post.call_args.args[0]).query)["key"], ["master-one"])
        self.assertIn("systemInstruction", post.call_args.kwargs["json"])
        self.assertFalse(pool._busy_keys)

    def test_availability_reports_master_cooldown_without_free_key_fallback(self):
        pool = self.make_pool()
        pool._key_backoff_until.update({"free-one": time.monotonic() + 3600, "free-two": time.monotonic() + 3600})
        pool._unhealthy_keys.update({"free-one", "free-two"})
        status = pool.availability()
        self.assertFalse(status["genie_master_available"])
        self.assertFalse(status["genie_pro_available"])
        with self.assertRaisesRegex(RuntimeError, "FREE_POOL_EXHAUSTED"):
            pool._call_google([{"role": "user", "content": "Review"}])

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
