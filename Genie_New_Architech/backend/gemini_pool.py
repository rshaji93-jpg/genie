from __future__ import annotations

import json
import os
import threading
import time
from collections.abc import Iterator
from typing import Any

import requests

try:
    from .modules.ai_orchestrator.multi_provider_pool import multi_provider_pool
except ImportError:
    from modules.ai_orchestrator.multi_provider_pool import multi_provider_pool


class GeminiPool:
    """Small Gemini client. User-visible metering is independent of provider billing."""

    def __init__(self) -> None:
        free_keys = [
            value.strip()
            for value in (
                os.getenv("GENIE_GEMINI_FREE_KEYS")
                or os.getenv("GEMINI_FREE_KEYS")
                or ""
            ).split(",")
            if value.strip()
        ]
        free_keys.extend(
            value.strip()
            for index in range(1, 10)
            if (value := os.getenv(f"GEMINI_FREE_KEY_{index}", "").strip())
        )
        free_keys.extend(
            value.strip()
            for value in (
                os.getenv("GENIE_GEMINI_API_KEY", ""),
                os.getenv("GEMINI_API_KEY", ""),
            )
            if value.strip()
        )
        self.free_keys = list(dict.fromkeys(free_keys))
        self.master_keys = list(dict.fromkeys(
            value.strip()
            for value in (
                os.getenv("GENIE_GEMINI_MASTER_KEYS")
                or os.getenv("GEMINI_MASTER_KEYS")
                or os.getenv("GENIE_GEMINI_MASTER_KEY")
                or os.getenv("GEMINI_MASTER_KEY")
                or ""
            ).split(",")
            if value.strip()
        ))
        self.pro_model = os.getenv("GENIE_PRO_MODEL", "gemini-2.5-flash")
        self.master_model = os.getenv("GENIE_MASTER_MODEL", "gemini-2.5-pro")
        self.timeout = (5, 90)
        self.cooldowns: dict[str, float] = {}
        self._next_free_key = 0
        self._lock = threading.Lock()

    def _generate(
        self,
        model: str,
        messages: list[dict[str, Any]],
        stream: bool = False,
        master: bool = False,
        thinking_level: str = "pro",
    ) -> requests.Response:
        keys = self.master_keys if master else self.free_keys
        if not keys:
            key_type = "Genie Master" if master else "Genie Pro"
            raise RuntimeError(f"No {key_type} Gemini API keys are configured.")
        with self._lock:
            now = time.time()
            available = [key for key in keys if self.cooldowns.get(key, 0) <= now]
            if not available:
                retry_seconds = max(1, int(min(self.cooldowns.get(key, now) for key in keys) - now))
                raise RuntimeError(f"Gemini keys are cooling down. Retry in {retry_seconds} seconds.")
            if not master and self.free_keys:
                start = self._next_free_key % len(self.free_keys)
                ordered = self.free_keys[start:] + self.free_keys[:start]
                available_set = set(available)
                available = [key for key in ordered if key in available_set]
                self._next_free_key = (start + 1) % len(self.free_keys)

        if thinking_level not in {"light", "pro", "deep"}:
            raise ValueError("Thinking level must be light, pro, or deep.")
        payload: dict[str, Any] = {"contents": self._contents(messages)}
        if thinking_level != "pro":
            payload["generationConfig"] = {
                "thinkingConfig": {
                    "thinkingBudget": {"light": 0, "deep": 24576}[thinking_level]
                }
            }
        action = "streamGenerateContent?alt=sse" if stream else "generateContent"
        last_error: Exception | None = None
        for key in available:
            try:
                response = requests.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:{action}",
                    params={"key": key},
                    json=payload,
                    headers={"Accept": "text/event-stream" if stream else "application/json"},
                    timeout=self.timeout,
                    stream=stream,
                )
                response.raise_for_status()
                return response
            except requests.RequestException as error:
                last_error = error
                status_code = error.response.status_code if error.response is not None else None
                if status_code in (400, 401, 403, 429) or status_code is None:
                    cooldown = 60 if status_code == 429 else 300
                    with self._lock:
                        self.cooldowns[key] = time.time() + cooldown
                    continue
                raise
        if last_error:
            raise RuntimeError("All configured Gemini keys are unavailable.") from last_error
        raise RuntimeError("No operational Gemini API keys are available.")

    def availability(self) -> dict[str, int | bool]:
        now = time.time()

        def remaining(keys: list[str]) -> int:
            if not keys:
                return 0
            if any(self.cooldowns.get(key, 0) <= now for key in keys):
                return 0
            return max(1, int(min(self.cooldowns.get(key, now) for key in keys) - now))

        return {
            "genie_pro_configured": bool(self.free_keys),
            "genie_pro_available": bool(self.free_keys) and remaining(self.free_keys) == 0,
            "genie_pro_retry_seconds": remaining(self.free_keys),
            "genie_master_configured": bool(self.master_keys),
            "genie_master_available": bool(self.master_keys) and remaining(self.master_keys) == 0,
            "genie_master_retry_seconds": remaining(self.master_keys),
        }

    @staticmethod
    def _contents(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        contents: list[dict[str, Any]] = []
        for message in messages[-40:]:
            role = "model" if message.get("role") == "assistant" else "user"
            text = str(message.get("content") or "")[:20_000]
            parts: list[dict[str, Any]] = [{"text": text}]
            image_data = message.get("image_data")
            if isinstance(image_data, dict):
                mime_type = image_data.get("mime_type")
                data = image_data.get("data")
                if (
                    isinstance(mime_type, str)
                    and mime_type.startswith(("image/", "audio/"))
                    and isinstance(data, str)
                    and len(data) <= 11_000_000
                ):
                    parts.append({"inline_data": {"mime_type": mime_type, "data": data}})
            contents.append({"role": role, "parts": parts})
        return contents

    def _response_text(self, response: requests.Response) -> str:
        body = response.json()
        candidates = body.get("candidates", [])
        try:
            return "".join(
                part.get("text", "")
                for part in candidates[0]["content"]["parts"]
                if isinstance(part.get("text"), str)
            )
        except (IndexError, KeyError, TypeError) as error:
            raise RuntimeError("Gemini returned no text response.") from error

    def chat(
        self,
        messages: list[dict[str, Any]],
        master: bool = False,
        thinking_level: str = "pro",
    ) -> str:
        try:
            response = self._generate(
                self.master_model if master else self.pro_model,
                messages,
                master=master,
                thinking_level=thinking_level,
            )
        except RuntimeError:
            if master or not multi_provider_pool.configured():
                raise
            return multi_provider_pool.chat(messages)
        try:
            return self._response_text(response)
        finally:
            response.close()

    def stream(
        self,
        messages: list[dict[str, Any]],
        master: bool = False,
        thinking_level: str = "pro",
    ) -> Iterator[str]:
        try:
            response = self._generate(
                self.master_model if master else self.pro_model,
                messages,
                stream=True,
                master=master,
                thinking_level=thinking_level,
            )
        except RuntimeError:
            if master or not multi_provider_pool.configured():
                raise
            yield from multi_provider_pool.stream(messages)
            return
        try:
            for line in response.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data:"):
                    continue
                payload = json.loads(line[5:].strip())
                candidates = payload.get("candidates", [])
                if not candidates:
                    continue
                for part in candidates[0].get("content", {}).get("parts", []):
                    text = part.get("text")
                    if isinstance(text, str) and text:
                        yield text
        finally:
            response.close()

    def silent_pro_summarize(self, room_messages: list[dict[str, Any]]) -> str:
        messages = [
            {
                "role": "user",
                "content": (
                    "Summarize the key goals, open questions, and relevant context in "
                    "three concise bullets. This is an internal context-preparation "
                    "step; do not answer the user's question yet.\n\n"
                    + "\n".join(
                        f"{item.get('sender_name', 'Member')}: {item.get('content', '')}"
                        for item in room_messages[-20:]
                        if isinstance(item.get("content"), str)
                    )[:12_000]
                ),
            }
        ]
        return self.chat(messages)

    @staticmethod
    def calculate_dynamic_master_tokens(
        prompt: str,
        history_count: int,
        total_context_chars: int = 0,
        refinement_cycle: int = 0,
    ) -> dict[str, Any]:
        tokens = 1
        breakdown = ["Base review (1)"]
        if history_count >= 12 or total_context_chars > 4_000:
            tokens += 1
            breakdown.append("Strong conversation context (+1)")
        if refinement_cycle:
            tokens += refinement_cycle
            breakdown.append(f"Refinement cycle {refinement_cycle} (+{refinement_cycle})")
        if any(term in prompt.casefold() for term in ("architecture", "security audit", "full code")):
            tokens += 1
            breakdown.append("Deep synthesis (+1)")
        return {
            "tokens_burned": tokens,
            "breakdown": " · ".join(breakdown),
        }


gemini_pool = GeminiPool()
