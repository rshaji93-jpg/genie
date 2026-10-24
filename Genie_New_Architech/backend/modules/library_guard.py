from __future__ import annotations

import re
import unicodedata
from typing import Any, Iterable


_STOP_WORDS = {
    "a",
    "about",
    "above",
    "after",
    "again",
    "all",
    "an",
    "and",
    "any",
    "are",
    "as",
    "at",
    "be",
    "because",
    "been",
    "before",
    "below",
    "between",
    "but",
    "by",
    "can",
    "did",
    "do",
    "does",
    "for",
    "from",
    "get",
    "give",
    "had",
    "has",
    "have",
    "how",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "me",
    "my",
    "of",
    "on",
    "or",
    "please",
    "show",
    "tell",
    "that",
    "the",
    "their",
    "them",
    "there",
    "these",
    "this",
    "those",
    "to",
    "up",
    "was",
    "we",
    "were",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "with",
    "would",
    "you",
    "your",
}

_NON_CONTEXT_QUERIES = {
    "hello",
    "hi",
    "hey",
    "hello there",
    "good morning",
    "good afternoon",
    "good evening",
    "vanakkam",
    "thanks",
    "thank you",
    "ok",
    "okay",
    "yes",
    "no",
    "help",
    "commands",
    "what can you do",
    "continue",
    "stop",
    "cancel",
    "start",
    "pause",
    "resume",
    "repeat",
    "clear",
}

_SUPPORTED_TYPES = {
    "knowledge_reference",
    "saved_answer",
    "saved_note",
    "scoped_preference",
}

_INJECTION_PATTERNS = (
    re.compile(
        r"\b(?:ignore|disregard|forget|override|bypass)\b"
        r"[^.!?;\n]{0,100}\b(?:instructions?|prompts?|rules?|safety|system)\b"
        r"[^.!?;\n]*",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:reveal|show|print|leak|expose|repeat)\b"
        r"[^.!?;\n]{0,80}\b(?:system prompt|hidden prompt|developer message|secret instructions?)\b"
        r"[^.!?;\n]*",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:you are now|act as|pretend to be)\b"
        r"[^.!?;\n]{0,100}\b(?:unrestricted|jailbroken|without (?:any )?rules|system administrator)\b"
        r"[^.!?;\n]*",
        re.IGNORECASE,
    ),
)

_TEXT_FIELDS = {
    "body",
    "content",
    "description",
    "name",
    "summary",
    "text",
    "title",
    "value",
}


def _normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    ascii_text = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(re.findall(r"[a-z0-9]+", ascii_text))


def _tokens(text: str) -> set[str]:
    return {
        token
        for token in _normalize(text).split()
        if len(token) > 1 and token not in _STOP_WORDS
    }


def _is_non_context_query(query: str) -> bool:
    normalized = _normalize(query)
    return normalized in _NON_CONTEXT_QUERIES


def _item_type(item: dict[str, Any]) -> str:
    value = (
        item.get("type")
        or item.get("kind")
        or item.get("item_type")
        or item.get("category")
        or ""
    )
    normalized = str(value).strip().casefold().replace("-", "_").replace(" ", "_")
    if normalized == "note":
        return "saved_note"
    return normalized


def _item_text(item: dict[str, Any]) -> str:
    fields = (
        "title",
        "name",
        "content",
        "text",
        "answer",
        "body",
        "summary",
        "description",
        "value",
    )
    return " ".join(
        value.strip()
        for field in fields
        if isinstance((value := item.get(field)), str) and value.strip()
    )


def _has_explicit_retrieval_intent(query: str) -> bool:
    normalized = _normalize(query)
    return bool(
        re.search(r"\b(?:retrieve|show|find|open|recall|fetch|pull up)\b", normalized)
        and re.search(r"\b(?:note|notes|saved|save|answer|reference)\b", normalized)
    ) or bool(re.search(r"\bwhat did i save\b", normalized))


def _is_named_retrieval(query: str, item: dict[str, Any]) -> bool:
    if not _has_explicit_retrieval_intent(query):
        return False
    normalized_query = f" {_normalize(query)} "
    for field in ("title", "name", "label"):
        name = item.get(field)
        if isinstance(name, str) and (normalized_name := _normalize(name)):
            if f" {normalized_name} " in normalized_query:
                return True
    return False


def _sanitize_text(text: str) -> str:
    sanitized = text
    for pattern in _INJECTION_PATTERNS:
        sanitized = pattern.sub("", sanitized)
    sanitized = re.sub(r"[ \t]{2,}", " ", sanitized)
    sanitized = re.sub(r" *([,;:]) *", r"\1 ", sanitized)
    sanitized = re.sub(r" *([.!?])(?:\s*[.!?])+", r"\1", sanitized)
    sanitized = re.sub(r"\s+([,;:!?])", r"\1", sanitized)
    return re.sub(r"[ \t]+\n", "\n", sanitized).strip()


def _sanitize_item(item: dict[str, Any], *, is_preference: bool) -> dict[str, Any]:
    result = dict(item)
    if not is_preference:
        for field in _TEXT_FIELDS:
            value = result.get(field)
            if isinstance(value, str):
                result[field] = _sanitize_text(value)
    return result


def rank_and_filter_library_context(
    query: str,
    user_id: str,
    conversation_id: str,
    items: Iterable[dict[str, Any]],
    min_score: float = 0.45,
) -> list[dict[str, Any]]:
    """Return relevant, owner-scoped library items in deterministic rank order.

    Each returned item is copied and marked with ``retrieved_content`` and a
    ``relevance_score``. Conversation-scoped items are only visible in their
    owning conversation; untrusted text is sanitized except for preferences
    whose instructions are intentionally scoped by their data owner.
    """
    if not isinstance(query, str) or not query.strip() or _is_non_context_query(query):
        return []
    if user_id is None or conversation_id is None:
        return []

    query_tokens = _tokens(query)
    if not query_tokens:
        return []
    retrieval_items: list[tuple[float, int, dict[str, Any], bool]] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict) or item.get("owner_id") != user_id:
            continue

        kind = _item_type(item)
        if kind not in _SUPPORTED_TYPES:
            continue
        item_conversation = item.get("conversation_id")
        if item_conversation is not None and item_conversation != conversation_id:
            continue
        if kind == "scoped_preference" and item_conversation != conversation_id:
            continue

        named_retrieval = kind == "saved_note" and _is_named_retrieval(query, item)
        text = _item_text(item)
        item_tokens = _tokens(text)
        if named_retrieval:
            score = 1.0
        elif not item_tokens:
            continue
        else:
            overlap = len(query_tokens & item_tokens) / len(query_tokens)
            normalized_query = f" {_normalize(query)} "
            normalized_text = _normalize(text)
            phrase_bonus = 0.2 if len(query_tokens) > 1 and normalized_text in normalized_query else 0.0
            score = min(1.0, overlap + phrase_bonus)

        if score < min_score:
            continue

        safe_item = _sanitize_item(item, is_preference=kind == "scoped_preference")
        safe_item["retrieved_content"] = True
        safe_item["relevance_score"] = round(score, 6)
        retrieval_items.append((score, index, safe_item, named_retrieval))

    retrieval_items.sort(key=lambda result: (-result[0], result[1]))
    return [item for _, _, item, _ in retrieval_items]
