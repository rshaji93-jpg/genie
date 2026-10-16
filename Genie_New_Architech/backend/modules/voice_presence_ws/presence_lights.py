from __future__ import annotations

from typing import Literal

Presence = Literal["online", "away", "busy"]


def validate_presence(value: str) -> Presence:
    if value not in {"online", "away", "busy"}:
        raise ValueError("Presence must be online, away, or busy.")
    return value  # type: ignore[return-value]
