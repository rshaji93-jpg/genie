from __future__ import annotations

import hashlib
import hmac
import secrets


def create_passcode() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def passcode_hash(passcode: str, salt: bytes) -> str:
    if len(passcode) != 6 or not passcode.isdigit():
        raise ValueError("Invite passcodes must contain six digits.")
    if len(salt) < 16:
        raise ValueError("Invite passcode salt is too short.")
    return hashlib.scrypt(passcode.encode("ascii"), salt=salt, n=2**14, r=8, p=1).hex()


def verify_passcode(passcode: str, salt: bytes, expected_hash: str) -> bool:
    try:
        actual = passcode_hash(passcode, salt)
    except ValueError:
        return False
    return hmac.compare_digest(actual, expected_hash)
