from __future__ import annotations

import json
from typing import Any


def validate_subscription(value: dict[str, Any]) -> str:
    endpoint = value.get("endpoint")
    keys = value.get("keys")
    if (
        not isinstance(endpoint, str)
        or not endpoint.startswith("https://")
        or len(endpoint) > 2048
        or not isinstance(keys, dict)
        or not isinstance(keys.get("p256dh"), str)
        or not isinstance(keys.get("auth"), str)
    ):
        raise ValueError("A valid HTTPS Web Push subscription is required.")
    return json.dumps(
        {"endpoint": endpoint, "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]}},
        separators=(",", ":"),
    )
