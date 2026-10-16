from __future__ import annotations

import json
from collections.abc import Iterator


def parse_api_key_sse(lines: Iterator[str]) -> Iterator[str]:
    """Decode OpenAI-compatible SSE without accepting browser-session credentials."""
    for line in lines:
        if not line or not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload == "[DONE]":
            return
        try:
            event = json.loads(payload)
        except json.JSONDecodeError as error:
            raise RuntimeError("Provider returned malformed SSE data.") from error
        delta = event.get("choices", [{}])[0].get("delta", {}).get("content")
        if isinstance(delta, str) and delta:
            yield delta
