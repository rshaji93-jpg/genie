from __future__ import annotations

import sqlite3
from contextlib import closing


def create_feedback_router(database_factory, identity_dependency, purge_synapse=None):
    from fastapi import APIRouter, Depends, HTTPException
    from pydantic import BaseModel, ConfigDict, Field

    class FeedbackRequest(BaseModel):
        model_config = ConfigDict(extra="forbid")
        message_id: str = Field(min_length=1, max_length=200)
        rating: str = Field(pattern="^(up|down)$")
        question: str = Field(default="", max_length=20_000)

    router = APIRouter()

    @router.post("/api/feedback")
    async def submit_feedback(
        request: FeedbackRequest,
        identity: dict[str, str] = Depends(identity_dependency),
    ):
        with closing(database_factory()) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS response_feedback (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id TEXT NOT NULL,
                    user_sub TEXT NOT NULL,
                    rating TEXT NOT NULL CHECK(rating IN ('up', 'down')),
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(message_id, user_sub)
                )
                """
            )
            connection.execute(
                """
                INSERT INTO response_feedback(message_id, user_sub, rating)
                VALUES (?, ?, ?)
                ON CONFLICT(message_id, user_sub) DO UPDATE SET
                    rating = excluded.rating, created_at = CURRENT_TIMESTAMP
                """,
                (request.message_id, identity["sub"], request.rating),
            )
            connection.commit()
        purged = False
        if request.rating == "down" and request.question and purge_synapse:
            purged = bool(purge_synapse(request.question))
        return {"saved": True, "synapse_purged": purged}

    return router
