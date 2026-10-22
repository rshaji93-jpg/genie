from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections.abc import Iterator
from typing import Any

import requests

LOGGER = logging.getLogger("genie.ai_providers")
RESPONSE_STYLE_INSTRUCTION = (
    "For conversational responses, use natural, fluent plain prose. Do not use Markdown "
    "formatting, bullet lists, headings, hashes, or asterisks. Preserve standard formal "
    "notation, equations, and variables when the user asks for mathematics or science."
)


class MultiProviderPool:
    """Fail over through configured OpenAI-compatible providers in priority order."""

    def __init__(self) -> None:
        self._timeout = (4, 20)
        self._probe_timeout = (4, 4)
        self._unavailable_for_seconds = 30
        self._unavailable_until: dict[str, float] = {}
        self._health_lock = threading.Lock()

    def _providers(self) -> list[tuple[str, str, str, dict[str, str]]]:
        configured = (
            (
                "groq",
                "GROQ_API_KEY",
                "https://api.groq.com/openai/v1/chat/completions",
                (os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),),
            ),
            (
                "siliconflow",
                "SILICONFLOW_API_KEY",
                "https://api.siliconflow.com/v1/chat/completions",
                (os.getenv("SILICONFLOW_MODEL", "deepseek-ai/DeepSeek-V3"),),
            ),
            (
                "nvidia-nim",
                "NVIDIA_NIM_API_KEY",
                "https://integrate.api.nvidia.com/v1/chat/completions",
                (os.getenv("NVIDIA_NIM_MODEL", "meta/llama-3.3-70b-instruct"),),
            ),
            (
                "openrouter",
                "OPENROUTER_API_KEY",
                "https://openrouter.ai/api/v1/chat/completions",
                (
                    (os.getenv("OPENROUTER_MODEL", "").strip(),)
                    if os.getenv("OPENROUTER_MODEL", "").strip()
                    else (
                        "meta-llama/llama-3.2-3b-instruct:free",
                        "google/gemma-2-9b-it:free",
                        "mistralai/mistral-7b-instruct:free",
                    )
                ),
            ),
            (
                "mistral",
                "MISTRAL_API_KEY",
                "https://api.mistral.ai/v1/chat/completions",
                (os.getenv("MISTRAL_MODEL", "mistral-small-latest"),),
            ),
            (
                "github",
                "GITHUB_MODELS_TOKEN",
                "https://models.inference.ai.azure.com/chat/completions",
                (os.getenv("GITHUB_MODELS_MODEL", "gpt-4o-mini"),),
            ),
            (
                "huggingface",
                "HF_TOKEN",
                "https://router.huggingface.co/v1/chat/completions",
                (os.getenv("HUGGINGFACE_MODEL", "meta-llama/Llama-3.1-8B-Instruct"),),
            ),
        )
        providers: list[tuple[str, str, str, dict[str, str]]] = []
        for name, env_name, url, models in configured:
            token = os.getenv(env_name, "").strip().strip("\"'")
            if not token:
                continue
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }
            if name == "openrouter" and os.getenv("GENIE_PUBLIC_ORIGIN"):
                headers["HTTP-Referer"] = os.environ["GENIE_PUBLIC_ORIGIN"]
            providers.extend((name, url, model, headers) for model in models)
        priority = {
            "groq": 0,
            "openrouter": 1,
            "mistral": 2,
            "nvidia-nim": 3,
            "siliconflow": 4,
        }
        providers.sort(key=lambda provider: priority.get(provider[0], 5))
        return providers

    @staticmethod
    def _messages(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
        return [{"role": "system", "content": RESPONSE_STYLE_INSTRUCTION}] + [
            {
                "role": "assistant" if item.get("role") == "model" else str(item.get("role", "user")),
                "content": str(item.get("content") or "")[:20_000],
            }
            for item in messages[-40:]
        ]

    def _ordered(self) -> list[tuple[str, str, str, dict[str, str]]]:
        return [
            provider
            for provider in self._providers()
            if self._provider_available(provider[0])
        ]

    def configured(self) -> bool:
        return bool(self._providers())

    def _provider_available(self, name: str) -> bool:
        with self._health_lock:
            unavailable_until = self._unavailable_until.get(name)
            if unavailable_until is None:
                return True
            if unavailable_until <= time.monotonic():
                del self._unavailable_until[name]
                return True
            return False

    def _set_provider_health(self, name: str, healthy: bool) -> None:
        with self._health_lock:
            if healthy:
                self._unavailable_until.pop(name, None)
            else:
                self._unavailable_until[name] = (
                    time.monotonic() + self._unavailable_for_seconds
                )

    def validate_primary_providers(self) -> dict[str, bool]:
        """Probe configured Groq and SiliconFlow endpoints before serving traffic."""
        health: dict[str, bool] = {}
        for name, url, model, headers in self._providers():
            if name not in {"groq", "siliconflow"} or name in health:
                continue
            response = None
            try:
                response = requests.post(
                    url,
                    headers=headers,
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": "Reply with OK."}],
                        "max_tokens": 1,
                        "stream": False,
                    },
                    timeout=self._probe_timeout,
                )
                response.raise_for_status()
                if response.status_code != 200:
                    raise requests.RequestException(
                        f"{name} health probe returned HTTP {response.status_code}."
                    )
                body = response.json()
                text = body["choices"][0]["message"]["content"]
                if not isinstance(text, str) or not text.strip():
                    raise ValueError(f"{name} returned an invalid health-probe response.")
                health[name] = True
                self._set_provider_health(name, healthy=True)
            except (
                requests.RequestException,
                KeyError,
                IndexError,
                TypeError,
                ValueError,
            ) as error:
                health[name] = False
                self._set_provider_health(name, healthy=False)
                LOGGER.warning(
                    "AI provider startup probe failed (%s: %s)",
                    name,
                    type(error).__name__,
                )
            finally:
                if response is not None:
                    try:
                        response.close()
                    except requests.RequestException as error:
                        LOGGER.warning(
                            "AI provider startup probe cleanup failed (%s: %s)",
                            name,
                            type(error).__name__,
                        )
        return health

    def chat(self, messages: list[dict[str, Any]]) -> str:
        errors: list[str] = []
        providers = self._ordered()
        if not providers:
            message = (
                "All configured AI providers are temporarily unavailable."
                if self.configured()
                else "No fallback AI provider keys are configured."
            )
            raise RuntimeError(message)
        for name, url, model, headers in providers:
            if not self._provider_available(name):
                continue
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
                    raise ValueError(f"{name} returned an empty response.")
                self._set_provider_health(name, healthy=True)
                return text
            except (requests.RequestException, KeyError, IndexError, TypeError, ValueError) as error:
                errors.append(f"{name}: {type(error).__name__}")
                if isinstance(error, requests.RequestException):
                    self._set_provider_health(name, healthy=False)
        raise RuntimeError("All configured fallback providers failed (" + ", ".join(errors) + ").")

    def stream(self, messages: list[dict[str, Any]]) -> Iterator[str]:
        errors: list[str] = []
        providers = self._ordered()
        if not providers:
            message = (
                "All configured AI providers are temporarily unavailable."
                if self.configured()
                else "No fallback AI provider keys are configured."
            )
            raise RuntimeError(message)
        for name, url, model, headers in providers:
            if not self._provider_available(name):
                continue
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
                    self._set_provider_health(name, healthy=True)
                    return
                finally:
                    response.close()
            except (requests.RequestException, KeyError, IndexError, TypeError, ValueError) as error:
                errors.append(f"{name}: {type(error).__name__}")
                if isinstance(error, requests.RequestException):
                    self._set_provider_health(name, healthy=False)
        raise RuntimeError("All configured fallback providers failed (" + ", ".join(errors) + ").")


multi_provider_pool = MultiProviderPool()
