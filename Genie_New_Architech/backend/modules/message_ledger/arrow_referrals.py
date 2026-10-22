from __future__ import annotations

from typing import Literal

ArrowAction = Literal["quote", "forward", "refer_to_genie"]


def validate_arrow_action(value: str) -> ArrowAction:
    if value not in {"quote", "forward", "refer_to_genie"}:
        raise ValueError("Unsupported message referral action.")
    return value  # type: ignore[return-value]
