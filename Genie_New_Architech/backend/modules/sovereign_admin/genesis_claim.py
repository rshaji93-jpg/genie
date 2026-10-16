from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken


def encrypt_totp_secret(secret: str, key: str) -> str:
    try:
        return Fernet(key.encode("ascii")).encrypt(secret.encode("ascii")).decode("ascii")
    except (ValueError, TypeError) as error:
        raise ValueError("A valid Fernet key is required to store the TOTP secret.") from error


def decrypt_totp_secret(ciphertext: str, key: str) -> str:
    try:
        return Fernet(key.encode("ascii")).decrypt(ciphertext.encode("ascii")).decode("ascii")
    except (InvalidToken, ValueError, TypeError, UnicodeError) as error:
        raise ValueError("The stored TOTP secret could not be decrypted.") from error
