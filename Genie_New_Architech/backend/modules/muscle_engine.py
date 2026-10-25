from __future__ import annotations

import hashlib
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

MODULE_DIR = Path(__file__).parent
BACKEND_DIR = MODULE_DIR.parent
LOGGER = logging.getLogger("genie.muscle")
MAX_DATABASE_BYTES = 50 * 1024 * 1024
_WORD_RE = re.compile(r"[a-z0-9]+")
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


def signature(query: str) -> str:
    normalized = normalize_query(query)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


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
            terms = [f'"{term}"' for term in normalized.split()]
            match_query = " OR ".join(terms)
            candidates = connection.execute(
                """
                SELECT l.signature, l.normalized_question, l.compressed_answer,
                       l.concepts, 'learned' AS source
                FROM learned_synapses AS l
                WHERE l.signature IN (SELECT signature FROM muscle_core WHERE muscle_core MATCH ?)
                UNION ALL
                SELECT b.signature, b.normalized_question, b.compressed_answer,
                       b.concepts, 'built-in' AS source
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
                    "UPDATE learned_synapses SET last_used_at = CURRENT_TIMESTAMP WHERE signature = ?",
                    (row["signature"],),
                )
            return {
                "answer": zlib.decompress(row["compressed_answer"]).decode("utf-8"),
                "confidence": confidence,
                "source": row["source"],
                "signature": row["signature"],
            }

    def learn(self, question: str, answer: str) -> bool:
        normalized = normalize_query(question)
        clean_answer = answer.strip()
        if not normalized or not clean_answer:
            return False
        database_bytes = self.path.stat().st_size if self.path.exists() else 0
        if database_bytes >= MAX_DATABASE_BYTES:
            return False
        compressed = zlib.compress(clean_answer.encode("utf-8"), level=9)
        concepts = " ".join(sorted(set(normalized.split())))
        synapse_signature = signature(question)
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO learned_synapses(
                    signature, question, normalized_question, compressed_answer, concepts
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(signature) DO UPDATE SET
                    question = excluded.question,
                    normalized_question = excluded.normalized_question,
                    compressed_answer = excluded.compressed_answer,
                    concepts = excluded.concepts,
                    last_used_at = CURRENT_TIMESTAMP
                """,
                (synapse_signature, question[:1000], normalized, compressed, concepts),
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
            connection.commit()
        return True

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
