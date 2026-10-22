from __future__ import annotations

import sqlite3


def needs_personal_attestation(sender_geo_hash: str | None, receiver_geo_hash: str | None) -> bool:
    return bool(sender_geo_hash and receiver_geo_hash and sender_geo_hash != receiver_geo_hash)


def has_mutual_friend(connection: sqlite3.Connection, user_a: str, user_b: str) -> bool:
    return connection.execute(
        """
        WITH edges(user_sub, friend_sub) AS (
            SELECT user_a, user_b FROM friendships
            UNION ALL
            SELECT user_b, user_a FROM friendships
        )
        SELECT 1 FROM edges a
        JOIN edges b ON b.friend_sub = a.friend_sub
        WHERE a.user_sub = ? AND b.user_sub = ?
        LIMIT 1
        """,
        (user_a, user_b),
    ).fetchone() is not None
