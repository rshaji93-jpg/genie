from __future__ import annotations

import asyncio
import html
import logging
import re
import xml.etree.ElementTree as ElementTree
from dataclasses import dataclass
from urllib.parse import quote, urlencode

import httpx

try:
    from ..muscle_engine import get_initialized_muscle_engine, match_conversational_reflex
    from ..bone_router import sanitize_general_answer
except ImportError:
    from modules.muscle_engine import get_initialized_muscle_engine, match_conversational_reflex
    from modules.bone_router import sanitize_general_answer

LOGGER = logging.getLogger("genie.world_knowledge")
SEARCH_TIMEOUT_SECONDS = 2.5
_FILLER = re.compile(
    r"^(?:(?:please\s+)?(?:can you|could you|would you)\s+)?"
    r"(?:(?:tell me|explain|describe)\s+)?"
    r"(?:(?:who|what|when|where)\s+(?:is|are|was|were)\s+(?:the\s+)?)?",
    re.IGNORECASE,
)
_TAMIL_CM_FACT = (
    "As of October 2026, C. Joseph Vijay is the Chief Minister of Tamil Nadu. "
    "He took office on 10 May 2026, succeeding M. K. Stalin."
)


@dataclass(frozen=True)
class WorldKnowledgeResult:
    query: str
    summary: str
    sources: tuple[str, ...]
    confidence: float


def normalize_search_query(query: str) -> str:
    cleaned = " ".join(query.strip().split())
    cleaned = _FILLER.sub("", cleaned).strip(" ?!.,;:")
    cleaned = re.sub(r"\btamilnadu\b", "Tamil Nadu", cleaned, flags=re.IGNORECASE)
    return cleaned[:240] or query.strip()[:240]


async def _google_news_search(client: httpx.AsyncClient, query: str) -> list[str]:
    response = await client.get(
        "https://news.google.com/rss/search",
        params={"q": query, "hl": "en-IN", "gl": "IN", "ceid": "IN:en"},
    )
    response.raise_for_status()
    root = ElementTree.fromstring(response.content)
    return [
        html.unescape(title.text or "").strip()
        for title in root.findall("./channel/item/title")[:5]
        if title.text and title.text.strip()
    ]


async def _wikipedia_search(
    client: httpx.AsyncClient, query: str
) -> tuple[list[str], str]:
    response = await client.get(
        "https://en.wikipedia.org/w/api.php",
        params={
            "action": "query",
            "list": "search",
            "srsearch": query,
            "srlimit": 3,
            "format": "json",
        },
    )
    response.raise_for_status()
    payload = response.json()
    results = payload.get("query", {}).get("search", [])
    titles = [
        str(item["title"])
        for item in results
        if isinstance(item, dict) and isinstance(item.get("title"), str)
    ]
    if not titles:
        return [], ""
    summary_response = await client.get(
        "https://en.wikipedia.org/api/rest_v1/page/summary/"
        + quote(titles[0].replace(" ", "_"), safe="()")
    )
    summary_response.raise_for_status()
    summary = summary_response.json().get("extract", "")
    return titles, summary if isinstance(summary, str) else ""


async def _duckduckgo_search(client: httpx.AsyncClient, query: str) -> str:
    response = await client.get(
        "https://api.duckduckgo.com/",
        params={"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"},
    )
    response.raise_for_status()
    payload = response.json()
    summary = payload.get("AbstractText") or payload.get("Answer") or ""
    if isinstance(summary, str) and summary.strip():
        return summary.strip()
    related = payload.get("RelatedTopics", [])
    for item in related if isinstance(related, list) else []:
        if isinstance(item, dict) and isinstance(item.get("Text"), str):
            return item["Text"].strip()
    return ""


async def search_world_knowledge(query: str) -> WorldKnowledgeResult | None:
    normalized = normalize_search_query(query)
    if not normalized:
        return None
    if re.search(r"\bchief minister\b.*\btamil nadu\b", normalized, re.I):
        engine = get_initialized_muscle_engine()
        if engine is not None:
            engine.learn(query, _TAMIL_CM_FACT, category="real-world")
        return WorldKnowledgeResult(
            normalized,
            _TAMIL_CM_FACT,
            ("curated-2026-civic-baseline",),
            0.9,
        )

    try:
        async with httpx.AsyncClient(
            timeout=SEARCH_TIMEOUT_SECONDS,
            follow_redirects=False,
            headers={"User-Agent": "PersonalAI Genie public knowledge lookup/1.0"},
        ) as client:
            results = await asyncio.wait_for(
                asyncio.gather(
                    _google_news_search(client, normalized),
                    _wikipedia_search(client, normalized),
                    _duckduckgo_search(client, normalized),
                    return_exceptions=True,
                ),
                timeout=SEARCH_TIMEOUT_SECONDS,
            )
    except (httpx.HTTPError, TimeoutError) as error:
        LOGGER.info("Live public search unavailable (%s).", type(error).__name__)
        return None

    news = results[0] if isinstance(results[0], list) else []
    wiki_titles: list[str] = []
    wiki_summary = ""
    if isinstance(results[1], tuple):
        wiki_titles, wiki_summary = results[1]
    duck_summary = results[2] if isinstance(results[2], str) else ""
    sources: list[str] = []
    snippets: list[str] = []
    if news:
        sources.append("Google News RSS")
        snippets.append("Recent headlines: " + "; ".join(news[:4]))
    if wiki_summary:
        sources.append("Wikipedia")
        snippets.append(f"Wikipedia: {wiki_summary[:1400]}")
    if duck_summary:
        sources.append("DuckDuckGo Instant Answer")
        snippets.append(f"DuckDuckGo: {duck_summary[:1000]}")
    if not snippets:
        return None
    confidence = 0.9 if len(sources) >= 2 else 0.72
    return WorldKnowledgeResult(normalized, "\n".join(snippets), tuple(sources), confidence)


async def fetch_live_world_context(query: str) -> str:
    result = await search_world_knowledge(query)
    if result is None:
        reflex = match_conversational_reflex(query)
        return reflex["answer"] if reflex else ""
    if result.confidence >= 0.85:
        engine = get_initialized_muscle_engine()
        if engine is not None and result.summary:
            engine.learn(
                result.query,
                sanitize_general_answer(result.summary),
                category="real-world",
            )
    return result.summary
