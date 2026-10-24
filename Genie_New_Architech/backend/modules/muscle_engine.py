from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import zlib
from pathlib import Path
from typing import Any

MODULE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = MODULE_DIR.parent
MAX_DATABASE_BYTES = 50 * 1024 * 1024
_WORD_RE = re.compile(r"[a-z0-9]+")
_STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "for",
    "from", "how", "i", "in", "is", "it", "of", "on", "or", "please", "the",
    "this", "to", "was", "what", "when", "where", "which", "who", "why", "with",
    "would", "you",
}


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
    configured = os.getenv("GENIE_MUSCLE_DB_PATH")
    if configured:
        return Path(configured)
    return BACKEND_DIR / "ai_muscle" / "muscle_core.sqlite3"


class MuscleEngine:
    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path) if path else database_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
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

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=2.0)
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
        for question, answer in reflexes.items():
            normalized = normalize_query(question) or question
            connection.execute(
                """
                INSERT OR IGNORE INTO built_in_reflexes(
                    signature, normalized_question, compressed_answer, concepts
                ) VALUES (?, ?, ?, ?)
                """,
                (
                    signature(question),
                    normalized,
                    zlib.compress(answer.encode("utf-8"), level=9),
                    normalized,
                ),
            )

        source_dir = BACKEND_DIR / "ai_muscle"
        if not source_dir.exists():
            return
        for file_path in sorted(source_dir.glob("*.json")):
            if file_path.name == "registry.json" or file_path.stat().st_size > 2_000_000:
                continue
            try:
                import json

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
                connection.execute(
                    """
                    INSERT OR IGNORE INTO built_in_reflexes(
                        signature, normalized_question, compressed_answer, concepts
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (
                        signature(question),
                        normalized,
                        zlib.compress(answer.encode("utf-8"), level=9),
                        normalized,
                    ),
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
            candidates = connection.execute(
                """
                SELECT signature, normalized_question, compressed_answer, concepts, 'learned' AS source
                FROM learned_synapses
                UNION ALL
                SELECT signature, normalized_question, compressed_answer, concepts, 'built-in' AS source
                FROM built_in_reflexes
                """
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
            connection.commit()
        return True

    def purge(self, question: str) -> bool:
        synapse_signature = signature(question)
        with self.connect() as connection:
            connection.execute("DELETE FROM synapse_search WHERE signature = ?", (synapse_signature,))
            deleted = connection.execute(
                "DELETE FROM learned_synapses WHERE signature = ?", (synapse_signature,)
            ).rowcount
            connection.commit()
        return deleted > 0


_default_engine: MuscleEngine | None = None


def get_muscle_engine() -> MuscleEngine:
    global _default_engine
    if _default_engine is None:
        _default_engine = MuscleEngine()
    return _default_engine
