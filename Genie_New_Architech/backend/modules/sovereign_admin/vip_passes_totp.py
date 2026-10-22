from __future__ import annotations

import hashlib
import hmac
import struct
import time


def verify_totp(secret: bytes, code: str, now: int | None = None, window: int = 1) -> bool:
    if len(secret) < 16 or len(code) != 6 or not code.isdigit():
        return False
    counter = int((time.time() if now is None else now) // 30)
    for offset in range(-window, window + 1):
        digest = hmac.new(secret, struct.pack(">Q", counter + offset), hashlib.sha1).digest()
        position = digest[-1] & 0x0F
        value = (struct.unpack(">I", digest[position : position + 4])[0] & 0x7FFFFFFF) % 1_000_000
        if hmac.compare_digest(f"{value:06d}", code):
            return True
    return False


def hash_vip_code(code: str, pepper: bytes) -> str:
    if not code or len(pepper) < 32:
        raise ValueError("A code and a 32-byte VIP pass pepper are required.")
    return hmac.new(pepper, code.encode("utf-8"), hashlib.sha256).hexdigest()
