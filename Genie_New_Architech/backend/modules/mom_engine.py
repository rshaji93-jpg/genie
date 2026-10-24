from __future__ import annotations

import math
import re
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from typing import Iterable

_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+|\n+")
_AGREEMENT_RE = re.compile(r"\b(?:agreed|approved|confirmed|let['’]s go with|we decided)\b", re.I)
_ACTION_RE = re.compile(r"\b(?:i will|we will|need to|next step|by tomorrow|action item)\b", re.I)
_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
_TOKEN_RE = re.compile(r"[a-z0-9]{2,}")


def initialize_mom_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS call_transcripts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            speaker TEXT NOT NULL,
            utterance TEXT NOT NULL
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_call_transcripts_room_time "
        "ON call_transcripts(room_id, timestamp)"
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS mom_email_preferences (
            room_id TEXT NOT NULL,
            user_sub TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(room_id, user_sub)
        )
        """
    )


def record_utterance(
    connection: sqlite3.Connection,
    room_id: str,
    speaker: str,
    utterance: str,
    timestamp: str | None = None,
) -> None:
    text = utterance.strip()
    if not room_id or not speaker.strip() or not text:
        return
    initialize_mom_schema(connection)
    connection.execute(
        "INSERT INTO call_transcripts(room_id, timestamp, speaker, utterance) VALUES (?, ?, ?, ?)",
        (room_id, timestamp or datetime.now(timezone.utc).isoformat(), speaker[:120], text[:20_000]),
    )


def _rank_sentences(sentences: list[str]) -> list[tuple[float, int, str]]:
    tokens = [Counter(_TOKEN_RE.findall(sentence.casefold())) for sentence in sentences]
    document_frequency: Counter[str] = Counter()
    for sentence_tokens in tokens:
        document_frequency.update(sentence_tokens.keys())
    scores: list[tuple[float, int, str]] = []
    count = max(1, len(sentences))
    for index, (sentence, sentence_tokens) in enumerate(zip(sentences, tokens)):
        if not sentence_tokens:
            continue
        score = sum(
            frequency * (math.log((1 + count) / (1 + document_frequency[token])) + 1)
            for token, frequency in sentence_tokens.items()
        ) / math.sqrt(sum(sentence_tokens.values()))
        scores.append((score, index, sentence))
    return scores


def generate_minutes(
    room_name: str,
    entries: Iterable[tuple[str, str, str]],
    *,
    participants: Iterable[str] = (),
    started_at: str | None = None,
    ended_at: str | None = None,
) -> str:
    rows = list(entries)
    participants_set = {speaker for _, speaker, _ in rows}
    participants_set.update(participants)
    sentences = [
        sentence.strip()
        for _, _, utterance in rows
        for sentence in _SENTENCE_RE.split(utterance)
        if sentence.strip()
    ]
    ranked = sorted(_rank_sentences(sentences), key=lambda entry: (-entry[0], entry[1]))
    top_points = sorted(ranked[:5], key=lambda entry: entry[1])
    decisions = [sentence for sentence in sentences if _AGREEMENT_RE.search(sentence)]
    actions = [sentence for sentence in sentences if _ACTION_RE.search(sentence)]
    header_date = (started_at or (rows[0][0] if rows else datetime.now(timezone.utc).isoformat()))[:10]
    duration = "Unknown"
    if started_at and ended_at:
        try:
            begin = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
            finish = datetime.fromisoformat(ended_at.replace("Z", "+00:00"))
            minutes = max(0, int((finish - begin).total_seconds() // 60))
            duration = f"{minutes} minute(s)"
        except ValueError:
            pass
    lines = [
        f"Minutes of Meeting — {room_name}",
        f"Date: {header_date}",
        f"Duration: {duration}",
        f"Participants: {', '.join(sorted(participants_set)) or 'Not recorded'}",
        "",
        "Key Discussion Points",
        *(f"- {sentence}" for _, _, sentence in top_points),
        "",
        "Approved Decisions",
        *(f"- {sentence}" for sentence in decisions),
        "",
        "Action Items",
        *(f"- {sentence}" for sentence in actions),
        "",
        "Full Chronological Transcript",
        *(f"[{timestamp}] {speaker}: {utterance}" for timestamp, speaker, utterance in rows),
    ]
    return "\n".join(lines).strip() + "\n"


def transcript_for_room(
    connection: sqlite3.Connection,
    room_id: str,
    room_name: str,
    participants: Iterable[str] = (),
) -> str:
    initialize_mom_schema(connection)
    rows = connection.execute(
        """
        SELECT timestamp, speaker, utterance FROM call_transcripts
        WHERE room_id = ? ORDER BY timestamp, id
        """,
        (room_id,),
    ).fetchall()
    entries = [(str(row[0]), str(row[1]), str(row[2])) for row in rows]
    return generate_minutes(room_name, entries, participants=participants)


def opted_in_recipients(connection: sqlite3.Connection, room_id: str) -> list[str]:
    initialize_mom_schema(connection)
    rows = connection.execute(
        "SELECT u.email FROM mom_email_preferences p JOIN users u ON u.user_sub = p.user_sub "
        "WHERE p.room_id = ? AND p.enabled = 1 AND u.email IS NOT NULL",
        (room_id,),
    ).fetchall()
    return [str(row[0]) for row in rows if _EMAIL_RE.fullmatch(str(row[0]))]


def create_mom_router(database_factory, identity_dependency):
    from contextlib import closing
    import os
    import smtplib
    from email.message import EmailMessage

    from fastapi import APIRouter, Depends, HTTPException
    from fastapi.responses import Response
    from pydantic import BaseModel, ConfigDict

    class PreferenceRequest(BaseModel):
        model_config = ConfigDict(extra="forbid")
        enabled: bool

    class TranscriptRequest(BaseModel):
        model_config = ConfigDict(extra="forbid")
        speaker: str
        utterance: str
        timestamp: str | None = None

    router = APIRouter()

    def room_access(connection: sqlite3.Connection, room_id: str, user_sub: str):
        room = connection.execute(
            "SELECT id, name, owner_sub FROM rooms WHERE id = ?", (room_id,)
        ).fetchone()
        if room is not None:
            member = connection.execute(
                "SELECT 1 FROM room_members WHERE room_id = ? AND user_sub = ?",
                (room_id, user_sub),
            ).fetchone()
            if not member:
                raise HTTPException(status_code=403, detail="Room membership is required.")
            return room
        if room_id == f"solo:{user_sub}":
            return {"id": room_id, "name": "Personal chat", "owner_sub": user_sub}
        raise HTTPException(status_code=404, detail="Conversation was not found.")

    @router.get("/api/calls/{room_id}/transcript-download")
    async def download_transcript(
        room_id: str,
        identity: dict[str, str] = Depends(identity_dependency),
    ):
        with closing(database_factory()) as connection:
            room = room_access(connection, room_id, identity["sub"])
            participants = [
                str(row[0]) for row in connection.execute(
                    "SELECT user_name FROM room_members WHERE room_id = ? ORDER BY user_name",
                    (room_id,),
                ).fetchall()
            ] if room_id.startswith("solo:") is False else [identity["name"]]
            text = transcript_for_room(connection, room_id, room["name"], participants)
        return Response(
            content=text.encode("utf-8"),
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="genie-mom-{room_id[:40]}.txt"'},
        )

    @router.post("/api/calls/{room_id}/send-mom-email")
    async def send_mom_email(
        room_id: str,
        identity: dict[str, str] = Depends(identity_dependency),
    ):
        with closing(database_factory()) as connection:
            room = room_access(connection, room_id, identity["sub"])
            recipients = opted_in_recipients(connection, room_id)
            report = transcript_for_room(connection, room_id, room["name"])
        if not recipients:
            raise HTTPException(status_code=409, detail="No participants have opted in to MOM email.")
        host = os.getenv("GENIE_SMTP_HOST")
        username = os.getenv("GENIE_SMTP_USERNAME")
        password = os.getenv("GENIE_SMTP_PASSWORD")
        sender = os.getenv("GENIE_MOM_EMAIL_FROM", username or "")
        if not host or not sender or not username or not password:
            raise HTTPException(status_code=503, detail="MOM email delivery is not configured.")
        message = EmailMessage()
        message["Subject"] = f"Genie meeting notes: {room['name']}"
        message["From"] = sender
        message["To"] = ", ".join(recipients)
        message.set_content(report)
        try:
            with smtplib.SMTP(host, int(os.getenv("GENIE_SMTP_PORT", "587")), timeout=10) as smtp:
                smtp.starttls()
                smtp.login(username, password)
                smtp.send_message(message)
        except (OSError, smtplib.SMTPException, ValueError) as error:
            raise HTTPException(status_code=502, detail="MOM email delivery failed.") from error
        return {"sent": True, "recipient_count": len(recipients)}

    @router.put("/api/calls/{room_id}/mom-email-preference")
    async def set_mom_email_preference(
        room_id: str,
        request: PreferenceRequest,
        identity: dict[str, str] = Depends(identity_dependency),
    ):
        with closing(database_factory()) as connection:
            room_access(connection, room_id, identity["sub"])
            initialize_mom_schema(connection)
            connection.execute(
                """
                INSERT INTO mom_email_preferences(room_id, user_sub, enabled)
                VALUES (?, ?, ?)
                ON CONFLICT(room_id, user_sub) DO UPDATE SET enabled = excluded.enabled
                """,
                (room_id, identity["sub"], int(request.enabled)),
            )
            connection.commit()
        return {"room_id": room_id, "enabled": request.enabled}

    @router.get("/api/calls/{room_id}/mom-email-preference")
    async def get_mom_email_preference(
        room_id: str,
        identity: dict[str, str] = Depends(identity_dependency),
    ):
        with closing(database_factory()) as connection:
            room_access(connection, room_id, identity["sub"])
            initialize_mom_schema(connection)
            row = connection.execute(
                "SELECT enabled FROM mom_email_preferences WHERE room_id = ? AND user_sub = ?",
                (room_id, identity["sub"]),
            ).fetchone()
        return {"room_id": room_id, "enabled": bool(row[0]) if row else False}

    @router.post("/api/calls/{room_id}/transcript")
    async def record_transcript_utterance(
        room_id: str,
        request: TranscriptRequest,
        identity: dict[str, str] = Depends(identity_dependency),
    ):
        with closing(database_factory()) as connection:
            room_access(connection, room_id, identity["sub"])
            record_utterance(
                connection,
                room_id,
                request.speaker.strip() or identity["name"],
                request.utterance,
                request.timestamp,
            )
            connection.commit()
        return {"recorded": bool(request.utterance.strip())}

    return router
