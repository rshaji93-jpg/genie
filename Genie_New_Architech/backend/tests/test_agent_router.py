import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from agent_router import AgentRouter, Provider


class AgentRouterTests(unittest.IsolatedAsyncioTestCase):
    def test_providers_use_the_four_pillars_in_priority_order(self):
        with patch.dict(
            os.environ,
            {
                "GROQ_API_KEY": "groq-key",
                "GROQ_MODEL": "groq/groq/custom-model",
                "OPENROUTER_API_KEY": "router-key",
                "MISTRAL_API_KEY": "mistral-key",
                "NVIDIA_NIM_API_KEY": "nvidia-key",
            },
            clear=True,
        ):
            providers = AgentRouter()._providers()

        self.assertEqual(
            [provider.name for provider in providers],
            ["groq", "openrouter", "mistral", "nvidia-nim"],
        )
        self.assertEqual(
            [provider.model for provider in providers],
            [
                "groq/custom-model",
                "openrouter/meta-llama/llama-3.2-3b-instruct:free",
                "mistral/mistral-small-latest",
                "nvidia_nim/meta/llama-3.3-70b-instruct",
            ],
        )

    async def test_run_fails_over_to_next_configured_adk_provider(self):
        router = AgentRouter()
        with patch.dict(
            os.environ,
            {
                "GROQ_API_KEY": "groq-key",
                "OPENROUTER_API_KEY": "router-key",
                "MISTRAL_API_KEY": "mistral-key",
                "NVIDIA_NIM_API_KEY": "nvidia-key",
            },
            clear=True,
        ), patch.object(
            router,
            "_run_provider",
            new_callable=AsyncMock,
            side_effect=[TimeoutError(), "A natural answer."],
        ) as run_provider:
            answer = await router.run([{"role": "user", "content": "Hi"}])

        self.assertEqual(answer, "A natural answer.")
        self.assertEqual(
            [call.args[0].name for call in run_provider.await_args_list],
            ["groq", "openrouter"],
        )
        self.assertEqual(
            run_provider.await_args_list[0].args[1],
            "User: Hi",
        )

    async def test_run_reports_missing_provider_keys(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "No Groq, OpenRouter, Mistral, or NVIDIA NIM keys"):
                await AgentRouter().run([{"role": "user", "content": "Hi"}])

    async def test_adk_runner_receives_chat_and_returns_generated_text(self):
        class FakeSessionService:
            async def create_session(self, **kwargs):
                return None

        class FakeRunner:
            def __init__(self, **kwargs):
                self.agent = kwargs["agent"]

            async def run_async(self, **kwargs):
                self.request = kwargs
                yield SimpleNamespace(
                    content=SimpleNamespace(
                        parts=[SimpleNamespace(text="A natural answer.")]
                    )
                )

        with (
            patch("agent_router.InMemorySessionService", FakeSessionService),
            patch("agent_router.LlmAgent", return_value="test-agent") as create_agent,
            patch("agent_router.LiteLlm", return_value="test-model") as create_model,
            patch("agent_router.Runner", FakeRunner),
        ):
            answer = await AgentRouter()._run_provider(
                Provider(name="groq", model="groq/test-model", api_key="test-key"),
                "User: Hi",
            )

        self.assertEqual(answer, "A natural answer.")
        create_model.assert_called_once_with(model="groq/test-model")
        self.assertEqual(
            create_agent.call_args.kwargs["instruction"],
            "Respond in the language and dialect used by the user. For standard conversation, "
            "write natural, fluent human prose without Markdown, bullets, headings, hashes, "
            "or asterisks. Preserve standard formal notation, equations, and variables only "
            "when the user asks about mathematics or science.",
        )


if __name__ == "__main__":
    unittest.main()
