import asyncio
import os
import re
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import AsyncMock, patch

_test_data = tempfile.TemporaryDirectory(prefix="genie-new-arch-tests-")
os.environ["GENIE_DB_PATH"] = str(Path(_test_data.name) / "test.sqlite3")
os.environ["GENIE_GOOGLE_CLIENT_ID"] = "test-client"

from fastapi.testclient import TestClient

import main
import orchestrator
from security import SECRET_MARKER
from security import issue_inline_push_reply_token


class BackendApiTests(unittest.TestCase):
    def setUp(self):
        self.actor = {"sub": "test-user-123", "name": "Test User", "email": "test@example.com"}
        with orchestrator._PUBLIC_CACHE_LOCK:
            orchestrator._PUBLIC_CACHE.clear()
        with closing(main.database()) as connection:
            connection.execute("DELETE FROM master_quota_windows")
            connection.execute("DELETE FROM vip_pass_requests")
            connection.execute("DELETE FROM vip_passes")
            connection.commit()
        main.app.dependency_overrides[main.current_identity] = lambda: self.actor
        main.app.dependency_overrides[main.optional_read_identity] = lambda: self.actor
        self.provider_probe_patch = patch.object(
            main.multi_provider_pool,
            "validate_primary_providers",
            return_value={},
        )
        self.provider_probe_patch.start()
        self.addCleanup(self.provider_probe_patch.stop)
        self.grounding_patch = patch.object(
            orchestrator,
            "fetch_live_grounding",
            new_callable=AsyncMock,
            return_value="",
        )
        self.grounding_patch.start()
        self.addCleanup(self.grounding_patch.stop)
        self.client = TestClient(main.app)

    def tearDown(self):
        main.app.dependency_overrides.clear()
        main.room_hub.sockets.clear()
        main.gemini_pool.set_telemetry_gemini_pool(False)

    def test_frontend_api_routes_are_registered(self):
        registered_routes = {
            route.path
            for route in main.app.routes
            if hasattr(route, "path")
        }

        self.assertTrue(
            {
                "/api/ai/status",
                "/api/py/ai/status",
                "/health",
                "/api/health",
                "/api/chat",
                "/api/py/chat",
                "/api/auth/register",
            }.issubset(registered_routes)
        )

    def test_health_aliases_and_status_proxy_return_success(self):
        for path in ("/health", "/api/health", "/api/py/ai/status"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertIsInstance(response.json(), dict)

    def test_friends_only_chat_skips_ai_inference(self):
        with patch.object(main.multi_pool_router, "complete", new_callable=AsyncMock) as provider:
            response = self.client.post(
                "/api/chat",
                json={
                    "message": "Please relay this privately to my friends.",
                    "chat_mode": "friends_only",
                    "model_tier": "genie-master",
                    "history": [{"role": "user", "content": "Earlier context"}],
                    "room_mode": True,
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["chat_mode"], "friends_only")
        self.assertTrue(response.json()["inference_skipped"])
        self.assertEqual(response.json()["tokens_burned"], 0)
        provider.assert_not_awaited()

    def test_library_items_memory_approval_and_trust_actions(self):
        self.actor["sub"] = "library-test-user"
        seeded = self.client.get("/api/library")
        self.assertEqual(seeded.status_code, 200, seeded.text)
        self.assertGreaterEqual(seeded.json()["count"], 5)

        created = self.client.post(
            "/api/library",
            json={
                "title": "Launch decision",
                "content": "We decided to launch the pilot on Friday.",
                "item_type": "decision",
                "visibility": "friends",
                "related_item_ids": [],
                "provenance": {"source": "test"},
            },
        )
        self.assertEqual(created.status_code, 200, created.text)
        item_id = created.json()["item"]["id"]
        self.assertEqual(created.json()["item"]["provenance"]["source"], "test")

        revoked = self.client.post(
            "/api/library/trust",
            json={"action": "revoke_share", "item_id": item_id},
        )
        self.assertEqual(revoked.status_code, 200, revoked.text)
        self.assertTrue(revoked.json()["share_revoked"])
        exported = self.client.post("/api/library/trust", json={"action": "export"})
        self.assertEqual(exported.status_code, 200, exported.text)
        self.assertTrue(any(item["id"] == item_id for item in exported.json()["items"]))

        candidate = main.master_brain.memory_sieve.propose(
            "My goal is to finish the first project milestone this week.",
            self.actor["sub"],
        )
        self.assertIsNotNone(candidate)
        approved = self.client.post(
            "/api/library/memory-sieve/approve",
            json={"pending_action_token": candidate["pending_action_token"]},
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertTrue(approved.json()["approved"])
        duplicate = self.client.post(
            "/api/library/memory-sieve/approve",
            json={"pending_action_token": candidate["pending_action_token"]},
        )
        self.assertEqual(duplicate.status_code, 409)

        deleted = self.client.delete(f"/api/library/{item_id}")
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertTrue(deleted.json()["deleted"])

    def test_grounded_library_ask_returns_accessible_item_citations(self):
        created = self.client.post(
            "/api/library",
            json={
                "title": "Service notes",
                "content": "The service keeps a 24-hour rolling token balance.",
                "item_type": "article",
                "provenance": {"source": "runbook"},
            },
        )
        item_id = created.json()["item"]["id"]
        with patch.object(
            main.multi_pool_router,
            "complete",
            new_callable=AsyncMock,
            return_value=("The balance rolls over every 24 hours [1].", "pool-test"),
        ) as provider:
            response = self.client.post(
                "/api/v1/workspace/library/grounded-ask",
                json={
                    "question": "How does the token balance work?",
                    "action": "ask",
                    "item_ids": [item_id],
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["citations"][0]["item_id"], item_id)
        self.assertEqual(response.json()["citations"][0]["title"], "Service notes")
        self.assertEqual(response.json()["reply"], "The balance rolls over every 24 hours [1].")
        provider.assert_awaited_once()
        self.assertLessEqual(provider.await_args.kwargs["max_tokens"], 1200)

    def test_genie_daily_has_five_pillars_and_skill_capsules_award_credits(self):
        edition = self.client.get("/api/v1/genie-daily/editions/current")
        self.assertEqual(edition.status_code, 200, edition.text)
        self.assertEqual(
            [pillar["pillar"] for pillar in edition.json()["pillars"]],
            ["Knowledge", "Work & Goals", "Decisions", "Lessons", "Community & Creativity"],
        )

        created = self.client.post(
            "/api/skills/capsules",
            json={
                "skill_id": "skill_capsule_builder",
                "title": "Practice a concise plan",
                "objective": "Draft a three-step plan for a real task.",
            },
        )
        self.assertEqual(created.status_code, 200, created.text)
        capsule_id = created.json()["capsule"]["id"]
        completed = self.client.post(f"/api/skills/capsules/{capsule_id}/complete")
        self.assertEqual(completed.status_code, 200, completed.text)
        self.assertEqual(completed.json()["credits_awarded"], 10)
        self.assertEqual(completed.json()["time_credits"], 10)
        duplicate = self.client.post(f"/api/skills/capsules/{capsule_id}/complete")
        self.assertEqual(duplicate.status_code, 409)
        capsules = self.client.get("/api/skills/capsules")
        self.assertEqual(capsules.json()["time_credits"], 10)
        self.assertEqual(capsules.json()["skill_dna"][0]["completed_capsules"], 1)

    def test_genie_daily_edition_is_cached_for_user_and_day(self):
        self.actor["sub"] = "daily-cache-test-user"
        with patch.object(
            main,
            "_seed_starter_library",
            wraps=main._seed_starter_library,
        ) as seed_library:
            first = self.client.get("/api/v1/genie-daily/editions/current")
            second = self.client.get("/api/v1/genie-daily/editions/current")

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(first.json(), second.json())
        seed_library.assert_called_once()

    def test_provider_pool_quota_resets_lazily_by_date(self):
        pool_state = {
            "used_today": 1,
            "last_reset_date": "2000-01-01",
            "daily_limit": 1,
        }

        self.assertTrue(orchestrator.check_and_consume_quota(pool_state))
        self.assertEqual(pool_state["used_today"], 1)
        self.assertEqual(pool_state["last_reset_date"], orchestrator.date.today().isoformat())
        self.assertFalse(orchestrator.check_and_consume_quota(pool_state))

    def test_seeded_library_reads_are_available_without_sign_in(self):
        main.app.dependency_overrides.pop(main.optional_read_identity, None)

        library = self.client.get("/api/library")
        edition = self.client.get("/api/v1/genie-daily/editions/current")
        capsules = self.client.get("/api/skills/capsules")

        self.assertEqual(library.status_code, 200, library.text)
        self.assertGreaterEqual(library.json()["count"], 5)
        self.assertEqual(edition.status_code, 200, edition.text)
        self.assertTrue(any(
            item["title"] == "Welcome to your Living Library"
            for pillar in edition.json()["pillars"]
            for item in pillar["items"]
        ))
        self.assertEqual(capsules.status_code, 200, capsules.text)
        self.assertTrue(capsules.json()["available_skills"])

    def test_private_ai_chat_omits_prior_history_from_inference(self):
        with patch.object(
            main.multi_pool_router,
            "complete",
            new_callable=AsyncMock,
            return_value=("Private answer", "pool-test"),
        ) as provider:
            response = self.client.post(
                "/api/chat",
                json={
                    "messages": [
                        {"role": "user", "content": "Earlier room-visible question"},
                        {"role": "assistant", "content": "Earlier room-visible answer"},
                        {"role": "user", "content": "Analyze this private request carefully."},
                    ],
                    "chat_mode": "private_ai",
                    "model_tier": "genie-pro",
                    "room_mode": True,
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["reply"], "Private answer")
        inference_messages = provider.await_args.args[0]
        self.assertEqual(inference_messages[-1]["content"], "Analyze this private request carefully.")
        self.assertNotIn("Earlier room-visible question", str(inference_messages))
        self.assertNotIn("Earlier room-visible answer", str(inference_messages))

    def test_cors_allows_cloudflare_pages_origins_and_methods(self):
        response = self.client.options(
            "/api/chat",
            headers={
                "Origin": "https://example.pages.dev",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,authorization",
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "*")

    def test_chat_accepts_optional_session_id_on_frontend_proxy_alias(self):
        response = self.client.post(
            "/api/py/chat",
            json={
                "messages": [{"role": "user", "content": "hello"}],
                "session_id": "frontend-session-123",
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["source"], "local")
        self.assertEqual(response.json()["tokens_burned"], 0)

    def test_chat_accepts_tier_history_and_room_mode(self):
        with patch.object(
            main.multi_pool_router,
            "complete",
            new_callable=AsyncMock,
            return_value=("Context-aware answer", "pool-test"),
        ) as provider:
            response = self.client.post(
                "/api/chat",
                json={
                    "message": "Explain how to preserve conversation context in a team workflow.",
                    "history": [
                        {"role": "user", "content": "We are designing a shared application.", "sender": "Raja"},
                        {"role": "assistant", "content": "We need reliable context."},
                    ],
                    "model_tier": "genie-pro",
                    "room_mode": True,
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["reply"], "Context-aware answer")
        self.assertEqual(response.json()["sub_agents"], ["Argon Cognitive Brain"])
        provider.assert_awaited_once()
        prompt = provider.await_args.args[0]
        self.assertEqual(prompt[0]["role"], "system")
        self.assertIn("Current date and time:", prompt[0]["content"])
        self.assertRegex(
            prompt[0]["content"],
            r"Current date and time: [A-Z][a-z]+, \d{2} [A-Z][a-z]+ \d{4}, \d{2}:\d{2} (?:AM|PM) IST\.",
        )
        self.assertIn("This is a shared-room request.", prompt[0]["content"])
        self.assertEqual(prompt[1]["content"], "Raja: We are designing a shared application.")
        self.assertEqual(prompt[-1]["content"], "Explain how to preserve conversation context in a team workflow.")

    def test_chat_falls_back_to_multi_provider_pool(self):
        with patch.object(
            main.multi_pool_router,
            "complete",
            new_callable=AsyncMock,
            return_value=("Fallback provider answer", "pool-fallback"),
        ) as fallback:
            response = self.client.post(
                "/api/chat",
                json={
                    "message": "Explain a resilient multi-stage workflow.",
                    "model_tier": "genie-lite",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["reply"], "Fallback provider answer")
        self.assertEqual(response.json()["sub_agents"], ["Argon Cognitive Brain"])
        fallback.assert_awaited_once()
        self.assertIn("Current date and time:", fallback.await_args.args[0][0]["content"])

    def test_chat_waterfall_continues_after_unexpected_provider_exception(self):
        with patch.object(
            main.multi_pool_router,
            "complete",
            new_callable=AsyncMock,
            return_value=("Recovered live AI answer", "pool-recovered"),
        ) as fallback:
            response = self.client.post(
                "/api/chat",
                json={
                    "message": "Explain a resilient distributed database architecture.",
                    "model_tier": "genie-lite",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["reply"], "Recovered live AI answer")
        fallback.assert_awaited_once()

    def test_chat_provider_exhaustion_returns_transparent_fallback_and_refunds(self):
        with patch.object(
            main.multi_pool_router,
            "complete",
            new_callable=AsyncMock,
            side_effect=RuntimeError("provider waterfall exhausted"),
        ):
            response = self.client.post(
                "/api/chat",
                json={
                    "message": "Explain a resilient distributed database architecture.",
                    "model_tier": "genie-lite",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["source"], "local-fallback")
        self.assertEqual(payload["provider_status"], "unavailable")
        self.assertEqual(payload["tokens_burned"], 0)
        self.assertIn("Live AI providers are temporarily unavailable", payload["reply"])
        with closing(main.database()) as connection:
            ledger = connection.execute(
                "SELECT event_type, amount FROM user_token_ledger WHERE user_sub = ? ORDER BY rowid DESC LIMIT 2",
                ("local-development",),
            ).fetchall()
        self.assertEqual([(row["event_type"], row["amount"]) for row in ledger], [("refund", 1), ("spend", -1)])

    def test_stream_provider_exhaustion_returns_transparent_fallback(self):
        with (
            patch.object(
                main.multi_pool_router,
                "complete",
                new_callable=AsyncMock,
                side_effect=RuntimeError("provider waterfall exhausted"),
            ),
            patch.object(main, "_get_general_cache", return_value=None),
            patch.object(main, "_set_general_cache"),
        ):
            response = self.client.post(
                "/api/chat/stream",
                json={
                    "message": "Explain a resilient distributed database architecture.",
                    "model_tier": "genie-lite",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn('"source": "local-fallback"', response.text)
        self.assertIn("Live AI providers are temporarily unavailable", response.text)
        self.assertIn("event: done", response.text)

    def test_argon_prompt_keeps_dynamic_instruction_and_verified_grounding(self):
        prompt = [
            {"role": "user", "content": "What day is it?"},
        ]
        router = AsyncMock()
        router.complete.return_value = ("The verified answer.", "pool-test")
        brain = orchestrator.MasterBrain(router=router)
        with patch.object(
            orchestrator,
            "fetch_live_grounding",
            new_callable=AsyncMock,
            return_value="- English Wikipedia: verified fact",
        ):
            result = asyncio.run(
                brain.run(prompt, user_sub=self.actor["sub"])
            )

        system_prompt = router.complete.await_args.args[0][0]["content"]
        self.assertIn("Argon Cognitive Brain", system_prompt)
        self.assertIn("Current date and time:", system_prompt)
        self.assertIn("[VERIFIED GROUNDING CONTEXT]", system_prompt)
        self.assertIn("English Wikipedia: verified fact", system_prompt)
        self.assertIn("read_only=True", system_prompt)
        self.assertEqual(result["reply"], "The verified answer.")

    def test_stream_chat_uses_tier_orchestrator_and_reports_agents(self):
        with patch.object(
            main.multi_pool_router,
            "complete",
            new_callable=AsyncMock,
            return_value=("Streamed orchestrated answer", "pool-test"),
        ) as provider:
            response = self.client.post(
                "/api/chat/stream",
                json={
                    "message": "Explain the best way to preserve shared chat context.",
                    "model_tier": "genie-pro",
                    "room_mode": True,
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn('"sub_agents": ["Argon Cognitive Brain"]', response.text)
        self.assertIn('"text": "Streamed orchestrated answer"', response.text)
        prompt = provider.await_args.args[0]
        self.assertIn("Current date and time:", prompt[0]["content"])
        self.assertIn("This is a shared-room request.", prompt[0]["content"])

    def test_chat_master_is_open_and_returns_four_by_four_quota(self):
        with patch.object(
            main.multi_pool_router,
            "complete",
            new_callable=AsyncMock,
            return_value=("Master answer.", "pool-test"),
        ):
            response = self.client.post(
                "/api/chat",
                json={
                    "message": "Design a useful workflow.",
                    "model_tier": "genie-master",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["master_quota"]["used"], 1)
        self.assertEqual(response.json()["master_quota"]["limit"], 4)
        self.assertEqual(response.json()["master_quota"]["remaining"], 3)
        self.assertFalse(response.json()["master_quota"]["vip_active"])

    def test_fifth_master_request_downgrades_to_pro_and_returns_200(self):
        with patch.object(
            main.multi_pool_router,
            "complete",
            new_callable=AsyncMock,
            return_value=("Answer.", "pool-test"),
        ) as provider:
            responses = [
                self.client.post(
                    "/api/chat",
                    json={
                        "message": f"Question number {index} about architecture",
                        "model_tier": "genie-master",
                    },
                )
                for index in range(1, 6)
            ]

        self.assertTrue(all(response.status_code == 200 for response in responses))
        for index, response in enumerate(responses[:4], start=1):
            self.assertEqual(response.json()["master_quota"]["used"], index)
            self.assertEqual(response.json()["master_quota"]["remaining"], 4 - index)
            self.assertEqual(len(response.json()["sub_agents"]), 3)
        fifth = responses[4].json()
        self.assertEqual(fifth["master_quota"]["used"], 4)
        self.assertEqual(fifth["master_quota"]["remaining"], 0)
        self.assertEqual(fifth["master_quota"]["downgraded_to"], "genie-pro")
        self.assertTrue(fifth["master_quota"]["can_request_vip"])
        self.assertEqual(fifth["sub_agents"], ["Argon Cognitive Brain"])
        self.assertEqual(provider.await_count, 5)

    def test_master_quota_resets_after_four_hours_and_vip_bypasses(self):
        identity = {"sub": "rolling-window-user", "email": "user@example.com"}
        with patch.object(main.time, "time", side_effect=[1000.0, 1001.0, 1002.0, 1003.0, 1004.0, 15400.0]):
            first_four = [main.consume_master_quota(identity) for _ in range(4)]
            exhausted = main.consume_master_quota(identity)
            reset = main.consume_master_quota(identity)

        self.assertTrue(all(allowed for _, allowed in first_four))
        self.assertEqual(first_four[-1][0]["used"], 4)
        self.assertFalse(exhausted[1])
        self.assertTrue(reset[1])
        self.assertEqual(reset[0]["used"], 1)

        owner_quota, owner_allowed = main.consume_master_quota({
            "sub": "owner-user",
            "email": main.SUPER_ADMIN_EMAIL,
        })
        self.assertTrue(owner_allowed)
        self.assertTrue(owner_quota["unlimited"])

    def test_vip_request_and_owner_approval_grant_unlimited_access(self):
        requester = {"sub": "vip-requester", "email": "vip@example.com", "name": "VIP User"}
        main.app.dependency_overrides[main.current_identity] = lambda: requester
        requested = self.client.post(
            "/api/admin/vip/request",
            json={
                "user_email": "vip@example.com",
                "user_name": "VIP User",
                "reason": "I need frequent research access.",
            },
        )
        self.assertEqual(requested.status_code, 200, requested.text)

        with closing(main.database()) as connection:
            connection.execute(
                """
                INSERT INTO users(email, user_sub, user_name, last_seen_at, registration_complete)
                VALUES (?, ?, ?, ?, 1)
                """,
                ("vip@example.com", "vip-requester", "VIP User", main.utc_now()),
            )
            connection.commit()

        owner = {"sub": "verified-owner", "email": main.SUPER_ADMIN_EMAIL, "name": "Owner"}
        main.app.dependency_overrides[main.current_identity] = lambda: owner
        approved = self.client.post(
            "/api/admin/vip/approve",
            json={"request_id": requested.json()["request_id"]},
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        quota, allowed = main.consume_master_quota(requester)
        self.assertTrue(allowed)
        self.assertTrue(quota["vip_active"])
        queue = self.client.get("/api/admin/vip")
        self.assertEqual(queue.status_code, 200, queue.text)
        self.assertEqual(queue.json()["active_count"], 1)
        self.assertEqual(queue.json()["pending"], [])
        revoked = self.client.post(
            "/api/admin/vip/revoke",
            json={"pass_id": approved.json()["pass_id"]},
        )
        self.assertEqual(revoked.status_code, 200, revoked.text)
        self.assertTrue(revoked.json()["revoked"])
        self.assertEqual(self.client.get("/api/admin/vip").json()["active_count"], 0)

    def test_master_tier_uses_single_argon_waterfall_completion(self):
        router = AsyncMock()
        router.complete.return_value = ("Verified response", "pool4-pollinations")
        brain = orchestrator.MasterBrain(router=router)
        with patch.object(
            orchestrator,
            "fetch_live_grounding",
            new_callable=AsyncMock,
            return_value="",
        ):
            result = asyncio.run(
                brain.run(
                    [{"role": "user", "content": "Design a resilient workflow."}],
                    user_sub=self.actor["sub"],
                    model_tier="genie-master",
                )
            )

        self.assertEqual(result["reply"], "Verified response")
        router.complete.assert_awaited_once()
        self.assertEqual(
            result["sub_agents"],
            ["Argon Cognitive Brain", "Research (read-only)", "Synthesis"],
        )

    def test_secret_chat_is_local_and_does_not_call_provider(self):
        with patch.object(main.gemini_pool, "chat", side_effect=AssertionError("provider called")) as provider:
            for message in (
                {"role": "user", "content": f"private {SECRET_MARKER} value"},
                {"role": "user", "content": "private text", "is_secret": True},
            ):
                response = self.client.post(
                    "/api/chat",
                    json={"messages": [message], "model": "genie-master"},
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["tick_status"], "yellow_no_ai")
                self.assertEqual(response.json()["tokens_burned"], 0)
            provider.assert_not_called()

            streamed = self.client.post(
                "/api/chat/stream",
                json={"messages": [{"role": "user", "content": "hidden", "is_secret": True}]},
            )
            self.assertEqual(streamed.status_code, 200)
            self.assertIn('"tokens_burned": 0', streamed.text)
            provider.assert_not_called()

    def test_chat_uses_primary_provider_by_default(self):
        with (
            patch.object(
                main.multi_pool_router,
                "complete",
                new_callable=AsyncMock,
                return_value=("Synthesis", "pool-primary"),
            ) as provider,
            patch.object(main.multi_provider_pool, "chat") as legacy_provider,
            patch.object(main.gemini_pool, "chat") as gemini,
            patch.object(main, "_get_general_cache", return_value=None),
            patch.object(main, "_set_general_cache"),
            patch.object(main, "_charge_user_tokens", return_value="test-charge"),
        ):
            response = self.client.post(
                "/api/chat",
                json={
                    "messages": [{
                        "role": "user",
                        "content": "Design a multi-step implementation plan for a resilient chat service.",
                    }],
                    "session_id": "frontend-session-456",
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reply"], "Synthesis")
        provider.assert_awaited_once()
        legacy_provider.assert_not_called()
        gemini.assert_not_called()
        with patch.object(
            main.gemini_pool,
            "availability",
            return_value={
                "genie_pro_available": True,
                "genie_pro_retry_seconds": 0,
                "genie_master_available": False,
                "genie_master_retry_seconds": 30,
            },
        ):
            ordinary = self.client.get("/api/ai/status").json()
            self.assertEqual(ordinary["provider"], "argon-waterfall")
            self.assertEqual(ordinary["genie_master_retry_seconds"], 0)

    def test_chat_returns_local_fallback_when_all_providers_fail(self):
        with (
            patch.object(
                main.multi_pool_router,
                "complete",
                new_callable=AsyncMock,
                side_effect=RuntimeError("Provider waterfall exhausted."),
            ),
            patch.object(main, "_get_general_cache", return_value=None),
            patch.object(main, "_set_general_cache"),
            patch.object(main, "_charge_user_tokens", return_value="test-charge"),
            patch.object(main, "_refund_user_tokens"),
        ):
            response = self.client.post(
                "/api/chat",
                json={
                    "messages": [{
                        "role": "user",
                        "content": "Explain the architectural trade-offs of a multi-region event-processing system.",
                    }]
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["source"], "local-fallback")
        self.assertEqual(response.json()["tokens_burned"], 0)
        self.assertIn("temporarily unavailable", response.json()["reply"])

    def test_gemini_free_pool_routes_chat_only_after_admin_toggle(self):
        main.gemini_pool.set_telemetry_gemini_pool(True)
        with (
            patch.object(main.gemini_pool, "chat", return_value="Gemini response") as gemini,
            patch.object(
                main.multi_pool_router,
                "complete",
                new_callable=AsyncMock,
                side_effect=[
                    ("Primary response", "pool-primary"),
                    ("Orchestrated response", "pool-orchestrated"),
                ],
            ) as primary,
            patch.object(main, "_get_general_cache", return_value=None),
            patch.object(main, "_set_general_cache"),
            patch.object(main, "_charge_user_tokens", return_value="test-charge"),
        ):
            simple_response = self.client.post(
                "/api/chat",
                json={"messages": [{"role": "user", "content": "Explain this"}]},
            )
            complex_response = self.client.post(
                "/api/chat",
                json={
                    "messages": [{
                        "role": "user",
                        "content": "Design a multi-step implementation plan for a resilient chat service.",
                    }]
                },
            )
        self.assertEqual(simple_response.status_code, 200, simple_response.text)
        self.assertEqual(simple_response.json()["reply"], "Primary response")
        self.assertEqual(complex_response.status_code, 200, complex_response.text)
        self.assertEqual(complex_response.json()["reply"], "Orchestrated response")
        self.assertEqual(gemini.call_count, 0)
        self.assertEqual(primary.await_count, 2)

    def test_gemini_pool_toggle_requires_genesis_admin_session(self):
        denied = self.client.post(
            "/api/admin/telemetry/gemini-pool",
            json={"enabled": True},
        )
        self.assertEqual(denied.status_code, 404)
        self.assertFalse(main.gemini_pool.telemetry_gemini_pool_enabled)

        admin = {
            "sub": "verified-admin-sub",
            "name": "Genie Admin",
            "email": main.SUPER_ADMIN_EMAIL,
        }
        main.app.dependency_overrides[main.current_identity] = lambda: admin
        with patch.object(main, "verify_admin_session", return_value={"sub": admin["sub"]}):
            response = self.client.post(
                "/api/admin/telemetry/gemini-pool",
                headers={"X-Genie-Admin-Session": "valid-admin-session"},
                json={"enabled": True},
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["gemini_free_pool_enabled"])
        self.assertTrue(main.gemini_pool.telemetry_gemini_pool_enabled)

    def test_passkey_enrollment_options_are_admin_only_and_issue_a_challenge(self):
        denied = self.client.post("/api/admin/passkeys/enroll/options", json={})
        self.assertEqual(denied.status_code, 403)
        admin = {
            "sub": "verified-admin-sub",
            "name": "Genie Admin",
            "email": "rshaji93@gmail.com",
        }
        main.app.dependency_overrides[main.current_identity] = lambda: admin
        response = self.client.post("/api/admin/passkeys/enroll/options", json={})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["challenge"])
        self.assertEqual(
            response.json()["authenticatorSelection"]["userVerification"], "required"
        )
        with closing(main.database()) as connection:
            challenge = connection.execute(
                """
                SELECT purpose FROM passkey_challenges
                WHERE user_sub = ? ORDER BY expires_at DESC LIMIT 1
                """,
                (admin["sub"],),
            ).fetchone()
        self.assertEqual(challenge["purpose"], "registration")

    def test_room_membership_ciphertext_relay_and_secret_review_guard(self):
        invitation = "i" * 43
        created = self.client.post(
            "/api/rooms", json={"name": "Private", "invite_code": invitation}
        )
        self.assertEqual(created.status_code, 200)
        room_id = created.json()["id"]
        encrypted_payload = '{"v":1,"iv":"opaque","ciphertext":"opaque"}'
        with patch.object(main, "verify_google_identity", return_value=self.actor):
            with self.client.websocket_connect(f"/api/rooms/{room_id}/socket") as socket:
                socket.send_json({"credential": "mock-google-token"})
                self.assertEqual(socket.receive_json()["type"], "presence")
                self.assertEqual(socket.receive_json()["type"], "history")
                socket.send_json(
                    {
                        "type": "message.send",
                        "client_id": "client-message-1",
                        "ciphertext": encrypted_payload,
                        "is_secret": True,
                    }
                )
                acknowledgement = socket.receive_json()
                self.assertEqual(acknowledgement["type"], "message.ack")
                self.assertEqual(acknowledgement["client_id"], "client-message-1")
                message_id = acknowledgement["message"]["id"]

        with closing(main.database()) as connection:
            stored = connection.execute(
                "SELECT ciphertext, is_secret FROM room_messages WHERE id = ?", (message_id,)
            ).fetchone()
        self.assertEqual(stored["ciphertext"], encrypted_payload)
        self.assertEqual(stored["is_secret"], 1)
        with (
            patch.object(main.gemini_pool, "silent_pro_summarize", side_effect=AssertionError("summary called")),
        ):
            review = self.client.post(
                f"/api/rooms/{room_id}/messages/{message_id}/review",
                json={"context": [{"role": "user", "content": "ordinary"}]},
            )
        self.assertEqual(review.status_code, 200)
        self.assertEqual(review.json()["tokens_burned"], 0)
        self.assertEqual(review.json()["tick_status"], "yellow_no_ai")

        main.app.dependency_overrides[main.current_identity] = lambda: {
            "sub": "different-user", "name": "Other", "email": "other@example.com"
        }
        denied = self.client.get(f"/api/rooms/{room_id}/messages")
        self.assertEqual(denied.status_code, 404)

    def test_inline_push_reply_is_encrypted_one_time_and_never_calls_ai(self):
        invitation = "p" * 43
        room_id = self.client.post(
            "/api/rooms", json={"name": "Push reply room", "invite_code": invitation}
        ).json()["id"]
        signing_key = "s" * 32
        token = issue_inline_push_reply_token(signing_key, {
            "room_id": room_id,
            "sub": self.actor["sub"],
            "name": self.actor["name"],
        })
        encrypted_text = '{"v":1,"iv":"AAAAAAAAAAAAAAAA","ciphertext":"AAAAAAAAAAAAAAAAAAAAAA"}'
        with (
            patch.object(main, "SESSION_SIGNING_KEY", signing_key),
            patch.object(main.room_hub, "broadcast", new_callable=AsyncMock) as broadcast,
            patch.object(main.gemini_pool, "chat", side_effect=AssertionError("AI was called")),
        ):
            response = self.client.post(
                "/api/chat/inline-reply",
                json={"reply_token": token, "text": encrypted_text},
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["tick_status"], "yellow_no_ai")
            self.assertEqual(response.json()["tokens_burned"], 0)
            self.assertEqual(
                self.client.post(
                    "/api/chat/inline-reply",
                    json={"reply_token": token, "text": encrypted_text},
                ).status_code,
                409,
            )
            broadcast.assert_awaited_once()
        with closing(main.database()) as connection:
            row = connection.execute(
                "SELECT ciphertext, is_secret, tick_status FROM room_messages WHERE room_id = ?",
                (room_id,),
            ).fetchone()
        self.assertEqual(row["ciphertext"], encrypted_text)
        self.assertEqual(row["is_secret"], 1)
        self.assertEqual(row["tick_status"], "yellow_no_ai")

    def test_explicit_review_is_metered_to_triggering_identity_and_not_persisted_as_plaintext(self):
        invitation = "r" * 43
        room_id = self.client.post(
            "/api/rooms", json={"name": "Review room", "invite_code": invitation}
        ).json()["id"]
        reviewer = self.actor
        other = {"sub": "second-member", "name": "Other Member", "email": "other@example.com"}
        main.app.dependency_overrides[main.current_identity] = lambda: other
        joined = self.client.post("/api/rooms/join", json={"invite_code": invitation})
        self.assertEqual(joined.status_code, 200)
        main.app.dependency_overrides[main.current_identity] = lambda: reviewer
        timestamp = main.utc_now()
        message_id = "test-review-message"
        with closing(main.database()) as connection:
            connection.execute(
                """
                INSERT INTO room_messages(id, room_id, sender_sub, sender_name, ciphertext,
                                          is_secret, tick_status, sent_at)
                VALUES (?, ?, ?, ?, ?, 0, 'read_no_ai', ?)
                """,
                (message_id, room_id, self.actor["sub"], self.actor["name"], "encrypted", timestamp),
            )
            connection.commit()
        with (
            patch.object(
                main.master_brain,
                "run",
                new_callable=AsyncMock,
                return_value={"reply": "review reply"},
            ) as master,
        ):
            response = self.client.post(
                f"/api/rooms/{room_id}/messages/{message_id}/review",
                json={
                    "context": [
                        {"role": "user", "content": "Keep this context"},
                        {"role": "user", "content": SECRET_MARKER + "private"},
                    ],
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["tokens_burned"], 1)
        self.assertEqual(response.json()["triggered_by_sub"], self.actor["sub"])
        master.assert_awaited_once()
        review_context = master.await_args.args[0][0]["content"]
        self.assertIn("Keep this context", review_context)
        self.assertNotIn(SECRET_MARKER, review_context)
        with closing(main.database()) as connection:
            row = connection.execute(
                """
                SELECT m.ai_reply, l.user_sub, l.tokens FROM room_messages m
                JOIN token_ledger l ON l.message_id = m.id WHERE m.id = ?
                """,
                (message_id,),
            ).fetchone()
        self.assertIsNone(row["ai_reply"])
        self.assertEqual(row["user_sub"], self.actor["sub"])
        self.assertEqual(row["tokens"], 1)
        stored = self.client.post(
            f"/api/rooms/{room_id}/messages/{message_id}/review-ciphertext",
            json={"ciphertext": "opaque-encrypted-review"},
        )
        self.assertEqual(stored.status_code, 200)
        with closing(main.database()) as connection:
            encrypted = connection.execute(
                "SELECT ai_reply, review_ciphertext FROM room_messages WHERE id = ?",
                (message_id,),
            ).fetchone()
        self.assertIsNone(encrypted["ai_reply"])
        self.assertEqual(encrypted["review_ciphertext"], "opaque-encrypted-review")
        main.app.dependency_overrides[main.current_identity] = lambda: other
        denied_verify = self.client.post(
            f"/api/rooms/{room_id}/messages/{message_id}/verify", json={}
        )
        self.assertEqual(denied_verify.status_code, 409)
        main.app.dependency_overrides[main.current_identity] = lambda: reviewer
        verified = self.client.post(
            f"/api/rooms/{room_id}/messages/{message_id}/verify", json={}
        )
        self.assertEqual(verified.status_code, 200)
        self.assertEqual(verified.json()["tick_status"], "green")

    def test_email_primary_user_migration_and_hashed_mutual_contact_discovery(self):
        friend = {"sub": "friend-user", "name": "Friend User", "email": "friend@example.com"}
        with closing(main.database()) as connection:
            connection.executemany(
                """
                INSERT OR IGNORE INTO users(email, user_sub, user_name, last_seen_at)
                VALUES (?, ?, ?, ?)
                """,
                [
                    (self.actor["email"], self.actor["sub"], self.actor["name"], main.utc_now()),
                    (friend["email"], friend["sub"], friend["name"], main.utc_now()),
                ],
            )
            connection.commit()
            email_key = next(
                row for row in connection.execute("PRAGMA table_info(users)").fetchall()
                if row["name"] == "email"
            )
            self.assertEqual(email_key["pk"], 1)
            tables = {
                row["name"] for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                ).fetchall()
            }
            self.assertIn("chats", tables)
            self.assertIn("messages", tables)

        with patch.object(main, "METASYNC_HASH_KEY", b"test-metasync-key-that-is-long-enough"):
            my_phone = "+14155550101"
            friend_phone = "+14155550102"
            registered = self.client.put("/api/profile/phone", json={"phone": my_phone})
            self.assertEqual(registered.status_code, 200, registered.text)
            my_hash = main.metasync_phone_hash(my_phone)
            friend_hash = main.metasync_phone_hash(friend_phone)
            with closing(main.database()) as connection:
                connection.execute(
                    "UPDATE users SET phone = ?, phone_hash = ? WHERE user_sub = ?",
                    (friend_phone, friend_hash, friend["sub"]),
                )
                connection.commit()

            non_mutual = self.client.post(
                "/api/social/metasync", json={"phone_numbers": [friend_phone]}
            )
            self.assertEqual(non_mutual.status_code, 200, non_mutual.text)
            self.assertEqual(non_mutual.json(), [])
            with closing(main.database()) as connection:
                connection.execute(
                    """
                    INSERT INTO metasync_contacts(user_sub, phone_hash, updated_at)
                    VALUES (?, ?, ?)
                    """,
                    (friend["sub"], my_hash, main.utc_now()),
                )
                connection.commit()
            mutual = self.client.post(
                "/api/social/metasync", json={"phone_numbers": [friend_phone]}
            )
            self.assertEqual(mutual.status_code, 200, mutual.text)
            self.assertEqual(mutual.json()[0]["user_sub"], friend["sub"])
            with closing(main.database()) as connection:
                stored = connection.execute(
                    "SELECT phone_hash FROM metasync_contacts WHERE user_sub = ?",
                    (self.actor["sub"],),
                ).fetchone()
            self.assertEqual(stored["phone_hash"], friend_hash)

    def test_legacy_user_schema_is_migrated_without_losing_user_rows(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory(prefix="genie-schema-migration-") as temporary:
            database_path = Path(temporary) / "legacy.sqlite3"
            main.DATABASE_PATH = database_path
            try:
                with closing(main.database()) as connection:
                    connection.execute(
                        """
                        CREATE TABLE users (
                            user_sub TEXT PRIMARY KEY,
                            email TEXT NOT NULL UNIQUE,
                            user_name TEXT NOT NULL,
                            last_seen_at TEXT NOT NULL
                        )
                        """
                    )
                    connection.execute(
                        "INSERT INTO users VALUES (?, ?, ?, ?)",
                        ("legacy-sub", "legacy@example.com", "Legacy User", main.utc_now()),
                    )
                    connection.commit()
                main.initialize_database()
                with closing(main.database()) as connection:
                    user = connection.execute(
                        "SELECT email, user_sub FROM users WHERE user_sub = 'legacy-sub'"
                    ).fetchone()
                    email_key = next(
                        row for row in connection.execute("PRAGMA table_info(users)").fetchall()
                        if row["name"] == "email"
                    )
                self.assertEqual(dict(user), {"email": "legacy@example.com", "user_sub": "legacy-sub"})
                self.assertEqual(email_key["pk"], 1)
            finally:
                main.DATABASE_PATH = original_path

    def test_friend_request_pending_acceptance_and_rejection_lifecycle(self):
        receiver = {"sub": "social-receiver", "name": "Receiver", "email": "receiver@example.com"}
        with closing(main.database()) as connection:
            connection.executemany(
                "INSERT OR IGNORE INTO users(email, user_sub, user_name, last_seen_at) VALUES (?, ?, ?, ?)",
                [
                    (self.actor["email"], self.actor["sub"], self.actor["name"], main.utc_now()),
                    (receiver["email"], receiver["sub"], receiver["name"], main.utc_now()),
                ],
            )
            connection.execute(
                "UPDATE users SET profile_completed = 1 WHERE user_sub = ?",
                (self.actor["sub"],),
            )
            connection.execute(
                "UPDATE users SET profile_completed = 1 WHERE user_sub = ?",
                (self.actor["sub"],),
            )
            connection.commit()
        with patch.object(main.room_hub, "send_user_event", new_callable=AsyncMock) as notification:
            pending = self.client.post("/api/social/requests", json={"email": receiver["email"]})
        self.assertEqual(pending.status_code, 200, pending.text)
        request_id = pending.json()["id"]
        notification.assert_awaited_once()
        self.assertEqual(notification.await_args.args[0], receiver["sub"])
        self.assertEqual(notification.await_args.args[1]["type"], "friend_request_received")
        self.assertEqual(notification.await_args.args[1]["sender"]["id"], self.actor["sub"])
        self.assertEqual(
            self.client.post(f"/api/social/requests/{request_id}/accept", json={}).status_code,
            403,
        )
        main.app.dependency_overrides[main.current_identity] = lambda: receiver
        self.assertEqual(self.client.get("/api/social/requests").json()[0]["id"], request_id)
        accepted = self.client.post(f"/api/social/requests/{request_id}/accept", json={})
        self.assertEqual(accepted.json()["status"], "confirmed")
        self.assertEqual(self.client.get("/api/social/friends").json()[0]["user_sub"], self.actor["sub"])
        with closing(main.database()) as connection:
            connection.execute(
                "INSERT OR IGNORE INTO users(email, user_sub, user_name, last_seen_at) VALUES (?, ?, ?, ?)",
                ("rejector@example.com", "rejector-user", "Rejector", main.utc_now()),
            )
            connection.execute(
                """
                INSERT INTO friend_requests(id, sender_sub, receiver_sub, status, created_at)
                VALUES (?, ?, ?, 'pending', ?)
                """,
                ("pending-rejection", "rejector-user", self.actor["sub"], main.utc_now()),
            )
            connection.commit()
        main.app.dependency_overrides[main.current_identity] = lambda: self.actor
        rejected = self.client.post("/api/social/requests/pending-rejection/reject", json={})
        self.assertEqual(rejected.status_code, 200)
        self.assertEqual(rejected.json()["status"], "rejected")

    def test_social_profile_persists_avatar_privacy_and_skills(self):
        with closing(main.database()) as connection:
            connection.execute(
                "INSERT OR IGNORE INTO users(email, user_sub, user_name, last_seen_at) VALUES (?, ?, ?, ?)",
                (self.actor["email"], self.actor["sub"], self.actor["name"], main.utc_now()),
            )
            connection.commit()
        avatar = "data:image/jpeg;base64," + __import__("base64").b64encode(
            b"\xff\xd8\xffavatar"
        ).decode("ascii")
        response = self.client.post(
            "/api/profile",
            json={
                "display_name": "Test Social",
                "username": "@test_social",
                "avatar_data_url": avatar,
                "bio": "Hello",
                "skills_offered": ["Tutoring", "Coding"],
                "discoverable": True,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["profile_completed"])
        profile = self.client.get("/api/profile").json()
        self.assertEqual(profile["username"], "test_social")
        self.assertEqual(profile["avatar_data_url"], avatar)
        self.assertEqual(profile["skills_offered"], ["Tutoring", "Coding"])
        self.assertTrue(profile["discoverable"])

    def test_friend_request_requires_completed_profile_and_directory_is_discoverable_only(self):
        target = {"sub": "social-target", "name": "Discoverable Person", "email": "discover@example.com"}
        hidden = {"sub": "social-hidden", "name": "Hidden Person", "email": "hidden@example.com"}
        with closing(main.database()) as connection:
            connection.executemany(
                """
                INSERT OR IGNORE INTO users(
                    email, user_sub, user_name, username, last_seen_at, registration_complete,
                    profile_completed, discoverable
                ) VALUES (?, ?, ?, ?, ?, 1, 1, ?)
                """,
                [
                    (self.actor["email"], self.actor["sub"], self.actor["name"], "actor_test", main.utc_now(), 0),
                    (target["email"], target["sub"], target["name"], "discover_target", main.utc_now(), 1),
                    (hidden["email"], hidden["sub"], hidden["name"], "hidden_target", main.utc_now(), 0),
                ],
            )
            connection.execute(
                "UPDATE users SET profile_completed = 0 WHERE user_sub = ?",
                (self.actor["sub"],),
            )
            connection.commit()
        gated = self.client.post("/api/social/requests", json={"username": "discover_target"})
        self.assertEqual(gated.status_code, 409)
        self.assertEqual(
            [row["user_sub"] for row in self.client.get("/api/social/directory").json()],
            [target["sub"]],
        )

    def test_inverse_friend_requests_auto_match_to_accepted(self):
        receiver = {"sub": "auto-match-target", "name": "Auto Match", "email": "auto-match@example.com"}
        with closing(main.database()) as connection:
            connection.executemany(
                """
                INSERT OR IGNORE INTO users(
                    email, user_sub, user_name, last_seen_at, profile_completed
                ) VALUES (?, ?, ?, ?, 1)
                """,
                [
                    (self.actor["email"], self.actor["sub"], self.actor["name"], main.utc_now()),
                    (receiver["email"], receiver["sub"], receiver["name"], main.utc_now()),
                ],
            )
            connection.execute(
                "UPDATE users SET profile_completed = 1 WHERE user_sub = ?",
                (self.actor["sub"],),
            )
            connection.execute(
                """
                INSERT INTO friend_requests(
                    id, sender_sub, receiver_sub, status, created_at, pair_key
                ) VALUES (?, ?, ?, 'pending', ?, ?)
                """,
                (
                    "inverse-pending", receiver["sub"], self.actor["sub"], main.utc_now(),
                    "__".join(sorted((receiver["sub"], self.actor["sub"]))),
                ),
            )
            connection.commit()
        response = self.client.post("/api/social/requests", json={"email": receiver["email"]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "accepted")
        self.assertEqual(
            self.client.get("/api/social/friends").json()[0]["user_sub"],
            receiver["sub"],
        )

    def test_admin_telemetry_includes_grant_readiness_snapshot(self):
        with patch.object(main, "require_genesis_owner"), patch.object(
            main, "require_admin_session", return_value={"exp": 1}
        ):
            response = self.client.get(
                "/api/admin/telemetry",
                headers={"X-Genie-Admin-Session": "test-session"},
            )
        self.assertEqual(response.status_code, 200, response.text)
        readiness = response.json()["grant_readiness"]
        self.assertEqual(readiness["active_dau_mau_capacity"], "200,000 DAU @ 90% Cache")
        self.assertEqual(readiness["average_cost_per_task_usd"], 0.0002)
        self.assertEqual(
            {program["name"] for program in readiness["grant_programs"]},
            {"Google for Startups", "Microsoft Founders Hub", "Cloudflare Startup Plan"},
        )


if __name__ == "__main__":
    unittest.main()
