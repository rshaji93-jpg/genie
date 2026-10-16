from __future__ import annotations

import sqlite3

from .geo_mutual_gate import has_mutual_friend


def visible_to(connection: sqlite3.Connection, viewer: str, candidate: str) -> bool:
    profile = connection.execute(
        "SELECT lookup_visibility FROM users WHERE user_sub = ?", (candidate,)
    ).fetchone()
    if not profile or profile["lookup_visibility"] == "invite_link_only":
        return False
    return profile["lookup_visibility"] != "mutual_contacts_only" or has_mutual_friend(
        connection, viewer, candidate
    )
