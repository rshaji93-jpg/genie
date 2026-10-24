import sqlite3
from contextlib import closing
from typing import Literal


def create_privacy_router(database_factory, identity_dependency):
    from fastapi import APIRouter, Depends, HTTPException
    from pydantic import BaseModel, ConfigDict, Field

    class PrivacySettings(BaseModel):
        model_config = ConfigDict(extra="forbid")
        profile_visibility: Literal["public", "friends", "private"] = "friends"
        friend_request_setting: Literal["everyone", "mutuals", "nobody"] = "everyone"
        friends_only_calls: bool = True
        prompt_before_screen_share: bool = True

    class BlockedUser(BaseModel):
        model_config = ConfigDict(extra="forbid")
        user_id: str = Field(min_length=1, max_length=200)
        user_name: str = Field(min_length=1, max_length=120)

    router = APIRouter()

    def ensure_schema(connection: sqlite3.Connection) -> None:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS privacy_settings (
                owner_sub TEXT PRIMARY KEY,
                profile_visibility TEXT NOT NULL DEFAULT 'friends',
                friend_request_setting TEXT NOT NULL DEFAULT 'everyone',
                friends_only_calls INTEGER NOT NULL DEFAULT 1,
                prompt_before_screen_share INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS privacy_blocked_users (
                owner_sub TEXT NOT NULL,
                blocked_sub TEXT NOT NULL,
                blocked_name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(owner_sub, blocked_sub)
            );
            """
        )

    with closing(database_factory()) as connection:
        ensure_schema(connection)
        connection.commit()

    @router.get("/api/privacy/settings")
    async def get_privacy_settings(identity=Depends(identity_dependency)):
        with closing(database_factory()) as connection:
            ensure_schema(connection)
            row = connection.execute(
                "SELECT profile_visibility, friend_request_setting, friends_only_calls, "
                "prompt_before_screen_share FROM privacy_settings WHERE owner_sub = ?",
                (identity["sub"],),
            ).fetchone()
        if row is None:
            return PrivacySettings().model_dump()
        return {
            "profile_visibility": row["profile_visibility"],
            "friend_request_setting": row["friend_request_setting"],
            "friends_only_calls": bool(row["friends_only_calls"]),
            "prompt_before_screen_share": bool(row["prompt_before_screen_share"]),
        }

    @router.put("/api/privacy/settings")
    async def save_privacy_settings(request: PrivacySettings, identity=Depends(identity_dependency)):
        with closing(database_factory()) as connection:
            ensure_schema(connection)
            connection.execute(
                """
                INSERT INTO privacy_settings(
                    owner_sub, profile_visibility, friend_request_setting,
                    friends_only_calls, prompt_before_screen_share
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(owner_sub) DO UPDATE SET
                    profile_visibility = excluded.profile_visibility,
                    friend_request_setting = excluded.friend_request_setting,
                    friends_only_calls = excluded.friends_only_calls,
                    prompt_before_screen_share = excluded.prompt_before_screen_share
                """,
                (
                    identity["sub"],
                    request.profile_visibility,
                    request.friend_request_setting,
                    int(request.friends_only_calls),
                    int(request.prompt_before_screen_share),
                ),
            )
            connection.commit()
        return request.model_dump()

    @router.get("/api/privacy/blocked-users")
    async def list_blocked_users(identity=Depends(identity_dependency)):
        with closing(database_factory()) as connection:
            ensure_schema(connection)
            rows = connection.execute(
                "SELECT blocked_sub AS id, blocked_name AS name FROM privacy_blocked_users "
                "WHERE owner_sub = ? ORDER BY created_at DESC",
                (identity["sub"],),
            ).fetchall()
        return [dict(row) for row in rows]

    @router.post("/api/privacy/blocked-users")
    async def block_user(request: BlockedUser, identity=Depends(identity_dependency)):
        if request.user_id == identity["sub"]:
            raise HTTPException(status_code=422, detail="You cannot block your own account.")
        with closing(database_factory()) as connection:
            ensure_schema(connection)
            connection.execute(
                "INSERT OR REPLACE INTO privacy_blocked_users(owner_sub, blocked_sub, blocked_name) "
                "VALUES (?, ?, ?)",
                (identity["sub"], request.user_id, request.user_name.strip()),
            )
            connection.commit()
        return {"id": request.user_id, "name": request.user_name.strip()}

    @router.delete("/api/privacy/blocked-users/{blocked_id}")
    async def unblock_user(blocked_id: str, identity=Depends(identity_dependency)):
        with closing(database_factory()) as connection:
            ensure_schema(connection)
            cursor = connection.execute(
                "DELETE FROM privacy_blocked_users WHERE owner_sub = ? AND blocked_sub = ?",
                (identity["sub"], blocked_id),
            )
            connection.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Blocked user was not found.")
        return {"unblocked": blocked_id}

    return router
