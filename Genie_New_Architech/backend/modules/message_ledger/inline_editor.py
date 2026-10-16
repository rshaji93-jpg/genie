from __future__ import annotations

from datetime import datetime, timezone


def edited_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()
