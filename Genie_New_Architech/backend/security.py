from __future__ import annotations

import re
import binascii
import json
from typing import Any

from fastapi import HTTPException

SECRET_MARKER = "[ENCRYPTED_SECRET_BLOCK]"
SUPER_ADMIN_EMAIL = "rshaji93@gmail.com"


def is_zero_knowledge_secret(content: Any, is_secret: bool = False) -> bool:
    if is_secret:
        return True
    if not isinstance(content, str):
        return False
    return SECRET_MARKER.casefold() in content.casefold()


def verify_google_identity(credential: str, audience: str) -> dict[str, str]:
    if not audience:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured.")
    try:
        from google.auth.exceptions import GoogleAuthError
        from google.auth.transport.requests import Request
        from google.oauth2 import id_token

        claims = id_token.verify_oauth2_token(credential, Request(), audience)
    except (ValueError, GoogleAuthError) as error:
        raise HTTPException(status_code=401, detail="Invalid Google identity token.") from error

    subject = claims.get("sub")
    email = claims.get("email")
    name = claims.get("name") or claims.get("given_name") or "Genie member"
    if not isinstance(subject, str) or not subject or not isinstance(email, str):
        raise HTTPException(status_code=401, detail="Google identity is incomplete.")
    if claims.get("email_verified") is not True:
        raise HTTPException(status_code=401, detail="A verified Google email is required.")
    return {"sub": subject, "email": email.casefold(), "name": str(name)[:100]}


def verify_inline_push_reply_token(signing_key: str, token: str) -> dict[str, Any]:
    """Verify a URL-safe payload.signature token signed with HMAC-SHA256."""
    import base64
    import hashlib
    import hmac
    import json
    import time

    if len(signing_key.encode("utf-8")) < 32:
        raise HTTPException(status_code=503, detail="Inline reply signing is not configured.")
    parts = token.split(".")
    if len(parts) != 2:
        raise HTTPException(status_code=401, detail="Invalid reply token.")
    payload_part, signature_part = parts
    try:
        payload_encoded = payload_part.encode("ascii")
        signature_encoded = signature_part.encode("ascii")
        expected = hmac.new(
            signing_key.encode("utf-8"), payload_encoded, hashlib.sha256
        ).digest()
        supplied = base64.b64decode(
            signature_encoded + b"=" * (-len(signature_encoded) % 4),
            altchars=b"-_",
            validate=True,
        )
        payload_bytes = base64.b64decode(
            payload_encoded + b"=" * (-len(payload_encoded) % 4),
            altchars=b"-_",
            validate=True,
        )
        payload = json.loads(payload_bytes)
    except (ValueError, UnicodeError, binascii.Error) as error:
        raise HTTPException(status_code=401, detail="Invalid reply token.") from error
    if not hmac.compare_digest(expected, supplied):
        raise HTTPException(status_code=401, detail="Invalid reply token.")
    try:
        expires_at = int(payload.get("exp", 0)) if isinstance(payload, dict) else 0
    except (TypeError, ValueError):
        expires_at = 0
    if expires_at <= int(time.time()):
        raise HTTPException(status_code=401, detail="Reply token has expired.")
    return payload


def issue_inline_push_reply_token(
    signing_key: str, claims: dict[str, Any], expires_in_seconds: int = 900
) -> str:
    import base64
    import hashlib
    import hmac
    import json
    import time
    import uuid

    if len(signing_key.encode("utf-8")) < 32:
        raise ValueError("Inline reply signing requires a key of at least 32 bytes.")
    if not 1 <= expires_in_seconds <= 86_400:
        raise ValueError("Inline reply token lifetime must be between 1 second and 24 hours.")
    payload = {**claims, "exp": int(time.time()) + expires_in_seconds}
    payload.setdefault("jti", uuid.uuid4().hex)
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).decode("ascii").rstrip("=")
    signature = hmac.new(
        signing_key.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256
    ).digest()
    return f"{encoded}.{base64.urlsafe_b64encode(signature).decode('ascii').rstrip('=')}"


def validate_origin(origin: str, allowed_origins: set[str]) -> str:
    if origin not in allowed_origins:
        raise HTTPException(status_code=400, detail="Origin is not allowed.")
    return origin


def normalize_room_ciphertext(value: Any) -> str:
    if not isinstance(value, str) or not value:
        raise HTTPException(status_code=422, detail="Encrypted message is invalid or too large.")
    try:
        encoded_length = len(value.encode("utf-8"))
    except UnicodeEncodeError as error:
        raise HTTPException(status_code=422, detail="Encrypted message contains invalid text.") from error
    if encoded_length > 12_000_000:
        raise HTTPException(status_code=422, detail="Encrypted message is invalid or too large.")
    if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", value):
        raise HTTPException(status_code=422, detail="Encrypted message contains invalid characters.")
    return value


def validate_room_ciphertext_envelope(value: Any) -> str:
    ciphertext = normalize_room_ciphertext(value)
    try:
        envelope = json.loads(ciphertext)
    except (json.JSONDecodeError, TypeError) as error:
        raise HTTPException(status_code=422, detail="Encrypted room payload is malformed.") from error
    if (
        not isinstance(envelope, dict)
        or type(envelope.get("v")) is not int
        or envelope.get("v") != 1
        or not isinstance(envelope.get("iv"), str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{16}", envelope["iv"])
        or not isinstance(envelope.get("ciphertext"), str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{22,}", envelope["ciphertext"])
    ):
        raise HTTPException(status_code=422, detail="Encrypted room payload is malformed.")
    return ciphertext
