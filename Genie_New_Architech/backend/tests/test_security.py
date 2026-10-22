import base64
import hashlib
import hmac
import json
import time
import unittest

from fastapi import HTTPException

from security import (
    SECRET_MARKER,
    is_zero_knowledge_secret,
    issue_inline_push_reply_token,
    normalize_room_ciphertext,
    validate_room_ciphertext_envelope,
    verify_inline_push_reply_token,
)


class SecurityTests(unittest.TestCase):
    def test_secret_shield_recognizes_marker_and_explicit_flag(self):
        self.assertTrue(is_zero_knowledge_secret(f"note {SECRET_MARKER} body"))
        self.assertTrue(is_zero_knowledge_secret("ordinary text", is_secret=True))
        self.assertFalse(is_zero_knowledge_secret("ordinary text"))
        self.assertFalse(is_zero_knowledge_secret(None))

    def test_ciphertext_validation_rejects_empty_oversized_and_control_text(self):
        self.assertEqual(normalize_room_ciphertext("opaque-ciphertext"), "opaque-ciphertext")
        for invalid in ("", "bad\x00text", "x" * 12_000_001):
            with self.subTest(invalid_length=len(invalid)), self.assertRaises(HTTPException):
                normalize_room_ciphertext(invalid)

    def test_inline_reply_token_verifies_expiration_and_signature(self):
        key = "t" * 32
        payload = base64.urlsafe_b64encode(
            json.dumps({"room_id": "room", "exp": int(time.time()) + 60}).encode()
        ).decode().rstrip("=")
        signature = hmac.new(key.encode(), payload.encode("ascii"), hashlib.sha256).digest()
        token = payload + "." + base64.urlsafe_b64encode(signature).decode().rstrip("=")
        self.assertEqual(verify_inline_push_reply_token(key, token)["room_id"], "room")
        with self.assertRaises(HTTPException):
            verify_inline_push_reply_token(key, payload + ".invalid")
        with self.assertRaises(HTTPException):
            verify_inline_push_reply_token(key, "not-ascii-\u2603.signature")

    def test_inline_reply_issuer_and_encrypted_room_envelope(self):
        key = "k" * 32
        token = issue_inline_push_reply_token(key, {"room_id": "room", "sub": "member"})
        self.assertEqual(
            verify_inline_push_reply_token(key, token)["sub"],
            "member",
        )
        envelope = '{"v":1,"iv":"AAAAAAAAAAAAAAAA","ciphertext":"AAAAAAAAAAAAAAAAAAAAAA"}'
        self.assertEqual(validate_room_ciphertext_envelope(envelope), envelope)
        with self.assertRaises(HTTPException):
            validate_room_ciphertext_envelope("plaintext must not be stored")
