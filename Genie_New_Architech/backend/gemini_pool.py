from __future__ import annotations

import asyncio
import os
import re
import heapq
import hashlib
import itertools
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from collections.abc import Iterator
import requests
from dotenv import load_dotenv

logger = logging.getLogger(__name__)
_HERE = Path(__file__).resolve().parent
_BACKEND_ENV_FILE = _HERE / ".env"
if _BACKEND_ENV_FILE.is_file():
    load_dotenv(_BACKEND_ENV_FILE, override=False)
DEFAULT_FLASH_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-flash-latest",
]
ACTIVE_MODEL = DEFAULT_FLASH_MODELS[0]
RETIRED_KEY_SUFFIX = "PjLA"
GEMINI_KEY_VARIABLE_NAMES = {
    "GEMINI_FREE_KEYS",
    "GENIE_GEMINI_FREE_KEYS",
    "GEMINI_FREE_POOL_KEYS",
    "GEMINI_API_KEYS",
    "GEMINI_API_KEY",
    "GENIE_GEMINI_API_KEYS",
    "GENIE_GEMINI_API_KEY",
}
PREFERRED_KEY_SUFFIXES = (
    "_AqA",
    "qwZw",
    "9mnQ",
    "kYeg",
    "LUmQ",
    "zYXA",
    "UDuQ",
    "5YzQ",
    "qwUA",
)
_MODEL_DISCOVERY_CACHE: dict[str, tuple[float, list[str]]] = {}
_MODEL_DISCOVERY_CACHE_LOCK = threading.Lock()


def load_gemini_keys() -> list[str]:
    """Load Google key tokens from the backend process environment."""
    extracted: list[str] = []

    def collect(raw_text: str, *, allow_long_tokens: bool = False) -> None:
        for raw_token in raw_text.split(","):
            token = (
                raw_token.replace("\\r", "")
                .replace("\\n", "")
                .strip()
                .strip("\"'")
                .strip()
                .strip("\r\n\t \"'[](){}")
            )
            if not token or RETIRED_KEY_SUFFIX in token:
                continue
            if not (
                token.startswith("AIza")
                or token.startswith("AQ.")
                or (allow_long_tokens and len(token) > 30)
            ):
                continue
            if token not in extracted:
                extracted.append(token)

    for name, value in os.environ.items():
        normalized_name = name.upper()
        collect(
            str(value),
            allow_long_tokens=(
                normalized_name in GEMINI_KEY_VARIABLE_NAMES
                or ("GEMINI" in normalized_name and "KEY" in normalized_name)
            ),
        )

    return extracted


def _model_sort_key(model: str) -> tuple[int, int, str]:
    match = re.search(r"gemini-(\d+)(?:\.(\d+))?-(flash|pro)", model.casefold())
    if match:
        major = int(match.group(1))
        minor = int(match.group(2) or 0)
        tier = 1 if match.group(3) == "flash" else 0
        return major * 100 + minor, tier, model
    if "flash-latest" in model.casefold():
        return 10_000, 1, model
    return 0, 0, model


def discover_active_google_models(
    api_key: str, *, force_refresh: bool = False, timeout: float = 4
) -> list[str]:
    """Discover callable Gemini Flash/Pro models, newest versions first."""
    key = api_key.strip().strip("\"'").strip()
    if not key:
        return []
    cache_key = hashlib.sha256(key.encode("utf-8")).hexdigest()
    with _MODEL_DISCOVERY_CACHE_LOCK:
        cached = _MODEL_DISCOVERY_CACHE.get(cache_key)
        if cached and not force_refresh and time.monotonic() - cached[0] < 24 * 60 * 60:
            return list(cached[1])
    try:
        response = requests.get(
            "https://generativelanguage.googleapis.com/v1beta/models",
            params={"key": key},
            timeout=max(0.05, min(4, timeout)),
        )
        if response.status_code != 200:
            return []
        models = response.json().get("models", [])
    except (requests.RequestException, ValueError, TypeError):
        logger.warning("Live Google model discovery failed for a pool key")
        return []

    discovered: set[str] = set()
    for item in models:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", ""))
        methods = item.get("supportedGenerationMethods", [])
        if "generateContent" not in methods:
            continue
        model_id = name
        while model_id.startswith("models/"):
            model_id = model_id.removeprefix("models/")
        if "gemini-" not in model_id.casefold():
            continue
        if not re.search(r"(?:flash|pro)", model_id.casefold()):
            continue
        discovered.add(model_id)
    ordered = sorted(discovered, key=_model_sort_key, reverse=True)
    if ordered:
        with _MODEL_DISCOVERY_CACHE_LOCK:
            _MODEL_DISCOVERY_CACHE[cache_key] = (time.monotonic(), ordered)
    return ordered
DYNAMIC_VOICE_SYSTEM_PROMPT = (
    "You are Personal AI Genie, a warm, natural, real-time multilingual AI agent. "
    "CRITICAL LANGUAGE & VOICE ADAPTATION RULES (IDEA 14): "
    "1. Automatically detect the language, script, and conversational dialect of the user's latest message "
    "(including Tamil, Tanglish, Hindi, Hinglish, Malayalam, Telugu, Kannada, Bengali, or English). "
    "2. Immediately respond in the EXACT same language or dialect without locking output to English. "
    "If the user switches languages mid-conversation, switch with them effortlessly on the very next turn. "
    "3. Keep your tone natural, human-like, concise, and expressive so it sounds authentic when spoken aloud by the voice module. "
    "For conversational replies, use fluent plain prose without Markdown formatting, bullet lists, "
    "headings, hashes, or asterisks. Preserve standard formal notation, equations, and variables "
    "when the user asks for mathematics or science."
)


class GeminiPool:
    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._waiters: list[tuple[int, int, object]] = []
        self._sequence = itertools.count()
        self._busy_keys: set[str] = set()
        self._key_backoff_until: dict[str, float] = {}
        self._invalid_keys: set[str] = set()
        self._unhealthy_keys: set[str] = set()
        self._dead_keys: set[str] = set()
        self._cooldown_keys: set[str] = set()
        self._key_health: dict[str, str] = {}
        self._extracted_keys: list[str] = []
        self.last_pool_error = ""
        self._health_probe_ran = False
        self.routing_ready = asyncio.Event()
        self._telemetry_pool_enabled_event = asyncio.Event()
        self.active_model = ACTIVE_MODEL
        self._master_pool_enabled = False
        self._telemetry_gemini_pool_enabled = False
        self._overflow_requests: dict[str, dict[str, Any]] = {}
        self._key_index = 0
        self.free_keys: list[str] = []
        self.master_key: str = ""
        self._discover_keys()
        self._key_health = {key: "active" for key in self.free_keys}
        self.model_name = DEFAULT_FLASH_MODELS[0]
        self.active_model = self.model_name
        self.fallback_models = list(DEFAULT_FLASH_MODELS)
        self.available = bool(self.free_keys or self.master_key)

    def _discover_keys(self) -> None:
        self._invalid_keys.clear()
        self._unhealthy_keys.clear()
        self._dead_keys.clear()
        self._cooldown_keys.clear()
        self._key_backoff_until.clear()

        extracted = load_gemini_keys()

        preferred_rank = {
            suffix.casefold(): index
            for index, suffix in enumerate(PREFERRED_KEY_SUFFIXES)
        }
        extracted.sort(
            key=lambda key: (
                0 if key.casefold().endswith(tuple(s.casefold() for s in PREFERRED_KEY_SUFFIXES)) else 1,
                next(
                    (
                        rank
                        for suffix, rank in preferred_rank.items()
                        if key.casefold().endswith(suffix)
                    ),
                    len(preferred_rank),
                ),
            )
        )

        self._extracted_keys = extracted
        self.free_keys = list(extracted)
        self.master_key = ""

    def health_probe(self, model: str | None = None) -> dict[str, str]:
        """Verify free-pool keys via a bounded model metadata request."""
        keys = list(self.free_keys)
        if not keys:
            self._health_probe_ran = True
            return {}

        def probe(key: str) -> tuple[str, str]:
            try:
                if model:
                    response = requests.get(
                        "https://generativelanguage.googleapis.com/v1beta/models/"
                        f"{self._model_path(model)}",
                        params={"key": key},
                        timeout=4,
                    )
                    if response.status_code == 200:
                        return key, "healthy"
                    if response.status_code in {401, 403}:
                        return key, "invalid"
                    return key, f"unavailable-{response.status_code}"
                response = requests.get(
                    "https://generativelanguage.googleapis.com/v1beta/models",
                    params={"key": key, "pageSize": 1},
                    timeout=4,
                )
                if response.status_code == 200:
                    return key, "healthy"
                if response.status_code in {401, 403}:
                    return key, "invalid"
                return key, f"unavailable-{response.status_code}"
            except requests.RequestException:
                return key, "unreachable"

        with ThreadPoolExecutor(max_workers=min(9, len(keys))) as executor:
            futures = [executor.submit(probe, key) for key in keys]
            results = [future.result() for future in as_completed(futures)]

        with self._condition:
            for key, status in results:
                if status == "healthy":
                    self._key_health[key] = "active"
                    self._invalid_keys.discard(key)
                    self._unhealthy_keys.discard(key)
                    self._key_backoff_until.pop(key, None)
                elif status == "invalid":
                    self._invalid_keys.add(key)
                    self._key_health[key] = "invalid"
                else:
                    self._key_health[key] = "active"
                    self._invalid_keys.discard(key)
                    self._unhealthy_keys.discard(key)
                    self._key_backoff_until.pop(key, None)
            self._health_probe_ran = True
            self._condition.notify_all()
        for key, status in results:
            if status != "healthy":
                logger.warning("Gemini free-pool health probe: key unavailable (%s)", status)
        return {self._key_fingerprint(key): status for key, status in results}

    async def run_daily_model_and_key_probe(self) -> None:
        """Probe the free pool only while admin telemetry routing is enabled."""
        while True:
            if not self.telemetry_gemini_pool_enabled:
                self.routing_ready.set()
                await self._telemetry_pool_enabled_event.wait()
                continue
            try:
                await asyncio.to_thread(self._refresh_model_and_key_routes)
            except Exception:
                logger.exception("Gemini model and key health probe failed")
            finally:
                self.routing_ready.set()
            await asyncio.sleep(24 * 60 * 60)

    def _refresh_model_and_key_routes(self) -> None:
        self._discover_keys()
        self._key_health = {key: "active" for key in self.free_keys}
        self._health_probe_ran = False
        models = self.discover_models(force_refresh=True)
        active_model = self.active_model or (models[0] if models else "")
        if active_model:
            self.health_probe(model=active_model)
        else:
            logger.warning(
                "Gemini model discovery returned no active model; retaining default routing model %s",
                self.model_name,
            )
            self.health_probe()

    def _key_fingerprint(self, key: str) -> str:
        if key not in self.free_keys:
            return "key-unknown"
        return f"key-{self.free_keys.index(key) + 1}"

    def discover_models(
        self,
        timeout: float = 4,
        deadline: float | None = None,
        force_refresh: bool = False,
    ) -> list[str]:
        """Refresh the verified text-generation Flash/Pro model list from Google."""
        discovery_keys = [key for key in self.free_keys if key not in self._invalid_keys]
        if not discovery_keys:
            return self.fallback_models

        verified: list[str] = []
        discovery_deadline = deadline or (time.monotonic() + min(4, timeout))
        for key in discovery_keys:
            remaining = discovery_deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                verified = discover_active_google_models(
                    key,
                    force_refresh=force_refresh,
                    timeout=min(4, timeout, remaining),
                )
                if verified:
                    break
            except (requests.RequestException, ValueError, TypeError) as error:
                logger.warning("Gemini model discovery failed (%s)", type(error).__name__)

        if verified:
            flash_models = [
                model for model in verified if re.search(r"flash", model, re.IGNORECASE)
            ]
            ordered_models = flash_models or verified
            self.fallback_models = list(
                dict.fromkeys([*ordered_models, *DEFAULT_FLASH_MODELS])
            )
        if self.fallback_models:
            self.model_name = self.fallback_models[0]
            self.active_model = self.model_name
            global ACTIVE_MODEL
            ACTIVE_MODEL = self.active_model
        return self.fallback_models

    @staticmethod
    def _normalize_model_id(model: str) -> str:
        model_id = model.strip()
        while model_id.startswith("models/"):
            model_id = model_id.removeprefix("models/")
        return model_id.strip()

    def _acquire_key(self, priority: int, timeout: float = 4) -> str:
        waiter = object()
        deadline = time.monotonic() + max(0, timeout)
        with self._condition:
            ticket = (priority, next(self._sequence), waiter)
            heapq.heappush(self._waiters, ticket)
            while True:
                now = time.monotonic()
                available = [
                    key for key in self.free_keys
                    if key not in self._busy_keys
                    and key not in self._invalid_keys
                    and key not in self._unhealthy_keys
                    and self._key_backoff_until.get(key, 0) <= now
                ]
                if self._waiters and self._waiters[0] == ticket and available:
                    heapq.heappop(self._waiters)
                    key = available[self._key_index % len(available)]
                    self._key_index += 1
                    self._busy_keys.add(key)
                    return key
                usable_keys = [
                    key for key in self.free_keys
                    if key not in self._invalid_keys and key not in self._unhealthy_keys
                ]
                if not usable_keys:
                    self._waiters.remove(ticket)
                    heapq.heapify(self._waiters)
                    raise RuntimeError("FREE_POOL_EXHAUSTED")
                if not available and not (self._busy_keys & set(usable_keys)):
                    self._waiters.remove(ticket)
                    heapq.heapify(self._waiters)
                    raise RuntimeError("FREE_POOL_EXHAUSTED")
                remaining = deadline - now
                if remaining <= 0:
                    self._waiters.remove(ticket)
                    heapq.heapify(self._waiters)
                    raise RuntimeError("FREE_POOL_EXHAUSTED")
                self._condition.wait(timeout=min(remaining, 0.1))

    def _release_key(self, key: str) -> None:
        with self._condition:
            self._busy_keys.discard(key)
            self._condition.notify_all()

    @staticmethod
    def _is_invalid_key_response(status_code: int, response_text: str) -> bool:
        return status_code in {400, 401} and any(
            marker in response_text.casefold()
            for marker in ("api_key_invalid", "unauthenticated", "invalid api key")
        )

    @staticmethod
    def _model_path(model: str) -> str:
        return GeminiPool._normalize_model_id(model)

    def _mark_invalid_key(self, key: str, status_code: int) -> None:
        with self._condition:
            self._invalid_keys.add(key)
            self._key_health[key] = f"invalid-{status_code}"
            self._condition.notify_all()
        logger.warning(
            "Gemini API key rejected by provider; rotating to another key (HTTP %s)",
            status_code,
        )

    def set_master_pooling(self, enabled: bool) -> None:
        with self._condition:
            self._master_pool_enabled = enabled
            self._condition.notify_all()

    @property
    def telemetry_gemini_pool_enabled(self) -> bool:
        with self._condition:
            return self._telemetry_gemini_pool_enabled

    def set_telemetry_gemini_pool(self, enabled: bool) -> None:
        with self._condition:
            self._telemetry_gemini_pool_enabled = enabled
            self._condition.notify_all()
        if enabled:
            self._telemetry_pool_enabled_event.set()
        else:
            self._telemetry_pool_enabled_event.clear()
        logger.info(
            "[AI_ROUTING] Admin telemetry Gemini free pool %s",
            "enabled" if enabled else "disabled",
        )

    def master_pool_status(self) -> dict[str, Any]:
        with self._condition:
            return {
                "enabled": self._master_pool_enabled,
                "requests": [
                    {key: value for key, value in item.items() if key != "event"}
                    for item in self._overflow_requests.values()
                    if item["status"] == "pending"
                ],
            }

    def decide_overflow(self, request_id: str, accept: bool) -> bool:
        with self._condition:
            item = self._overflow_requests.get(request_id)
            if not item or item["status"] != "pending":
                return False
            if accept and not self._master_pool_enabled:
                raise RuntimeError("Enable master-key pooling before accepting overflow.")
            item["status"] = "accepted" if accept else "rejected"
            item["event"].set()
            return True

    def _stage_overflow(self, requester_sub: str, timeout: float) -> str:
        request_id = str(uuid.uuid4())
        event = threading.Event()
        with self._condition:
            self._overflow_requests[request_id] = {
                "id": request_id,
                "requester_sub": requester_sub,
                "created_at": time.time(),
                "status": "pending",
                "event": event,
            }
        if not event.wait(timeout=max(0, timeout)):
            with self._condition:
                self._overflow_requests.pop(request_id, None)
            raise RuntimeError("FREE_POOL_EXHAUSTED")
        with self._condition:
            item = self._overflow_requests.pop(request_id, None)
            if not item or item["status"] != "accepted" or not self._master_pool_enabled:
                raise RuntimeError("FREE_POOL_REJECTED")
        return request_id

    def _next_key(self, master: bool = False) -> str:
        if master:
            if not self.master_key:
                raise RuntimeError("The personal Gemini Master key is not configured.")
            return self.master_key
        if self.free_keys:
            return self._acquire_key(priority=10)
        raise RuntimeError("FREE_POOL_EXHAUSTED")

    def detect_tts_lang(self, text: str, fallback: str = "en") -> str:
        if not text:
            return fallback
        if re.search(r"[\u0B80-\u0BFF]", text):
            return "ta"
        if re.search(r"[\u0900-\u097F]", text):
            return "hi"
        if re.search(r"[\u0D00-\u0D7F]", text):
            return "ml"
        if re.search(r"[\u0C00-\u0C7F]", text):
            return "te"
        if re.search(r"[\u0C80-\u0CFF]", text):
            return "kn"
        if re.search(r"[\u0980-\u09FF]", text):
            return "bn"
        return fallback

    def _call_google(self, messages: Any, master: bool = False, **kwargs: Any) -> str:
        deadline = float(kwargs.pop("_deadline", time.monotonic() + 5))
        system_instructions: list[str] = []
        if isinstance(messages, str):
            contents = [{"role": "user", "parts": [{"text": messages}]}]
        elif isinstance(messages, list):
            contents = []
            for m in messages:
                if isinstance(m, str):
                    contents.append({"role": "user", "parts": [{"text": m}]})
                elif isinstance(m, dict):
                    message_role = str(m.get("role", "")).lower()
                    txt = m.get("content") or m.get("text") or ""
                    if not txt and isinstance(m.get("parts"), list):
                        txt = "".join(str(p.get("text", "")) for p in m["parts"] if isinstance(p, dict))
                    if txt:
                        if message_role == "system":
                            system_instructions.append(str(txt))
                            continue
                        role = "model" if message_role in ("assistant", "model", "ai") else "user"
                        contents.append({"role": role, "parts": [{"text": txt}]})
            if not contents:
                contents = [{"role": "user", "parts": [{"text": "Hello"}]}]
        else:
            contents = [{"role": "user", "parts": [{"text": str(messages)}]}]

        sys_prompt = "\n\n".join(
            [
                str(kwargs.get("system_instruction") or DYNAMIC_VOICE_SYSTEM_PROMPT),
                *system_instructions,
            ]
        )
        if master:
            key_attempts = [self.master_key] if self.master_key else []
            if not key_attempts:
                raise RuntimeError("The personal Gemini Master key is not configured.")
        else:
            key_attempts = [None] * len(self.free_keys)
            if not key_attempts:
                reason = (
                    "No valid Google API keys were extracted from "
                    "GEMINI_FREE_POOL_KEYS, GEMINI_API_KEYS, or GEMINI_API_KEY."
                )
                self.last_pool_error = reason
                logger.error("[GEMINI_POOL] FREE_POOL_EXHAUSTED: %s", reason)
                raise RuntimeError(f"FREE_POOL_EXHAUSTED: {reason}")
        priority = int(kwargs.get("priority", 10))
        models = list(self.fallback_models)
        last_err = ""

        for _ in key_attempts:
            if time.monotonic() >= deadline:
                break
            try:
                key = self._next_key(master=master) if master else self._acquire_key(
                    priority, timeout=deadline - time.monotonic()
                )
            except RuntimeError as error:
                if not master and self.free_keys and all(
                    candidate in self._invalid_keys for candidate in self.free_keys
                ):
                    raise RuntimeError("GEMINI_KEYS_INVALID") from error
                raise
            try:
                pending_models = list(models)
                attempted_models: set[str] = set()
                while pending_models and time.monotonic() < deadline:
                    model = pending_models.pop(0)
                    model_id = self._model_path(model)
                    if model_id in attempted_models:
                        continue
                    attempted_models.add(model_id)
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent?key={key}"
                    payload = {
                        "systemInstruction": {"parts": [{"text": str(sys_prompt)}]},
                        "contents": contents,
                        "generationConfig": {"maxOutputTokens": 4096, "temperature": 0.7},
                    }
                    try:
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            break
                        response = requests.post(
                            url, json=payload, timeout=max(0.05, min(4, remaining))
                        )
                        response_text = response.text
                        if response.status_code != 200:
                            self._record_pool_error(key, model_id, response.status_code, response_text)
                        if self._is_invalid_key_response(response.status_code, response_text):
                            last_err = f"HTTP {response.status_code}: {response_text[:200]}"
                            if not master:
                                self._mark_invalid_key(key, response.status_code)
                            else:
                                logger.warning("Gemini Master API key was rejected by provider (HTTP %s)", response.status_code)
                            break
                        if response.status_code == 400 and "systemInstruction" in response_text:
                            payload.pop("systemInstruction", None)
                            remaining = deadline - time.monotonic()
                            if remaining <= 0:
                                break
                            response = requests.post(
                                url, json=payload, timeout=max(0.05, min(4, remaining))
                            )
                            response_text = response.text
                            if response.status_code != 200:
                                self._record_pool_error(key, model_id, response.status_code, response_text)
                            if self._is_invalid_key_response(response.status_code, response_text):
                                last_err = f"HTTP {response.status_code}: {response_text[:200]}"
                                if not master:
                                    self._mark_invalid_key(key, response.status_code)
                                else:
                                    logger.warning("Gemini Master API key was rejected by provider (HTTP %s)", response.status_code)
                                break
                        if response.status_code == 200:
                            candidates = response.json().get("candidates", [])
                            if candidates:
                                parts = candidates[0].get("content", {}).get("parts", [])
                                reply = "".join(
                                    part.get("text", "")
                                    for part in parts if isinstance(part, dict)
                                )
                                if reply.strip():
                                    self.model_name = model
                                    self.active_model = model
                                    global ACTIVE_MODEL
                                    ACTIVE_MODEL = model
                                    return reply
                        elif response.status_code == 401:
                            last_err = f"HTTP {response.status_code}: {response_text[:200]}"
                            if not master:
                                self._mark_invalid_key(key, response.status_code)
                            break
                        elif response.status_code == 403:
                            last_err = f"HTTP {response.status_code}: {response_text[:200]}"
                            break
                        elif response.status_code == 404:
                            last_err = f"HTTP 404: {response_text[:200]}"
                            refreshed = self.discover_models(
                                timeout=min(1, deadline - time.monotonic()),
                                deadline=deadline,
                                force_refresh=True,
                            )
                            pending_models.extend(refreshed)
                            continue
                        elif response.status_code == 429:
                            last_err = f"HTTP 429: {response_text[:200]}"
                            if not master:
                                with self._condition:
                                    self._key_backoff_until[key] = time.monotonic() + 24 * 60 * 60
                                    self._unhealthy_keys.add(key)
                                    self._key_health[key] = "rate-limited"
                                    self._condition.notify_all()
                            break
                        else:
                            last_err = f"HTTP {response.status_code}: {response_text[:200]}"
                            break
                    except requests.RequestException as error:
                        last_err = f"provider request failed ({type(error).__name__})"
                        self.last_pool_error = last_err
                        print(
                            f"[GEMINI_POOL] Key #{self._key_fingerprint(key).removeprefix('key-')} "
                            f"({key[:8]}...) -> {model_id}: {last_err}"
                        )
                        if not master:
                            with self._condition:
                                self._key_backoff_until[key] = time.monotonic() + 30
                                self._unhealthy_keys.add(key)
                                self._key_health[key] = "unreachable"
                                self._condition.notify_all()
                        break
            finally:
                if not master:
                    self._release_key(key)

        if not master and self.free_keys and all(
            key in self._invalid_keys for key in self.free_keys
        ):
            raise RuntimeError("GEMINI_KEYS_INVALID")
        if not master and not any(
            key not in self._invalid_keys
            and key not in self._unhealthy_keys
            and
            self._key_backoff_until.get(key, 0) <= time.monotonic()
            for key in self.free_keys
        ):
            raise RuntimeError("FREE_POOL_EXHAUSTED")
        raise RuntimeError(f"Gemini Pool Error (Free keys loaded={len(self.free_keys)}): {last_err}")

    def _record_pool_error(
        self, key: str, model: str, status_code: int, response_text: str
    ) -> None:
        message = f"HTTP {status_code} {response_text[:200]}"
        self.last_pool_error = message
        key_number = self._key_fingerprint(key).removeprefix("key-")
        print(
            f"[GEMINI_POOL] Key #{key_number} ({key[:8]}...) -> "
            f"{model}: {message}"
        )

    def chat(self, messages: Any = None, master: bool = False, thinking_level: str = "pro", *args: Any, **kwargs: Any) -> str:
        if messages is None and "prompt" in kwargs:
            messages = kwargs["prompt"]
        requester_sub = str(kwargs.pop("overflow_requester_sub", ""))
        deadline = time.monotonic() + 5
        kwargs["_deadline"] = deadline
        try:
            return self._call_google(messages, master=master, **kwargs)
        except RuntimeError as error:
            if master or not str(error).startswith("FREE_POOL_EXHAUSTED") or not requester_sub:
                raise
            self._stage_overflow(requester_sub, timeout=deadline - time.monotonic())
            return self._call_google(messages, master=True, **kwargs)

    def stream(self, messages: Any = None, master: bool = False, thinking_level: str = "pro", *args: Any, **kwargs: Any) -> Iterator[str]:
        if messages is None and "prompt" in kwargs:
            messages = kwargs["prompt"]
        yield self.chat(messages, master=master, thinking_level=thinking_level, **kwargs)

    def availability(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        free_keys_available = sum(
            key not in self._invalid_keys
            and key not in self._unhealthy_keys
            and self._key_backoff_until.get(key, 0) <= time.monotonic()
            for key in self.free_keys
        )
        free_keys_healthy = sum(
            key not in self._invalid_keys and key not in self._unhealthy_keys
            for key in self.free_keys
        )
        keys_loaded = len(self.free_keys)
        ok = bool(keys_loaded or self.master_key)
        return {
            "available": ok,
            "online": ok,
            "genie_pro_configured": bool(self.free_keys),
            "genie_pro_available": bool(free_keys_available),
            "genie_master_configured": bool(self.master_key),
            "genie_master_available": bool(self.master_key),
            "free_keys_count": len(self.free_keys),
            "free_keys_available": free_keys_available,
            "free_keys_healthy": free_keys_healthy,
            "health_probe_complete": self._health_probe_ran,
            "key_health": {
                self._key_fingerprint(key): self._key_health.get(key, "unchecked")
                for key in self.free_keys
            },
            "active_model_id": self.model_name,
            "fallback_models": list(self.fallback_models),
            "keys_loaded": keys_loaded,
            "key_previews": [f"...{key[-4:]}" for key in self.free_keys],
            "active_model": self.model_name,
            "last_pool_error": self.last_pool_error,
        }

    def is_available(self, *args: Any, **kwargs: Any) -> bool:
        return bool(
            any(
                key not in self._invalid_keys
                and key not in self._unhealthy_keys
                and self._key_backoff_until.get(key, 0) <= time.monotonic()
                for key in self.free_keys
            )
            or self.master_key
        )

    def silent_pro_summarize(self, room_messages: Any = None, *args: Any, **kwargs: Any) -> str:
        try:
            return self._call_google(room_messages or "Summarize context briefly.")
        except Exception:
            return "Context active."

    def calculate_dynamic_master_tokens(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        prompt = str(args[0]) if args else ""
        context_size = int(args[2]) if len(args) > 2 else len(prompt)
        tokens = max(1, min(25, (context_size + 3999) // 4000))
        return {
            "tokens_burned": tokens,
            "breakdown": f"Request context: {context_size} characters",
        }


gemini_pool = GeminiPool()