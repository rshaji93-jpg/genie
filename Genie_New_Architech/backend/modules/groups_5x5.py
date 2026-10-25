from __future__ import annotations

import logging
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone

LOGGER = logging.getLogger(__name__)


def create_groups_router(database_factory, identity_dependency):
    from fastapi import APIRouter, Depends, HTTPException
    from pydantic import BaseModel, ConfigDict, Field

    class GroupSettings(BaseModel):
        model_config = ConfigDict(extra="forbid")
        name: str = Field(min_length=1, max_length=80)
        icon: str = Field(default="", max_length=500)

    class GroupMembers(BaseModel):
        model_config = ConfigDict(extra="forbid")
        member_ids: list[str] = Field(max_length=4)

    class GroupInvitationDecision(BaseModel):
        model_config = ConfigDict(extra="forbid")
        accept: bool

    router = APIRouter()

    def ensure_schema(connection: sqlite3.Connection) -> None:
        room_columns = {str(row[1]) for row in connection.execute("PRAGMA table_info(rooms)")}
        if "group_icon" not in room_columns:
            connection.execute("ALTER TABLE rooms ADD COLUMN group_icon TEXT NOT NULL DEFAULT ''")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS group_invitations (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                inviter_sub TEXT NOT NULL,
                invitee_sub TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined')),
                created_at TEXT NOT NULL,
                UNIQUE(room_id, invitee_sub)
            )
            """
        )

    def owned_group(connection: sqlite3.Connection, room_id: str, owner_sub: str):
        room = connection.execute(
            "SELECT id, owner_sub, group_slot FROM rooms WHERE id = ?",
            (room_id,),
        ).fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="Group was not found.")
        if room["owner_sub"] != owner_sub or room["group_slot"] is None:
            raise HTTPException(status_code=403, detail="Only the group owner can edit a fixed group.")
        return room

    @router.patch("/api/rooms/{room_id}/settings")
    async def update_group_settings(
        room_id: str,
        request: GroupSettings,
        identity: dict[str, str] = Depends(identity_dependency),
    ):
        with closing(database_factory()) as connection:
            ensure_schema(connection)
            owned_group(connection, room_id, identity["sub"])
            connection.execute(
                "UPDATE rooms SET name = ?, group_icon = ? WHERE id = ?",
                (request.name.strip(), request.icon.strip(), room_id),
            )
            connection.commit()
        return {"room_id": room_id, "name": request.name.strip(), "icon": request.icon.strip()}

    @router.put("/api/rooms/{room_id}/members")
    async def request_group_members(
        room_id: str,
        request: GroupMembers,
        identity: dict[str, str] = Depends(identity_dependency),
    ):
        target_ids = list(dict.fromkeys(request.member_ids))
        if len(target_ids) > 4 or identity["sub"] in target_ids:
            raise HTTPException(status_code=422, detail="A group has at most five members, including its owner.")
        with closing(database_factory()) as connection:
            ensure_schema(connection)
            owned_group(connection, room_id, identity["sub"])
            current_count = int(connection.execute(
                "SELECT COUNT(*) FROM room_members WHERE room_id = ?", (room_id,)
            ).fetchone()[0])
            current_members = {
                str(row[0]) for row in connection.execute(
                    "SELECT user_sub FROM room_members WHERE room_id = ?", (room_id,)
                ).fetchall()
            }
            additions = [target for target in target_ids if target not in current_members]
            if len(additions) + current_count > 5:
                raise HTTPException(status_code=409, detail="This group already has five members.")
            for target in additions:
                friendship = connection.execute(
                    """
                    SELECT 1 FROM friend_requests
                    WHERE status = 'accepted'
                      AND ((sender_sub = ? AND receiver_sub = ?)
                        OR (sender_sub = ? AND receiver_sub = ?))
                    LIMIT 1
                    """,
                    (identity["sub"], target, target, identity["sub"]),
                ).fetchone()
                if not friendship:
                    raise HTTPException(status_code=403, detail="Groups can only invite accepted friends.")
                timestamp = datetime.now(timezone.utc).isoformat()
                invitation_id = str(uuid.uuid4())
                connection.execute(
                    """
                    INSERT INTO group_invitations(id, room_id, inviter_sub, invitee_sub, status, created_at)
                    VALUES (?, ?, ?, ?, 'pending', ?)
                    ON CONFLICT(room_id, invitee_sub) DO UPDATE SET
                        inviter_sub = excluded.inviter_sub, status = 'pending', created_at = excluded.created_at
                    """,
                    (invitation_id, room_id, identity["sub"], target, timestamp),
                )
                connection.execute(
                    """
                    INSERT INTO notifications(recipient_username, message_id, notification_type, message, created_at)
                    SELECT u.username, ?, 'group_invitation', ?, ?
                    FROM users u WHERE u.user_sub = ?
                    """,
                    (invitation_id, f"{identity['name']} invited you to a group.", timestamp, target),
                )
            connection.commit()
        return {"requested": len(additions), "pending_invitation_ids": [target for target in additions]}

    @router.get("/api/rooms/{room_id}/invitations")
    async def list_group_invitations(
        room_id: str,
        identity: dict[str, str] = Depends(identity_dependency),
    ):
        try:
            with closing(database_factory()) as connection:
                ensure_schema(connection)
                room_member = connection.execute(
                    "SELECT 1 FROM room_members WHERE room_id = ? AND user_sub = ?",
                    (room_id, identity["sub"]),
                ).fetchone()
                if not room_member:
                    raise HTTPException(status_code=403, detail="Room membership is required.")
                rows = connection.execute(
                    """
                    SELECT i.id, i.invitee_sub, i.status, i.created_at, u.user_name
                    FROM group_invitations i JOIN users u ON u.user_sub = i.invitee_sub
                    WHERE i.room_id = ? ORDER BY i.created_at DESC
                    """,
                    (room_id,),
                ).fetchall()
            return {"invitations": [dict(row) for row in rows]}
        except sqlite3.Error:
            try:
                with closing(database_factory()) as connection:
                    ensure_schema(connection)
                    connection.commit()
            except sqlite3.Error:
                LOGGER.exception("Could not recover group invitation tables.")
            return {"ok": True, "requests": [], "invitations": []}

    @router.get("/api/py/group-invitations")
    @router.get("/api/py/group-invitations/pending")
    @router.get("/api/group-invitations")
    @router.get("/api/group-invitations/pending")
    async def list_pending_group_invitations(
        identity: dict[str, str] = Depends(identity_dependency),
    ):
        try:
            with closing(database_factory()) as connection:
                ensure_schema(connection)
                rows = connection.execute(
                    """
                    SELECT i.id, i.room_id, i.created_at, r.name AS group_name,
                           u.user_name AS inviter_name
                    FROM group_invitations i
                    JOIN rooms r ON r.id = i.room_id
                    JOIN users u ON u.user_sub = i.inviter_sub
                    WHERE i.invitee_sub = ? AND i.status = 'pending'
                    ORDER BY i.created_at DESC
                    """,
                    (identity["sub"],),
                ).fetchall()
            return [dict(row) for row in rows]
        except sqlite3.Error:
            try:
                with closing(database_factory()) as connection:
                    ensure_schema(connection)
                    connection.commit()
            except sqlite3.Error:
                LOGGER.exception("Could not recover pending group invitation tables.")
            return {"ok": True, "requests": [], "invitations": []}

    @router.post("/api/group-invitations/{invitation_id}/respond")
    async def respond_group_invitation(
        invitation_id: str,
        request: GroupInvitationDecision,
        identity: dict[str, str] = Depends(identity_dependency),
    ):
        with closing(database_factory()) as connection:
            ensure_schema(connection)
            invitation = connection.execute(
                """
                SELECT i.id, i.room_id, i.invitee_sub, r.name, r.owner_sub, r.group_slot
                FROM group_invitations i JOIN rooms r ON r.id = i.room_id
                WHERE i.id = ? AND i.status = 'pending'
                """,
                (invitation_id,),
            ).fetchone()
            if not invitation or invitation["invitee_sub"] != identity["sub"]:
                raise HTTPException(status_code=404, detail="Pending group invitation was not found.")
            if request.accept:
                count = int(connection.execute(
                    "SELECT COUNT(*) FROM room_members WHERE room_id = ?", (invitation["room_id"],)
                ).fetchone()[0])
                if count >= 5:
                    raise HTTPException(status_code=409, detail="This group has reached its five-member limit.")
                connection.execute(
                    "INSERT OR IGNORE INTO room_members(room_id, user_sub, user_name, joined_at) VALUES (?, ?, ?, ?)",
                    (invitation["room_id"], identity["sub"], identity["name"], datetime.now(timezone.utc).isoformat()),
                )
            connection.execute(
                "UPDATE group_invitations SET status = ? WHERE id = ?",
                ("accepted" if request.accept else "declined", invitation_id),
            )
            connection.commit()
        return {"accepted": request.accept, "room_id": invitation["room_id"]}

    return router
