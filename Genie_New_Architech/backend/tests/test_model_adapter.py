from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import orchestrator
from modules.agents.library_rag_agent import LibraryRAGAgent
from modules.model_adapter import (
    LocalModelUnavailable,
    LocalSafetensorsAdapter,
    configured_local_model_adapter,
)


class LocalModelAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_local_model_is_disabled_without_operator_path(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(configured_local_model_adapter())

    async def test_local_model_requires_an_approved_license_identifier(self):
        with patch.dict(
            os.environ,
            {
                "GENIE_LOCAL_MODEL_PATH": "C:\\approved\\model",
                "GENIE_LOCAL_MODEL_LICENSE": "unknown-license",
            },
            clear=True,
        ):
            with self.assertRaisesRegex(LocalModelUnavailable, "must be llama-3.2-community"):
                configured_local_model_adapter()

    async def test_non_safetensors_weights_are_rejected_before_model_import(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            Path(temp_dir, "pytorch_model.bin").write_bytes(b"not a model")
            adapter = LocalSafetensorsAdapter(Path(temp_dir), "operator-approved")

            with self.assertRaisesRegex(LocalModelUnavailable, "Safetensors"):
                await adapter.complete([{"role": "user", "content": "hello"}])

    async def test_router_uses_configured_local_model_before_provider_quota(self):
        router = orchestrator.MultiPoolRouter()
        with (
            patch(
                "orchestrator.complete_with_local_model",
                new_callable=AsyncMock,
                return_value=("Local answer.", "local-safetensors:test-license"),
            ) as local_completion,
            patch("orchestrator.check_and_consume_quota") as consume_quota,
        ):
            result = await router.complete(
                [{"role": "user", "content": "Explain this."}],
                max_tokens=64,
            )

        self.assertEqual(result, ("Local answer.", "local-safetensors:test-license"))
        local_completion.assert_awaited_once()
        consume_quota.assert_not_called()


class LibraryRAGAgentTests(unittest.TestCase):
    def test_retrieval_is_owner_scoped_and_uses_the_required_threshold(self):
        agent = LibraryRAGAgent()
        items = [
            {
                "owner_id": "user-a",
                "type": "knowledge_reference",
                "title": "Quarterly budget",
                "content": "Forecast revenue and spending by quarter.",
            },
            {
                "owner_id": "user-b",
                "type": "knowledge_reference",
                "title": "Pasta recipe",
                "content": "Boil pasta and prepare tomato sauce.",
            },
        ]

        result = agent.retrieve(
            "help me make a pasta recipe",
            "user-a",
            "personal",
            items,
        )

        self.assertTrue(agent.read_only)
        self.assertEqual(agent.relevance_threshold, 0.82)
        self.assertEqual(result, [])
