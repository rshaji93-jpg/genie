import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import orchestrator
from modules.agents import world_knowledge_agent
from modules.agents.master_coordinator import (
    answer_immediately,
    extract_research_entity,
    initialize_sub_agent_registry,
    run_bounded_specialists,
)
from modules.library_guard import rank_and_filter_library_context
from modules.muscle_engine import MuscleEngine


class MasterCoordinatorTests(unittest.IsolatedAsyncioTestCase):
    async def test_greetings_are_zero_token_direct_answers(self):
        router = AsyncMock()
        brain = orchestrator.MasterBrain(router=router)

        for prompt in ("Heelo", "Hello"):
            with self.subTest(prompt=prompt):
                result = await brain.run(
                    [{"role": "user", "content": prompt}],
                    user_sub="user-1",
                )
                self.assertEqual(result["tokens_burned"], 0)
                self.assertEqual(result["sub_agents"], [])
                self.assertIn("Hello", result["reply"])

        router.complete.assert_not_awaited()

    async def test_identity_question_uses_logged_in_display_name(self):
        brain = orchestrator.MasterBrain(router=AsyncMock())
        result = await brain.run(
            [{"role": "user", "content": "can you able to tell me my name?"}],
            user_sub="user-1",
            user_name="Shaji R",
        )

        self.assertIn("Shaji R", result["reply"])
        self.assertEqual(result["tokens_burned"], 0)
        self.assertEqual(result["source"], "pool0-identity")

    async def test_curated_tamil_nadu_fact_is_learned_and_reusable(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            engine = MuscleEngine(Path(temp_dir) / "muscle.sqlite3")
            brain = orchestrator.MasterBrain(router=AsyncMock())

            with (
                patch(
                    "orchestrator.learn_general_answer",
                    side_effect=lambda question, answer, **kwargs: engine.learn(
                        question, answer, category=kwargs.get("category", "general")
                    ),
                ),
                patch(
                    "orchestrator.lookup_muscle",
                    side_effect=lambda question, **kwargs: engine.lookup(
                        question, minimum_confidence=0.85
                    ),
                ),
            ):
                result = await brain.run(
                    [{"role": "user", "content": "who is the chief minister of Tamilnadu"}],
                    user_sub="user-1",
                )
                repeated = await brain.run(
                    [{"role": "user", "content": "who is the chief minister of Tamilnadu"}],
                    user_sub="user-2",
                    model_tier="genie-master",
                )

            self.assertIn("C. Joseph Vijay", result["reply"])
            self.assertIn("10 May 2026", result["reply"])
            self.assertIn("M. K. Stalin", result["reply"])
            self.assertEqual(result["tokens_burned"], 0)
            learned = engine.lookup(
                "who is the chief minister of Tamilnadu",
                minimum_confidence=0.85,
            )
            self.assertIsNotNone(learned)
            self.assertIn("C. Joseph Vijay", learned["answer"])
            self.assertIn("M. K. Stalin", learned["answer"])
            self.assertEqual(repeated["source"], "pool0-muscle")
            self.assertEqual(repeated["tokens_burned"], 0)
            self.assertIn("C. Joseph Vijay", repeated["reply"])

    def test_unrelated_and_foreign_library_items_are_not_retrieved(self):
        retrieved = rank_and_filter_library_context(
            "help me make a pasta recipe",
            "owner-a",
            "personal",
            [
                {
                    "owner_id": "owner-a",
                    "type": "knowledge_reference",
                    "title": "Quarterly budget",
                    "content": "Revenue and spending forecasts.",
                },
                {
                    "owner_id": "owner-b",
                    "type": "knowledge_reference",
                    "title": "Pasta recipe",
                    "content": "Boil pasta and make a tomato sauce.",
                },
            ],
            min_score=0.82,
        )

        self.assertEqual(retrieved, [])

    def test_registry_registers_read_only_specialists(self):
        import sqlite3

        connection = sqlite3.connect(":memory:")
        initialize_sub_agent_registry(connection)
        agents = connection.execute(
            "SELECT agent_name, read_only FROM sub_agent_registry ORDER BY agent_name"
        ).fetchall()

        self.assertEqual(len(agents), 5)
        self.assertTrue(all(read_only == 1 for _, read_only in agents))
        connection.close()


class CoordinatorPureFunctionTests(unittest.IsolatedAsyncioTestCase):
    def test_identity_requires_a_name_to_personalize(self):
        result = answer_immediately("What is my name?")

        self.assertIsNotNone(result)
        self.assertIn("don't know your name yet", result.text)

    def test_research_entity_removes_conversational_prefix(self):
        self.assertEqual(
            extract_research_entity("who is the chief minister of Tamilnadu"),
            "Chief Minister of Tamil Nadu",
        )

    async def test_complex_specialist_tasks_are_bounded_and_read_only(self):
        tasks = await run_bounded_specialists(
            "Debug the API issue and explain the root cause.",
            [{"role": "user", "content": "Debug the API issue and explain the root cause."}],
        )

        self.assertEqual(len(tasks), 1)
        self.assertTrue(all("read_only=True" in task for task in tasks))

    async def test_live_search_has_an_overall_timeout(self):
        async def slow_lookup(*_args, **_kwargs):
            import asyncio

            await asyncio.sleep(0.05)
            return []

        with (
            patch.object(world_knowledge_agent, "SEARCH_TIMEOUT_SECONDS", 0.001),
            patch.object(world_knowledge_agent, "_google_news_search", new=slow_lookup),
            patch.object(world_knowledge_agent, "_wikipedia_search", new=slow_lookup),
            patch.object(world_knowledge_agent, "_duckduckgo_search", new=slow_lookup),
        ):
            result = await world_knowledge_agent.search_world_knowledge("latest science news")

        self.assertIsNone(result)

    async def test_tamil_nadu_baseline_is_returned_without_external_search(self):
        with patch.object(
            world_knowledge_agent.httpx,
            "AsyncClient",
            side_effect=AssertionError("curated fact must not call external search"),
        ):
            result = await world_knowledge_agent.search_world_knowledge(
                "who is the chief minister of Tamilnadu"
            )

        self.assertIsNotNone(result)
        self.assertIn("C. Joseph Vijay", result.summary)
        self.assertIn("M. K. Stalin", result.summary)

    async def test_multi_source_live_grounding_is_learned_for_zero_token_reuse(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            engine = MuscleEngine(Path(temp_dir) / "live-facts.sqlite3")
            result = world_knowledge_agent.WorldKnowledgeResult(
                query="current Eiffel Tower",
                summary="The Eiffel Tower is a landmark in Paris.",
                sources=("Google News RSS", "Wikipedia"),
                confidence=0.9,
            )
            with (
                patch.object(
                    world_knowledge_agent,
                    "search_world_knowledge",
                    new=AsyncMock(return_value=result),
                ),
                patch.object(
                    world_knowledge_agent,
                    "get_initialized_muscle_engine",
                    return_value=engine,
                ),
            ):
                answer = await world_knowledge_agent.fetch_live_world_context(
                    "what is the current Eiffel Tower"
                )

            self.assertIn("Eiffel Tower", answer)
            learned = engine.lookup("current Eiffel Tower", minimum_confidence=0.85)
            self.assertIsNotNone(learned)
            self.assertIn("Paris", learned["answer"])
