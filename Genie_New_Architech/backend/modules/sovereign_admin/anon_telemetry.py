from __future__ import annotations

import hashlib
import hmac


def pseudonym(user_sub: str, salt: bytes) -> str:
    if len(salt) < 32:
        raise ValueError("Telemetry pseudonym salt must be at least 32 bytes.")
    digest = hmac.new(salt, user_sub.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"Node-#{digest[:4].upper()}"
