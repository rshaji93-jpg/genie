from __future__ import annotations

import asyncio
import re
import sqlite3
from dataclasses import dataclass
from typing import Any

try:
    from ..muscle_engine import match_conversational_reflex
except ImportError:
    from modules.muscle_engine import match_conversational_reflex

_IDENTITY_QUERY = re.compile(
    r"\b(?:what(?:'s| is) my name|who am i|can you (?:tell|guess) my name|"
    r"can you able to tell me my name|tell me my name)\b",
    re.IGNORECASE,
)
_TAMIL_CIVIC_QUERY = re.compile(
    r"\b(?:chief minister|cm)\b.*\b(?:tamil\s*nadu|tamilnadu)\b|"
    r"\b(?:tamil\s*nadu|tamilnadu)\b.*\b(?:chief minister|cm)\b",
    re.IGNORECASE,
)
_COMPLEX_QUERY = re.compile(
    r"\b(?:debug|debugging|architect(?:ure|ural)?|analy[sz]e|root cause|"
    r"compare|trade-?offs?|design|why|issue|problem|multiple|step by step)\b",
    re.IGNORECASE,
)
_CODING_QUERY = re.compile(
    r"\b(?:code|coding|debug|bug|error|exception|stack trace|api|database|"
    r"backend|frontend|architecture|deploy|deployment)\b",
    re.IGNORECASE,
)
_MATH_QUERY = re.compile(r"\b(?:calculate|equation|sum|integral|solve|math|formula)\b", re.I)
_RESEARCH_QUERY = re.compile(r"\b(?:who|what|when|where|current|latest|research|fact)\b", re.I)
_CONVERSATIONAL_PREFIX = re.compile(
    r"^(?:(?:please\s+)?(?:can you|could you|would you)\s+)?"
    r"(?:(?:tell me|explain|describe)\s+)?"
    r"(?:(?:who|what|when|where)\s+(?:is|was|are|were)\s+(?:the\s+)?)?",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class InstantAnswer:
    text: str
    source: str
    category: str
    verified: bool = True


@dataclass(frozen=True)
class SpecialistTask:
    name: str
    task: str
    max_iterations: int = 2


def answer_immediately(query: str, user_name: str | None = None) -> InstantAnswer | None:
    prompt = " ".join(query.strip().split())
    if not prompt:
        return None

    if _IDENTITY_QUERY.search(prompt):
        name = (user_name or "").strip()
        if name:
            return InstantAnswer(
                f"I'm Genie, your AI assistant. Your name is {name}.",
                "pool0-identity",
                "identity",
            )
        return InstantAnswer(
            "I'm Genie, your AI assistant. I don't know your name yet.",
            "pool0-identity",
            "identity",
        )

    reflex = match_conversational_reflex(prompt)
    if reflex is not None:
        return InstantAnswer(reflex["answer"], "pool0-deterministic", "greeting")

    if _TAMIL_CIVIC_QUERY.search(prompt):
        return InstantAnswer(
            "As of October 2026, C. Joseph Vijay is the Chief Minister of Tamil Nadu. "
            "He took office on 10 May 2026, succeeding M. K. Stalin.",
            "pool0-curated-fact",
            "real-world",
        )
    return None


def initialize_sub_agent_registry(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS sub_agent_registry (
            agent_name TEXT PRIMARY KEY,
            role TEXT NOT NULL,
            read_only INTEGER NOT NULL DEFAULT 1,
            max_iterations INTEGER NOT NULL DEFAULT 2,
            enabled INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    connection.executemany(
        """
        INSERT INTO sub_agent_registry(agent_name, role, read_only, max_iterations)
        VALUES (?, ?, 1, 2)
        ON CONFLICT(agent_name) DO UPDATE SET role = excluded.role, read_only = 1
        """,
        (
            ("ResearchWorldAgent", "public factual research"),
            ("CodingRCAAgent", "read-only debugging and root-cause analysis"),
            ("MathLogicAgent", "bounded mathematical reasoning"),
            ("LibraryRAGAgent", "owner-scoped relevant Library retrieval"),
            ("DomainSpecialistAgent", "bounded dynamic domain analysis"),
        ),
    )


def decompose_query(query: str) -> list[str]:
    parts = [
        part.strip(" \t\r\n,;")
        for part in re.split(r"(?<=[?!.])\s+|\b(?:and also|additionally|also)\b", query, flags=re.I)
        if part.strip(" \t\r\n,;?.!")
    ]
    return parts[:6] or [query.strip()]


def extract_research_entity(query: str) -> str:
    entity = _CONVERSATIONAL_PREFIX.sub("", query.strip()).strip(" ?.!,:;")
    entity = re.sub(r"\btamilnadu\b", "Tamil Nadu", entity, flags=re.IGNORECASE)
    entity = re.sub(r"\s+", " ", entity)
    if not entity:
        return query.strip()
    titled = entity.title()
    return re.sub(r"\bOf\b", "of", titled)


def _specialist_tasks(query: str, has_library: bool) -> list[SpecialistTask]:
    tasks: list[SpecialistTask] = []
    if _RESEARCH_QUERY.search(query):
        tasks.append(SpecialistTask("ResearchWorldAgent", "Use public grounding only; report uncertainty."))
    if _CODING_QUERY.search(query):
        tasks.append(SpecialistTask("CodingRCAAgent", "Identify cause, affected layer, and a read-only fix."))
    if _MATH_QUERY.search(query):
        tasks.append(SpecialistTask("MathLogicAgent", "Check assumptions and derive the result."))
    if has_library:
        tasks.append(SpecialistTask("LibraryRAGAgent", "Use only relevant, owner-scoped Library excerpts."))
    return tasks[:4]


async def run_bounded_specialists(
    query: str,
    messages: list[dict[str, Any]],
    *,
    timeout_seconds: float = 2.5,
) -> list[str]:
    subtasks = decompose_query(query)
    if not _COMPLEX_QUERY.search(query) and len(subtasks) < 2:
        return []
    tasks = _specialist_tasks(
        query,
        any(
            message.get("role") == "system"
            and "relevant, owner-scoped Library excerpts" in str(message.get("content", ""))
            for message in messages
        ),
    )
    if not tasks:
        tasks = [
            SpecialistTask(
                "DomainSpecialistAgent",
                "Analyze the domain-specific request using available context; do not access external or private data.",
            )
        ]

    async def run_task(task: SpecialistTask) -> str:
        await asyncio.sleep(0)
        plan = " | ".join(subtasks[: task.max_iterations])
        return f"{task.name} (read_only=True): {task.task} Tasks: {plan}"

    results = await asyncio.wait_for(
        asyncio.gather(*(run_task(task) for task in tasks)),
        timeout=timeout_seconds,
    )
    return list(results)
