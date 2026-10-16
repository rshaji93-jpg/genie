from __future__ import annotations

import json
from typing import Any


MAX_SIGNAL_BYTES = 32_000
MAX_VOICE_PARTICIPANTS = 8
MAX_ROOM_VIEWERS = 12


def valid_signal_payload(payload: Any) -> bool:
    try:
        return isinstance(payload, dict) and len(json.dumps(payload)) <= MAX_SIGNAL_BYTES
    except (TypeError, ValueError):
        return False
