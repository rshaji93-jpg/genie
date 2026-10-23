import unittest

from agent_router import AgentRouter, FAST_GREETINGS


class AgentRouterTests(unittest.IsolatedAsyncioTestCase):
    def test_fast_greeting_catalog_contains_common_greetings(self):
        self.assertIn("hello", FAST_GREETINGS)
        self.assertIn("vanakkam", FAST_GREETINGS)

    def test_build_chat_messages_preserves_dynamic_system_context(self):
        prompt = [
            {"role": "system", "content": "Current date and time: Thursday, 22 October 2026, 04:55 PM IST."},
            {"role": "user", "content": "What day is it?"},
        ]

        routed = AgentRouter._build_chat_messages(prompt)

        self.assertEqual(routed[0]["role"], "system")
        self.assertIn("Current date and time:", routed[0]["content"])
        self.assertEqual(routed[1], {"role": "user", "content": "What day is it?"})

    def test_extract_reply_removes_simulated_follow_up_turns(self):
        response = {
            "choices": [
                {"message": {"content": "A natural answer.\n\nUser: Actually, never mind."}}
            ]
        }

        self.assertEqual(AgentRouter._extract_reply(response), "A natural answer.")

    async def test_fast_greeting_bypasses_external_providers(self):
        router = AgentRouter()

        answer = await router.run([{"role": "user", "content": "Hello!"}])

        self.assertIn("Hello!", answer)
        self.assertEqual(router.last_provider, "tier0:fast-greeting")

    async def test_run_rejects_messages_without_conversational_content(self):
        with self.assertRaisesRegex(RuntimeError, "no conversational messages"):
            await AgentRouter().run([])


if __name__ == "__main__":
    unittest.main()
