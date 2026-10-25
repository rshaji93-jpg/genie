from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any, Callable

try:
    from .muscle_engine import (
        MuscleEngine,
        match_conversational_reflex,
        get_initialized_muscle_engine,
        normalize_query,
    )
    from .zero_secret_vault.scrubber import scrub_sensitive_text
except ImportError:
    from modules.muscle_engine import (
        MuscleEngine,
        match_conversational_reflex,
        get_initialized_muscle_engine,
        normalize_query,
    )
    from modules.zero_secret_vault.scrubber import scrub_sensitive_text

_PERSONAL_PATTERN = re.compile(
    r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|\b(?:my|mine|i am|i'm|our|we are|"
    r"room|meeting|call|phone|address|password|account)\b",
    re.IGNORECASE,
)
_NAME_PATTERN = re.compile(r"\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+\b")
_FILLER = re.compile(r"^(?:please\s+)?(?:can you|could you|would you|tell me|help me)\s+")
_RCA_PATTERN = re.compile(
    r"\b(?:debug(?:ging)?|root cause|architecture|architectural|analy[sz]e|"
    r"why\s+(?:does|is|did|would|could)|what(?:'s|\s+is)\s+the\s+(?:issue|problem|cause)|"
    r"troubleshoot|complex problem)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class BoneResult:
    answer: str
    source: str
    confidence: float
    elapsed_ms: float
    tokens_burned: int
    signature: str | None = None


def prepare_query(query: str) -> tuple[str, str, str]:
    cleaned = " ".join(query.strip().split())
    concept = _FILLER.sub("", cleaned.casefold()).strip(" ?!.")
    normalized = normalize_query(concept)
    intent = (
        "coding" if re.search(r"\b(code|python|typescript|debug|function|api|sql)\b", normalized)
        else "research" if re.search(r"\b(research|compare|source|evidence|latest)\b", normalized)
        else "media" if re.search(r"\b(image|video|audio|photo|picture)\b", normalized)
        else "voice" if re.search(r"\b(speak|voice|call|pronounce)\b", normalized)
        else "chat"
    )
    return cleaned, normalized, intent


def is_rca_query(query: str) -> bool:
    return bool(_RCA_PATTERN.search(query))


def is_general_query(query: str, room_mode: bool = False) -> bool:
    return not room_mode and not _PERSONAL_PATTERN.search(query) and not _NAME_PATTERN.search(query)


def sanitize_general_answer(answer: str) -> str:
    sanitized = scrub_sensitive_text(answer)
    sanitized = re.sub(
        r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b",
        "[redacted email]",
        sanitized,
    )
    sanitized = _NAME_PATTERN.sub("[redacted name]", sanitized)
    sanitized = re.sub(
        r"(?i)\b(?:room|invite|passcode|room[_ -]?key)\s*(?:id|code|key)?\s*[:=#]\s*\S+",
        "[redacted room detail]",
        sanitized,
    )
    return sanitized.strip()


def learn_general_answer(
    question: str,
    answer: str,
    *,
    room_mode: bool = False,
    engine: MuscleEngine | None = None,
    category: str = "general",
) -> bool:
    if not answer.strip() or not is_general_query(question, room_mode):
        return False
    sanitized = sanitize_general_answer(answer)
    if not sanitized:
        return False
    active_engine = engine or get_initialized_muscle_engine()
    return (
        active_engine.learn(question, sanitized, category=category)
        if active_engine is not None
        else False
    )


def lookup_muscle(
    query: str,
    *,
    room_mode: bool = False,
    model_tier: str = "genie-pro",
    engine: MuscleEngine | None = None,
) -> dict[str, Any] | None:
    if room_mode or model_tier == "genie-master" or not is_general_query(query):
        return None
    active_engine = engine or get_initialized_muscle_engine()
    return (
        active_engine.lookup(query, minimum_confidence=0.85)
        if active_engine is not None
        else None
    )


async def route_query(
    query: str,
    brain: Callable[..., Any],
    *,
    engine: MuscleEngine | None = None,
    room_mode: bool = False,
    **brain_kwargs: Any,
) -> dict[str, Any]:
    """Try a local 0-token synapse before invoking the supplied Brain coroutine."""
    started = time.perf_counter()
    cleaned, normalized, intent = prepare_query(query)
    greeting = match_conversational_reflex(cleaned)
    if greeting is not None:
        return {
            "reply": greeting["answer"],
            "source": "pool0-greeting-reflex",
            "tokens_burned": 0,
            "muscle_confidence": greeting["confidence"],
            "intent": intent,
            "elapsed_ms": (time.perf_counter() - started) * 1000,
        }
    muscle = engine or get_initialized_muscle_engine()
    match = muscle.lookup(cleaned, minimum_confidence=0.85) if muscle else None
    if match is not None:
        return {
            "reply": match["answer"],
            "source": "pool0-muscle",
            "tokens_burned": 0,
            "muscle_confidence": match["confidence"],
            "intent": intent,
            "elapsed_ms": (time.perf_counter() - started) * 1000,
        }

    result = await brain(**brain_kwargs)
    answer = result.get("reply", "") if isinstance(result, dict) else str(result)
    if answer:
        # Store only the single-turn prompt and response; no conversation history or identity fields.
        learn_general_answer(cleaned, answer, room_mode=room_mode, engine=muscle)
    if isinstance(result, dict):
        result.setdefault("intent", intent)
        result.setdefault("muscle_confidence", 0.0)
        result.setdefault("concept_signature", normalized)
        result.setdefault("elapsed_ms", (time.perf_counter() - started) * 1000)
        return result
    return {"reply": answer, "source": "brain", "intent": intent}


def purge_learned_synapse(question: str, engine: MuscleEngine | None = None) -> bool:
    active_engine = engine or get_initialized_muscle_engine()
    return active_engine.purge(question) if active_engine is not None else False
