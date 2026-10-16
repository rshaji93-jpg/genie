from __future__ import annotations

import json
import os
import threading
from collections.abc import Iterator
from typing import Any

import requests


class MultiProviderPool:
    """Fail over through explicitly configured, documented provider APIs."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._next = 0
        self._timeout = (5, 60)

    def _providers(self) -> list[tuple[str, str, str, dict[str, str]]]:
        providers: list[tuple[str, str, str, dict[str, str]]] = []
        configured = (
            (
                "groq",
                "GROQ_API_KEY",
                "https://api.groq.com/openai/v1/chat/completions",
                "llama-3.3-70b-versatile",
            ),
            (
                "mistral",
                "MISTRAL_API_KEY",
                "https://api.mistral.ai/v1/chat/completions",
                "mistral-small-latest",
            ),
            (
                "openrouter",
                "OPENROUTER_API_KEY",
                "https://openrouter.ai/api/v1/chat/completions",
                "",
            ),
            (
                "github",
                "GITHUB_MODELS_TOKEN",
                "https://models.inference.ai.azure.com/chat/completions",
                "gpt-4o-mini",
            ),
            (
                "huggingface",
                "HF_TOKEN",
                "https://router.huggingface.co/v1/chat/completions",
                "meta-llama/Llama-3.1-8B-Instruct",
            ),
        )
        router_models = (
            "meta-llama/llama-3.2-3b-instruct:free",
            "google/gemma-2-9b-it:free",
            "mistralai/mistral-7b-instruct:free",
        )
        for name, env_name, url, default_model in configured:
            token = os.getenv(env_name, "").strip()
            if not token:
                continue
            models = router_models if name == "openrouter" else (default_model,)
            for model in models:
                providers.append(
                    (
                        name,
                        url,
                        model,
                        {
                            "Authorization": f"Bearer {token}",
                            "Content-Type": "application/json",
                            **(
                                {"HTTP-Referer": os.getenv("GENIE_PUBLIC_ORIGIN", "")}
                                if name == "openrouter" and os.getenv("GENIE_PUBLIC_ORIGIN")
                                else {}
                            ),
                        },
                    )
                )
        return providers

    @staticmethod
    def _messages(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
        return [
            {
                "role": "assistant" if item.get("role") == "model" else str(item.get("role", "user")),
                "content": str(item.get("content") or "")[:20_000],
            }
            for item in messages[-40:]
        ]

    def _ordered(self) -> list[tuple[str, str, str, dict[str, str]]]:
        providers = self._providers()
        if not providers:
            return []
        with self._lock:
            start = self._next % len(providers)
            self._next = (start + 1) % len(providers)
        return providers[start:] + providers[:start]

    def configured(self) -> bool:
        return bool(self._providers())

    def chat(self, messages: list[dict[str, Any]]) -> str:
        errors: list[str] = []
        providers = self._ordered()
        if not providers:
            raise RuntimeError("No fallback AI provider keys are configured.")
        for name, url, model, headers in providers:
            try:
                response = requests.post(
                    url,
                    headers=headers,
                    json={"model": model, "messages": self._messages(messages), "stream": False},
                    timeout=self._timeout,
                )
                response.raise_for_status()
                body = response.json()
                text = body["choices"][0]["message"]["content"]
                if not isinstance(text, str) or not text:
                    raise RuntimeError(f"{name} returned an empty response.")
                return text
            except (requests.RequestException, KeyError, IndexError, TypeError, ValueError) as error:
                errors.append(f"{name}: {type(error).__name__}")
        raise RuntimeError("All configured fallback providers failed (" + ", ".join(errors) + ").")

    def stream(self, messages: list[dict[str, Any]]) -> Iterator[str]:
        errors: list[str] = []
        providers = self._ordered()
        if not providers:
            raise RuntimeError("No fallback AI provider keys are configured.")
        for name, url, model, headers in providers:
            try:
                response = requests.post(
                    url,
                    headers={**headers, "Accept": "text/event-stream"},
                    json={"model": model, "messages": self._messages(messages), "stream": True},
                    timeout=self._timeout,
                    stream=True,
                )
                response.raise_for_status()
                try:
                    for line in response.iter_lines(decode_unicode=True):
                        if not line or not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if payload == "[DONE]":
                            return
                        chunk = json.loads(payload)
                        delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                        if isinstance(delta, str) and delta:
                            yield delta
                    return
                finally:
                    response.close()
            except (requests.RequestException, KeyError, IndexError, TypeError, ValueError) as error:
                errors.append(f"{name}: {type(error).__name__}")
        raise RuntimeError("All configured fallback providers failed (" + ", ".join(errors) + ").")


multi_provider_pool = MultiProviderPool()
