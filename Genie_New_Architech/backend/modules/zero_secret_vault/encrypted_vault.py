from __future__ import annotations

import re

_VAULT_BLOCK = re.compile(r"<encrypted_vault>[\s\S]*?</encrypted_vault>")


def contains_encrypted_vault(text: str) -> bool:
    return _VAULT_BLOCK.search(text) is not None


def mask_vault_blocks(text: str) -> str:
    return _VAULT_BLOCK.sub("[ENCRYPTED_VAULT_BLOCK]", text)
