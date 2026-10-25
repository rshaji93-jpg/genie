from __future__ import annotations

import json
import sqlite3
from typing import Any

MAX_GAME_STATE_BYTES = 64_000
SUPPORTED_GAMES = {"carrom-blitz", "hand-cricket", "quick-ludo", "quick-grid"}


def initialize_games_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS multiplayer_game_states (
            game_id TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            state_json TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            updated_by TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(game_id, scope_id)
        )
        """
    )


def serialize_game_state(state: dict[str, Any]) -> str:
    if not isinstance(state, dict):
        raise ValueError("Game state must be a JSON object.")
    encoded = json.dumps(state, separators=(",", ":"), ensure_ascii=False)
    if len(encoded.encode("utf-8")) > MAX_GAME_STATE_BYTES:
        raise ValueError("Game state exceeds the 64 KB limit.")
    return encoded
