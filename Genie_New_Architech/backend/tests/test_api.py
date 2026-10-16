import os
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
from security import SECRET_MARKER
from security import issue_inline_push_reply_token


class BackendApiTests(unittest.TestCase):
    def setUp(self):
        self.actor = {"sub": "test-user-123", "name": "Test User", "email": "test@example.com"}
        main.app.dependency_overrides[main.current_identity] = lambda: self.actor
        self.client = TestClient(main.app)

    def tearDown(self):
        main.app.dependency_overrides.clear()
        main.room_hub.sockets.clear()

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

    def test_chat_selects_master_reasoning_tier_and_exposes_availability(self):
        with patch.object(main.gemini_pool, "chat", return_value="Synthesis") as provider:
            response = self.client.post(
                "/api/chat",
                json={
                    "messages": [{"role": "user", "content": "Explain this"}],
                    "model": "genie-master",
                    "thinking_level": "deep",
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(provider.call_args.args[1:], (True, "deep"))
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
            self.assertEqual(ordinary["genie_master_retry_seconds"], 30)

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
        with patch.object(main.gemini_pool, "silent_pro_summarize", side_effect=AssertionError("summary called")):
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
            patch.object(main.gemini_pool, "silent_pro_summarize", return_value="summary") as summarize,
            patch.object(main.gemini_pool, "chat", return_value="review reply") as master,
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
        summarize.assert_called_once()
        summary_context = summarize.call_args.args[0]
        self.assertEqual(len(summary_context), 1)
        self.assertNotIn(SECRET_MARKER, summary_context[0]["content"])
        master.assert_called_once()
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
            connection.commit()
        pending = self.client.post("/api/social/requests", json={"email": receiver["email"]})
        self.assertEqual(pending.status_code, 200, pending.text)
        request_id = pending.json()["id"]
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


if __name__ == "__main__":
    unittest.main()
