from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any, Callable

try:
    from .muscle_engine import MuscleEngine, get_muscle_engine, normalize_query
except ImportError:
    from modules.muscle_engine import MuscleEngine, get_muscle_engine, normalize_query

_PERSONAL_PATTERN = re.compile(
    r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|\b(?:my|mine|i am|i'm|our|we are|"
    r"room|meeting|call|phone|address|password|account)\b",
    re.IGNORECASE,
)
_NAME_PATTERN = re.compile(r"\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+\b")
_FILLER = re.compile(r"^(?:please\s+)?(?:can you|could you|would you|tell me|help me)\s+")


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


def is_general_query(query: str, room_mode: bool = False) -> bool:
    return not room_mode and not _PERSONAL_PATTERN.search(query) and not _NAME_PATTERN.search(query)


def lookup_muscle(
    query: str,
    *,
    room_mode: bool = False,
    model_tier: str = "genie-pro",
    engine: MuscleEngine | None = None,
) -> dict[str, Any] | None:
    if room_mode or model_tier == "genie-master" or not is_general_query(query):
        return None
    return (engine or get_muscle_engine()).lookup(query, minimum_confidence=0.85)


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
    muscle = engine or get_muscle_engine()
    match = muscle.lookup(cleaned, minimum_confidence=0.85)
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
    if answer and is_general_query(cleaned, room_mode):
        # Store only the single-turn prompt and response; no conversation history or identity fields.
        muscle.learn(cleaned, answer)
    if isinstance(result, dict):
        result.setdefault("intent", intent)
        result.setdefault("muscle_confidence", 0.0)
        result.setdefault("concept_signature", normalized)
        result.setdefault("elapsed_ms", (time.perf_counter() - started) * 1000)
        return result
    return {"reply": answer, "source": "brain", "intent": intent}


def purge_learned_synapse(question: str, engine: MuscleEngine | None = None) -> bool:
    return (engine or get_muscle_engine()).purge(question)
