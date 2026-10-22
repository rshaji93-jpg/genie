import os
import unittest
from unittest.mock import Mock, patch

import requests

from modules.ai_orchestrator.multi_provider_pool import MultiProviderPool


class MultiProviderPoolTests(unittest.TestCase):
    def test_primary_rate_limit_falls_back_with_provider_auth(self):
        primary_error = Mock()
        primary_error.raise_for_status.side_effect = requests.HTTPError("rate limited")
        fallback_response = Mock()
        fallback_response.raise_for_status.return_value = None
        fallback_response.json.return_value = {
            "choices": [{"message": {"content": "Fallback response"}}]
        }

        with patch.dict(
            os.environ,
            {
                "GROQ_API_KEY": "  'groq-secret' ",
                "OPENROUTER_API_KEY": "router-secret",
            },
            clear=True,
        ), patch(
            "modules.ai_orchestrator.multi_provider_pool.requests.post",
            side_effect=[primary_error, fallback_response],
        ) as post:
            reply = MultiProviderPool().chat([{"role": "user", "content": "Hello"}])

        self.assertEqual(reply, "Fallback response")
        forwarded_messages = post.call_args_list[1].kwargs["json"]["messages"]
        self.assertEqual(forwarded_messages[0]["role"], "system")
        self.assertIn("plain prose", forwarded_messages[0]["content"])
        self.assertEqual(
            [call.args[0] for call in post.call_args_list],
            [
                "https://api.groq.com/openai/v1/chat/completions",
                "https://openrouter.ai/api/v1/chat/completions",
            ],
        )
        self.assertEqual(
            post.call_args_list[0].kwargs["headers"]["Authorization"],
            "Bearer groq-secret",
        )
        self.assertEqual(
            post.call_args_list[1].kwargs["headers"]["Authorization"],
            "Bearer router-secret",
        )

    def test_connection_failure_skips_provider_and_falls_through(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "choices": [{"message": {"content": "SiliconFlow response"}}]
        }
        pool = MultiProviderPool()
        with patch.dict(
            os.environ,
            {
                "GROQ_API_KEY": "groq-secret",
                "SILICONFLOW_API_KEY": "silicon-secret",
            },
            clear=True,
        ), patch(
            "modules.ai_orchestrator.multi_provider_pool.requests.post",
            side_effect=[requests.ConnectionError("connection refused"), response],
        ) as post:
            reply = pool.chat([{"role": "user", "content": "Explain this"}])

        self.assertEqual(reply, "SiliconFlow response")
        self.assertEqual(post.call_count, 2)
        self.assertFalse(pool._provider_available("groq"))
        self.assertTrue(pool._provider_available("siliconflow"))

    def test_startup_probe_marks_only_successful_primary_provider_healthy(self):
        failed_response = Mock()
        rate_limit_error = requests.HTTPError("rate limited")
        rate_limit_error.response = Mock(status_code=429)
        failed_response.raise_for_status.side_effect = rate_limit_error
        healthy_response = Mock()
        healthy_response.status_code = 200
        healthy_response.raise_for_status.return_value = None
        healthy_response.json.return_value = {
            "choices": [{"message": {"content": "OK"}}]
        }
        pool = MultiProviderPool()
        with patch.dict(
            os.environ,
            {
                "GROQ_API_KEY": "groq-secret",
                "SILICONFLOW_API_KEY": "silicon-secret",
            },
            clear=True,
        ), patch(
            "modules.ai_orchestrator.multi_provider_pool.requests.post",
            side_effect=[failed_response, healthy_response],
        ) as post:
            health = pool.validate_primary_providers()
            active_names = {provider[0] for provider in pool._ordered()}

        self.assertEqual(health, {"groq": False, "siliconflow": True})
        self.assertEqual(active_names, {"siliconflow"})
        self.assertEqual(post.call_count, 2)

    def test_primary_engines_are_ordered_before_fallback_engines(self):
        with patch.dict(
            os.environ,
            {
                "GROQ_API_KEY": "groq-secret",
                "SILICONFLOW_API_KEY": "silicon-secret",
                "NVIDIA_NIM_API_KEY": "nvidia-secret",
                "OPENROUTER_API_KEY": "router-secret",
                "MISTRAL_API_KEY": "mistral-secret",
            },
            clear=True,
        ):
            providers = MultiProviderPool()._providers()

        self.assertEqual(
            [provider[0] for provider in providers],
            [
                "groq",
                "openrouter",
                "openrouter",
                "openrouter",
                "mistral",
                "nvidia-nim",
                "siliconflow",
            ],
        )


if __name__ == "__main__":
    unittest.main()
