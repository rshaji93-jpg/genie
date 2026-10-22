from __future__ import annotations

import sqlite3
from typing import Any


def read_receipts(
    connection: sqlite3.Connection, room_id: str, message_id: str
) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT r.user_sub, m.user_name, r.read_at
        FROM message_read_receipts r
        JOIN room_members m ON m.room_id = ? AND m.user_sub = r.user_sub
        WHERE r.message_id = ? ORDER BY r.read_at
        """,
        (room_id, message_id),
    ).fetchall()
    return [dict(row) for row in rows]
