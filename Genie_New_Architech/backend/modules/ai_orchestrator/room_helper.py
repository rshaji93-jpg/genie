from __future__ import annotations

from typing import Any

from ..zero_secret_vault.scrubber import scrub_sensitive_text


def prepare_room_context(turns: list[dict[str, Any]]) -> list[dict[str, str]]:
    safe_turns: list[dict[str, str]] = []
    for turn in turns[-20:]:
        content = turn.get("content")
        role = turn.get("role")
        if isinstance(content, str) and role in {"user", "assistant", "model"}:
            safe_turns.append(
                {
                    "role": "assistant" if role == "model" else role,
                    "content": scrub_sensitive_text(content)[:20_000],
                }
            )
    return safe_turns
