from __future__ import annotations

import asyncio
import hashlib
import difflib
import gzip
import json
import logging
import os
import re
import sqlite3
import tempfile
import threading
import zlib
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

MODULE_DIR = Path(__file__).parent
BACKEND_DIR = MODULE_DIR.parent
LOGGER = logging.getLogger("genie.muscle")
MAX_DATABASE_BYTES = 50 * 1024 * 1024
LEARNED_SNAPSHOT_LOCAL = Path("/tmp/learned_muscle.json.gz")
LEARNED_SNAPSHOT_BACKUP = Path("/app/data/learned_muscle.json.gz")
_WORD_RE = re.compile(r"[a-z0-9]+")
_REPEATED_LETTERS_RE = re.compile(r"([a-z])\1{1,}", re.IGNORECASE)
_GREETING_REFLEXES = {
    "hi": "Hello! What would you like to work on?",
    "hello": "Hello! What would you like to work on?",
    "hey": "Hello! What would you like to work on?",
    "good morning": "Good morning! What would you like to work on?",
    "good afternoon": "Good afternoon! What would you like to work on?",
    "good evening": "Good evening! What would you like to work on?",
}
_GREETING_ALIASES = {"gud mrng": "good morning", "gud morning": "good morning"}
_FACTUAL_QUERY_RE = re.compile(
    r"\b(?:who|what|when|where|which|how many|how much|tell me about|describe|"
    r"define|current|latest|today|"
    r"recent|news|president|prime minister|chief minister|population|capital|founded|"
    r"born|died|weather|price|version|release)\b",
    re.IGNORECASE,
)
_STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "for",
    "from", "how", "i", "in", "is", "it", "of", "on", "or", "please", "the",
    "this", "to", "was", "what", "when", "where", "which", "who", "why", "with",
    "would", "you",
}
_ENGINE_LOCK = threading.Lock()
_default_engine: MuscleEngine | None = None


class _ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> bool:
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def normalize_query(query: str) -> str:
    """Return the deterministic, lower-cased concept tokens used by Muscle."""
    return " ".join(
        token for token in _WORD_RE.findall(query.casefold())
        if len(token) > 1 and token not in _STOP_WORDS
    )


def match_conversational_reflex(query: str) -> dict[str, Any] | None:
    candidate = " ".join(query.casefold().strip().strip("!?.,;:").split())
    if not candidate:
        return None
    candidate = _GREETING_ALIASES.get(candidate, candidate)
    candidate = _REPEATED_LETTERS_RE.sub(r"\1", candidate)
    best_match: tuple[float, str] | None = None
    for intent in _GREETING_REFLEXES:
        score = difflib.SequenceMatcher(None, candidate, intent).ratio()
        if best_match is None or score > best_match[0]:
            best_match = score, intent
    if best_match is None or best_match[0] < 0.78:
        return None
    confidence, intent = best_match
    return {
        "answer": _GREETING_REFLEXES[intent],
        "confidence": confidence,
        "source": "greeting-reflex",
        "signature": signature(intent),
    }


def signature(query: str) -> str:
    normalized = normalize_query(query)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def is_factual_query(query: str) -> bool:
    return bool(_FACTUAL_QUERY_RE.search(query))


async def fetch_real_world_context(query: str) -> str:
    """Fetch a short, public Wikipedia summary without requiring provider credentials."""
    cleaned_query = " ".join(query.strip().split())
    if (
        not cleaned_query
        or len(cleaned_query) > 240
        or not is_factual_query(cleaned_query)
        or re.search(r"\b(?:my|mine|our|we|i am|i'm|password|private|medical)\b", cleaned_query, re.I)
        or re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", cleaned_query)
    ):
        return ""

    timeout = httpx.Timeout(2.5)
    headers = {"User-Agent": "GeniePersonalAssistant/1.0 (public knowledge lookup)"}
    try:
        async with asyncio.timeout(2.5):
            async with httpx.AsyncClient(
                timeout=timeout,
                follow_redirects=False,
                headers=headers,
            ) as client:
                search_response = await client.get(
                    "https://en.wikipedia.org/w/rest.php/v1/search/page",
                    params={"q": cleaned_query, "limit": "1"},
                )
                search_response.raise_for_status()
                search_payload = search_response.json()
                pages = search_payload.get("pages", []) if isinstance(search_payload, dict) else []
                if not pages or not isinstance(pages[0], dict):
                    return ""
                title = pages[0].get("key") or pages[0].get("title")
                if not isinstance(title, str) or not title.strip():
                    return ""
                summary_response = await client.get(
                    "https://en.wikipedia.org/api/rest_v1/page/summary/"
                    + quote(title.replace(" ", "_"), safe="()"),
                )
                summary_response.raise_for_status()
                summary_payload = summary_response.json()
    except (httpx.HTTPError, ValueError, KeyError, TypeError, TimeoutError) as error:
        LOGGER.info("Wikipedia grounding lookup unavailable (%s).", type(error).__name__)
        return ""

    extract = summary_payload.get("extract") if isinstance(summary_payload, dict) else None
    if not isinstance(extract, str) or not extract.strip():
        return ""
    page_url = ""
    content_urls = summary_payload.get("content_urls")
    if isinstance(content_urls, dict):
        desktop = content_urls.get("desktop")
        if isinstance(desktop, dict) and isinstance(desktop.get("page"), str):
            page_url = desktop["page"]
    citation = f" Source: {page_url}" if page_url else ""
    return f"Wikipedia summary: {extract.strip()[:1600]}{citation}"


def database_path() -> Path:
    if os.getenv("K_SERVICE") or os.getenv("CLOUD_RUN_JOB"):
        return Path("/tmp/genie_archive.sqlite3")
    configured = os.getenv("GENIE_MUSCLE_DB_PATH")
    if configured:
        return Path(configured)
    return BACKEND_DIR / "ai_muscle" / "muscle_core.sqlite3"


def _seed_path() -> Path:
    return MODULE_DIR / "muscle_seed.json.gz"


def _compile_seed_archive() -> None:
    source_dir = BACKEND_DIR / "ai_muscle"
    source_files = sorted(source_dir.glob("*.json")) if source_dir.exists() else []
    source_files = [
        path for path in source_files
        if path.name != "registry.json" and path.stat().st_size <= 2_000_000
    ]
    if not source_files:
        return

    entries = {
        item["question"]: item
        for item in _read_seed()
        if (
            isinstance(item, dict)
            and isinstance(item.get("question"), str)
            and isinstance(item.get("answer"), str)
        )
    }
    for file_path in source_files:
        try:
            payload: Any = json.loads(file_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            LOGGER.exception("Could not compile Muscle seed source %s.", file_path.name)
            continue
        for item in payload if isinstance(payload, list) else [payload]:
            if (
                isinstance(item, dict)
                and isinstance(item.get("question"), str)
                and isinstance(item.get("answer"), str)
            ):
                entries[item["question"]] = {
                    "question": item["question"],
                    "answer": item["answer"],
                }

    entries = dict(sorted(entries.items()))
    if entries == {
        item["question"]: item
        for item in _read_seed()
        if isinstance(item, dict)
        and isinstance(item.get("question"), str)
        and isinstance(item.get("answer"), str)
    }:
        return

    seed_path = _seed_path()
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=MODULE_DIR, suffix=".tmp", delete=False
        ) as temp_file:
            temp_path = Path(temp_file.name)
        with gzip.open(temp_path, "wt", encoding="utf-8") as seed_file:
            json.dump(list(entries.values()), seed_file, ensure_ascii=False, separators=(",", ":"))
        if temp_path.stat().st_size > MAX_DATABASE_BYTES:
            raise ValueError("Compiled Muscle seed exceeds the 50 MB limit.")
        os.replace(temp_path, seed_path)
    except (OSError, ValueError):
        LOGGER.exception("Could not update the compressed Muscle seed archive.")
    finally:
        if temp_path and temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                LOGGER.exception("Could not remove a temporary Muscle seed file.")


def _read_seed() -> list[dict[str, str]]:
    try:
        with gzip.open(_seed_path(), "rt", encoding="utf-8") as seed_file:
            payload = json.load(seed_file)
    except (OSError, ValueError):
        LOGGER.exception("Could not read the compressed Muscle seed archive.")
        return []
    if not isinstance(payload, list):
        LOGGER.error("The compressed Muscle seed archive must contain a JSON list.")
        return []
    return [entry for entry in payload if isinstance(entry, dict)]


class MuscleEngine:
    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path) if path else database_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        _compile_seed_archive()
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS learned_synapses (
                    id INTEGER PRIMARY KEY,
                    signature TEXT NOT NULL UNIQUE,
                    question TEXT NOT NULL,
                    normalized_question TEXT NOT NULL,
                    compressed_answer BLOB NOT NULL,
                    concepts TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT 'learned',
                    category TEXT NOT NULL DEFAULT 'general',
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    hit_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE VIRTUAL TABLE IF NOT EXISTS synapse_search USING fts5(
                    signature UNINDEXED, concepts, question, tokenize='unicode61'
                );
                CREATE VIRTUAL TABLE IF NOT EXISTS muscle_core USING fts5(
                    signature UNINDEXED, concepts, question, source UNINDEXED,
                    tokenize='unicode61'
                );
                CREATE TABLE IF NOT EXISTS built_in_reflexes (
                    signature TEXT PRIMARY KEY,
                    normalized_question TEXT NOT NULL,
                    compressed_answer BLOB NOT NULL,
                    concepts TEXT NOT NULL
                );
                """
            )
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(learned_synapses)")
            }
            for column, definition in (
                ("category", "TEXT NOT NULL DEFAULT 'general'"),
                ("updated_at", "TEXT NOT NULL DEFAULT ''"),
                ("hit_count", "INTEGER NOT NULL DEFAULT 0"),
            ):
                if column not in columns:
                    connection.execute(
                        f"ALTER TABLE learned_synapses ADD COLUMN {column} {definition}"
                    )
            connection.execute(
                "UPDATE learned_synapses SET updated_at = CURRENT_TIMESTAMP WHERE updated_at = ''"
            )
            self._sync_search_index(connection)
            self._compile_builtin_reflexes(connection)
            self._sync_muscle_index(connection)
            connection.commit()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self.path,
            timeout=2.0,
            factory=_ClosingConnection,
        )
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _sync_search_index(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            INSERT INTO synapse_search(signature, concepts, question)
            SELECT signature, concepts, question FROM learned_synapses
            WHERE signature NOT IN (SELECT signature FROM synapse_search)
            """
        )

    @staticmethod
    def _sync_muscle_index(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            INSERT INTO muscle_core(signature, concepts, question, source)
            SELECT signature, concepts, normalized_question, 'learned'
            FROM learned_synapses
            WHERE signature NOT IN (SELECT signature FROM muscle_core)
            UNION ALL
            SELECT signature, concepts, normalized_question, 'built-in'
            FROM built_in_reflexes
            WHERE signature NOT IN (SELECT signature FROM muscle_core)
            """
        )

    def _compile_builtin_reflexes(self, connection: sqlite3.Connection) -> None:
        reflexes = {
            "hi": "Hello! What would you like to work on?",
            "hello": "Hello! What would you like to work on?",
            "hey": "Hello! What would you like to work on?",
            "good morning": "Good morning! What would you like to work on?",
            "thank you": "You’re welcome. What else can I help with?",
            "thanks": "You’re welcome. What else can I help with?",
            "what can you do": "I can answer questions, explain ideas, help plan work, and support your projects.",
        }
        for entry in _read_seed():
            question = entry.get("question")
            answer = entry.get("answer")
            if isinstance(question, str) and isinstance(answer, str):
                reflexes[question] = answer
        reflex_rows = []
        for question, answer in reflexes.items():
            normalized = normalize_query(question) or question
            reflex_rows.append(
                (
                    signature(question),
                    normalized,
                    zlib.compress(answer.encode("utf-8"), level=9),
                    normalized,
                )
            )
        connection.executemany(
            """
            INSERT INTO built_in_reflexes(
                signature, normalized_question, compressed_answer, concepts
            ) VALUES (?, ?, ?, ?)
            ON CONFLICT(signature) DO UPDATE SET
                normalized_question = excluded.normalized_question,
                compressed_answer = excluded.compressed_answer,
                concepts = excluded.concepts
            """,
            reflex_rows,
        )

        source_dir = BACKEND_DIR / "ai_muscle"
        source_rows = []
        if source_dir.exists():
            for file_path in sorted(source_dir.glob("*.json")):
                if file_path.name == "registry.json" or file_path.stat().st_size > 2_000_000:
                    continue
                try:
                    payload: Any = json.loads(file_path.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                entries = payload if isinstance(payload, list) else [payload]
                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    question = entry.get("question")
                    answer = entry.get("answer")
                    if not isinstance(question, str) or not isinstance(answer, str):
                        continue
                    normalized = normalize_query(question)
                    if not normalized:
                        continue
                    source_rows.append(
                        (
                            signature(question),
                            normalized,
                            zlib.compress(answer.encode("utf-8"), level=9),
                            normalized,
                        )
                    )
        if source_rows:
            connection.executemany(
                """
                INSERT INTO built_in_reflexes(
                    signature, normalized_question, compressed_answer, concepts
                ) VALUES (?, ?, ?, ?)
                ON CONFLICT(signature) DO UPDATE SET
                    normalized_question = excluded.normalized_question,
                    compressed_answer = excluded.compressed_answer,
                    concepts = excluded.concepts
                """,
                source_rows,
            )
        connection.execute("DELETE FROM muscle_core WHERE source = 'built-in'")
        connection.execute(
            """
            INSERT INTO muscle_core(signature, concepts, question, source)
            SELECT signature, concepts, normalized_question, 'built-in'
            FROM built_in_reflexes
            """
        )
        connection.commit()

    @staticmethod
    def _similarity(query: str, concepts: str) -> float:
        query_tokens = set(query.split())
        candidate_tokens = set(concepts.split())
        if not query_tokens or not candidate_tokens:
            return 0.0
        return len(query_tokens & candidate_tokens) / len(query_tokens | candidate_tokens)

    def lookup(self, query: str, minimum_confidence: float = 0.85) -> dict[str, Any] | None:
        normalized = normalize_query(query)
        if not normalized:
            return None
        with self.connect() as connection:
            exact = connection.execute(
                """
                SELECT signature, normalized_question, compressed_answer,
                       category, 'learned' AS source
                FROM learned_synapses
                WHERE signature = ?
                UNION ALL
                SELECT signature, normalized_question, compressed_answer,
                       'built-in' AS category, 'built-in' AS source
                FROM built_in_reflexes
                WHERE signature = ?
                LIMIT 1
                """,
                (signature(query), signature(query)),
            ).fetchone()
            if exact is not None:
                if exact["source"] == "learned":
                    connection.execute(
                        """
                        UPDATE learned_synapses
                        SET last_used_at = CURRENT_TIMESTAMP, hit_count = hit_count + 1
                        WHERE signature = ?
                        """,
                        (exact["signature"],),
                    )
                    connection.commit()
                return {
                    "answer": zlib.decompress(exact["compressed_answer"]).decode("utf-8"),
                    "confidence": 1.0,
                    "source": exact["source"],
                    "category": exact["category"],
                    "signature": exact["signature"],
                }
            terms = [f'"{term}"' for term in normalized.split()]
            match_query = " OR ".join(terms)
            candidates = connection.execute(
                """
                SELECT l.signature, l.normalized_question, l.compressed_answer,
                       l.concepts, l.category, 'learned' AS source
                FROM learned_synapses AS l
                WHERE l.signature IN (SELECT signature FROM muscle_core WHERE muscle_core MATCH ?)
                UNION ALL
                SELECT b.signature, b.normalized_question, b.compressed_answer,
                       b.concepts, 'built-in' AS category, 'built-in' AS source
                FROM built_in_reflexes AS b
                WHERE b.signature IN (SELECT signature FROM muscle_core WHERE muscle_core MATCH ?)
                """,
                (match_query, match_query),
            ).fetchall()
            best: tuple[float, sqlite3.Row] | None = None
            for candidate in candidates:
                confidence = self._similarity(normalized, candidate["concepts"])
                if candidate["normalized_question"] == normalized:
                    confidence = 1.0
                if best is None or confidence > best[0]:
                    best = confidence, candidate
            if best is None or best[0] < minimum_confidence:
                return None
            confidence, row = best
            if row["source"] == "learned":
                connection.execute(
                    """
                    UPDATE learned_synapses
                    SET last_used_at = CURRENT_TIMESTAMP, hit_count = hit_count + 1
                    WHERE signature = ?
                    """,
                    (row["signature"],),
                )
                connection.commit()
            return {
                "answer": zlib.decompress(row["compressed_answer"]).decode("utf-8"),
                "confidence": confidence,
                "source": row["source"],
                "category": row["category"],
                "signature": row["signature"],
            }

    def learn(
        self,
        question: str,
        answer: str,
        *,
        category: str = "general",
    ) -> bool:
        normalized = normalize_query(question)
        clean_answer = answer.strip()
        if not normalized or not clean_answer:
            return False
        compressed = zlib.compress(clean_answer.encode("utf-8"), level=9)
        if len(compressed) > MAX_DATABASE_BYTES:
            return False
        concepts = " ".join(sorted(set(normalized.split())))
        synapse_signature = signature(question)
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO learned_synapses(
                    signature, question, normalized_question, compressed_answer, concepts,
                    category, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(signature) DO UPDATE SET
                    question = excluded.question,
                    normalized_question = excluded.normalized_question,
                    compressed_answer = excluded.compressed_answer,
                    concepts = excluded.concepts,
                    category = excluded.category,
                    updated_at = CURRENT_TIMESTAMP,
                    last_used_at = CURRENT_TIMESTAMP
                """,
                (
                    synapse_signature,
                    question[:1000],
                    normalized,
                    compressed,
                    concepts,
                    category[:80],
                ),
            )
            connection.execute("DELETE FROM synapse_search WHERE signature = ?", (synapse_signature,))
            connection.execute(
                "INSERT INTO synapse_search(signature, concepts, question) VALUES (?, ?, ?)",
                (synapse_signature, concepts, question[:1000]),
            )
            connection.execute("DELETE FROM muscle_core WHERE signature = ?", (synapse_signature,))
            connection.execute(
                "INSERT INTO muscle_core(signature, concepts, question, source) VALUES (?, ?, ?, 'learned')",
                (synapse_signature, concepts, question[:1000]),
            )
            learned_bytes = int(
                connection.execute(
                    "SELECT COALESCE(SUM(length(compressed_answer)), 0) FROM learned_synapses"
                ).fetchone()[0]
            )
            while learned_bytes > MAX_DATABASE_BYTES:
                victim = connection.execute(
                    """
                    SELECT signature, length(compressed_answer) AS answer_bytes
                    FROM learned_synapses
                    WHERE signature != ?
                    ORDER BY hit_count ASC, last_used_at ASC, updated_at ASC
                    LIMIT 1
                    """,
                    (synapse_signature,),
                ).fetchone()
                if victim is None:
                    connection.rollback()
                    return False
                connection.execute(
                    "DELETE FROM learned_synapses WHERE signature = ?",
                    (victim["signature"],),
                )
                connection.execute(
                    "DELETE FROM synapse_search WHERE signature = ?",
                    (victim["signature"],),
                )
                connection.execute(
                    "DELETE FROM muscle_core WHERE signature = ?",
                    (victim["signature"],),
                )
                learned_bytes -= int(victim["answer_bytes"])
            connection.commit()
        return True

    def export_learned_synapses(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT signature, question, normalized_question, compressed_answer,
                       concepts, category, updated_at, hit_count
                FROM learned_synapses
                ORDER BY hit_count DESC, updated_at DESC
                """
            ).fetchall()
        return [
            {
                "signature": row["signature"],
                "question": row["question"],
                "normalized_question": row["normalized_question"],
                "answer": zlib.decompress(row["compressed_answer"]).decode("utf-8"),
                "concepts": row["concepts"],
                "category": row["category"],
                "updated_at": row["updated_at"],
                "hit_count": row["hit_count"],
            }
            for row in rows
        ]

    def import_learned_synapses(self, entries: list[dict[str, Any]]) -> int:
        imported = 0
        for entry in entries:
            question = entry.get("question")
            answer = entry.get("answer")
            category = entry.get("category", "general")
            if not isinstance(question, str) or not isinstance(answer, str):
                continue
            if self.learn(question, answer, category=str(category)):
                imported += 1
                normalized_signature = signature(question)
                with self.connect() as connection:
                    connection.execute(
                        """
                        UPDATE learned_synapses
                        SET hit_count = MAX(hit_count, ?),
                            updated_at = CASE
                                WHEN ? > updated_at THEN ?
                                ELSE updated_at
                            END
                        WHERE signature = ?
                        """,
                        (
                            max(0, int(entry.get("hit_count", 0))),
                            str(entry.get("updated_at", "")),
                            str(entry.get("updated_at", "")),
                            normalized_signature,
                        ),
                    )
                    connection.commit()
        return imported

    def purge(self, question: str) -> bool:
        synapse_signature = signature(question)
        with self.connect() as connection:
            connection.execute("DELETE FROM synapse_search WHERE signature = ?", (synapse_signature,))
            connection.execute("DELETE FROM muscle_core WHERE signature = ?", (synapse_signature,))
            deleted = connection.execute(
                "DELETE FROM learned_synapses WHERE signature = ?", (synapse_signature,)
            ).rowcount
            connection.commit()
        return deleted > 0


_default_engine: MuscleEngine | None = None


def get_initialized_muscle_engine() -> MuscleEngine | None:
    return _default_engine


def get_muscle_engine() -> MuscleEngine:
    global _default_engine
    with _ENGINE_LOCK:
        if _default_engine is None:
            _default_engine = MuscleEngine()
    return _default_engine


def initialize_muscle_engine() -> MuscleEngine:
    """Hydrate the local database explicitly from the runtime startup worker."""
    return get_muscle_engine()
