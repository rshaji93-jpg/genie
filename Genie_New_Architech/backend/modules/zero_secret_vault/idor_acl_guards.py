from __future__ import annotations

import sqlite3

from fastapi import HTTPException


def require_room_member(connection: sqlite3.Connection, room_id: str, user_sub: str) -> None:
    if not connection.execute(
        "SELECT 1 FROM room_members WHERE room_id = ? AND user_sub = ?",
        (room_id, user_sub),
    ).fetchone():
        raise HTTPException(status_code=404, detail="Room not found.")


def require_chat_owner(connection: sqlite3.Connection, chat_id: str, user_sub: str) -> None:
    if not connection.execute(
        "SELECT 1 FROM chats WHERE id = ? AND owner_sub = ?",
        (chat_id, user_sub),
    ).fetchone():
        raise HTTPException(status_code=404, detail="Chat not found.")
