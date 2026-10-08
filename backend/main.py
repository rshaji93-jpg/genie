import asyncio
from contextlib import closing
import hashlib
import hmac
import json
import os
import re
import requests
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Dict, Any, Set
from fastapi import FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

try:
    from .knowledge_registry import get_platform_system_manifest
    from .security import sanitize_ai_output
except ImportError:
    from knowledge_registry import get_platform_system_manifest
    from security import sanitize_ai_output

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env", override=False)
load_dotenv(BACKEND_DIR.parent / ".env.local", override=False)
load_dotenv(BACKEND_DIR.parent / ".env", override=False)

app = FastAPI(title="Personal AI Genie API", version="4.8.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_GEMINI_KEY = os.getenv("GEMINI_API_KEY", "").strip()
OPENROUTER_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()

# Cascade list of free models to try on OpenRouter in order of priority
OPENROUTER_FREE_MODELS = [
    "meta-llama/llama-3.3-70b-instruct:free",
    "openrouter/free",
]
OPENROUTER_KEY_RE = re.compile(r"^sk-or-[0-9A-Za-z_-]{40,}$")
GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash"]
ALLOWED_ROOM_REACTIONS = frozenset(
    "❤️ 👍 👏 😂 🔥 🎉 😊 🙏 💡 📚 🎯 ✨ 🚀 😍 🥰 🤔 😮 😢 😡 🤝 ✅ ❌ ⭐ 💯 👀 🙌 🤩 😎 🥳 💪 🫡 👏🏻 💚 💙 💜 🧡 🤍 🤣 😴".split()
)
VIP_SESSION_LIMIT = 20
VIP_SESSION_TTL_SECONDS = 90
DAILY_MESSAGE_LIMIT = 20
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
VIP_ALLOWED_EMAILS = {
    email.strip().lower()
    for email in os.getenv(
        "VIP_ALLOWED_EMAILS",
        "rshaji93@gmail.com,manoharlumina@gmail.com,ratnaraja007@gmail.com",
    ).split(",")
    if email.strip()
}
vip_sessions: Dict[str, tuple[str, float]] = {}
vip_sessions_lock = threading.Lock()
daily_message_counts: Dict[tuple[str, str], int] = {}
daily_message_counts_lock = threading.Lock()
ARCHIVE_DB_PATH = Path(
    os.getenv("GENIE_ARCHIVE_DB_PATH", str(BACKEND_DIR / "data" / "genie_archive.sqlite3"))
)
archive_lock = threading.Lock()


def initialize_archive_store():
    ARCHIVE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS archive_snapshots (
                    user_id TEXT NOT NULL,
                    bucket TEXT NOT NULL,
                    archive_key TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    messages_json TEXT NOT NULL,
                    saved_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, bucket, archive_key)
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS archive_snapshots_user_bucket ON archive_snapshots(user_id, bucket)"
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS sovereign_rooms (
                    room_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    host_id TEXT NOT NULL,
                    members_json TEXT NOT NULL,
                    passcode_salt TEXT NOT NULL DEFAULT '',
                    passcode_hash TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS encrypted_room_messages (
                    room_id TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    message_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (room_id, message_id)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS social_directory (
                    user_id TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    handle TEXT NOT NULL,
                    avatar_url TEXT NOT NULL,
                    meta_user_id TEXT NOT NULL,
                    email TEXT NOT NULL DEFAULT '',
                    public_key_json TEXT NOT NULL DEFAULT '{}',
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS user_blocks (
                    blocker_id TEXT NOT NULL,
                    blocked_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (blocker_id, blocked_id),
                    CHECK (blocker_id != blocked_id)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS personal_topic_channels (
                    user_id TEXT NOT NULL,
                    topic_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    icon TEXT NOT NULL,
                    messages_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, topic_id)
                )
                """
            )
            directory_columns = {
                row[1] for row in connection.execute("PRAGMA table_info(social_directory)")
            }
            if "email" not in directory_columns:
                connection.execute(
                    "ALTER TABLE social_directory ADD COLUMN email TEXT NOT NULL DEFAULT ''"
                )
            if "public_key_json" not in directory_columns:
                connection.execute(
                    "ALTER TABLE social_directory ADD COLUMN public_key_json TEXT NOT NULL DEFAULT '{}'"
                )
            room_columns = {
                row[1] for row in connection.execute("PRAGMA table_info(sovereign_rooms)")
            }
            if "passcode_salt" not in room_columns:
                connection.execute(
                    "ALTER TABLE sovereign_rooms ADD COLUMN passcode_salt TEXT NOT NULL DEFAULT ''"
                )
            if "passcode_hash" not in room_columns:
                connection.execute(
                    "ALTER TABLE sovereign_rooms ADD COLUMN passcode_hash TEXT NOT NULL DEFAULT ''"
                )


initialize_archive_store()
user_blocks: Dict[str, Set[str]] = {}
user_blocks_lock = threading.RLock()
with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
    for blocker_id, blocked_id in connection.execute(
        "SELECT blocker_id, blocked_id FROM user_blocks"
    ):
        user_blocks.setdefault(blocker_id, set()).add(blocked_id)


def canonical_user_id(user_id: str) -> str:
    return user_id.removeprefix("google:")


def is_user_blocked(blocker_id: str, blocked_id: str) -> bool:
    blocker = canonical_user_id(blocker_id)
    blocked = canonical_user_id(blocked_id)
    if not blocker or not blocked or blocker == blocked:
        return False
    with user_blocks_lock:
        return blocked in user_blocks.get(blocker, set())


def are_users_blocked(first_user_id: str, second_user_id: str) -> bool:
    return is_user_blocked(first_user_id, second_user_id) or is_user_blocked(
        second_user_id, first_user_id
    )


def scrub_sensitive_tokens(text: str) -> str:
    patterns = (
        r"AIza[0-9A-Za-z_-]{20,}",
        r"sk-or-(?:v1-)?[0-9A-Za-z_-]{16,}",
        r"\bsk-[0-9A-Za-z_-]{20,}",
        r"\bgh[pousr]_[0-9A-Za-z]{20,}",
        r"\bAKIA[0-9A-Z]{16}\b",
        r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b",
        r"\b(?:api[_-]?key|client[_-]?secret|secret|access[_-]?token|password)\s*[:=]\s*[\"']?[A-Za-z0-9._~+/-]{12,}",
        r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    )
    scrubbed = text
    for pattern in patterns:
        scrubbed = re.sub(pattern, "[REDACTED]", scrubbed, flags=re.IGNORECASE)
    return sanitize_ai_output(scrubbed)

class ChatMessage(BaseModel):
    role: str
    content: str = ""
    id: Optional[str] = None
    text: Optional[str] = None
    sender_id: Optional[str] = None
    sender_name: Optional[str] = None
    is_edited: bool = False
    is_deleted: bool = False
    delivered_to: List[str] = Field(default_factory=list)
    read_by: List[str] = Field(default_factory=list)
    reactions: Dict[str, List[str]] = Field(default_factory=dict)
    senderName: Optional[str] = None
    senderEmail: Optional[str] = None
    deleted: bool = False
    isDeleted: bool = False

class ChatRequest(BaseModel):
    user_email: Optional[str] = None
    google_id_token: Optional[str] = None
    prompt: str
    space_mode: Optional[str] = "personal"
    conversation_history: Optional[List[ChatMessage]] = []
    custom_api_key: Optional[str] = None
    language_code: Optional[str] = "en-IN"
    is_team_chat: Optional[bool] = False
    is_observer_active: Optional[bool] = False
    models_cascade: Optional[List[str]] = None


class TopicChannelRequest(BaseModel):
    google_id_token: str
    user_id: str = Field(min_length=1, max_length=256)
    title: str = Field(min_length=1, max_length=80)
    icon: str = Field(min_length=1, max_length=16)


class TopicClearRequest(BaseModel):
    google_id_token: str
    user_id: str = Field(min_length=1, max_length=256)


class PersonalTopicChatRequest(BaseModel):
    google_id_token: str
    user_id: str = Field(min_length=1, max_length=256)
    topic_id: str = Field(pattern=r"^topic_(?:[1-9]|10)$")
    message: str = Field(min_length=1, max_length=20000)
    message_id: Optional[str] = Field(default=None, max_length=128)
    custom_api_key: Optional[str] = None


class VipSessionRequest(BaseModel):
    session_id: str = Field(min_length=16, max_length=128)
    user_email: Optional[str] = None
    is_vip: bool = False
    google_id_token: Optional[str] = None
    action: str = "heartbeat"

class TeamReviewRequest(BaseModel):
    room_id: str = Field(min_length=1, max_length=128)
    google_id_token: str
    custom_api_key: Optional[str] = None
    context_messages: List[Dict[str, Any]] = Field(default_factory=list, max_length=20)


class ArchiveTeamRoom(BaseModel):
    room_id: str = Field(min_length=1, max_length=128)
    room_title: str = Field(default="Team Room", max_length=200)
    host_name: str = Field(default="Unknown host", max_length=120)
    messages: List[Dict[str, Any]] = Field(default_factory=list)
    executive_reviews: List[Dict[str, Any]] = Field(default_factory=list)


class ArchiveSocialThread(BaseModel):
    meta_user_id: str = Field(min_length=1, max_length=128)
    thread_id: str = Field(min_length=1, max_length=128)
    linked_handle: str = Field(default="", max_length=120)
    message_count: Optional[int] = Field(default=None, ge=0)
    messages: List[Dict[str, Any]] = Field(default_factory=list)


class ArchiveSaveRequest(BaseModel):
    google_id_token: str
    personal_messages: Optional[List[Dict[str, Any]]] = None
    personal_message_count: Optional[int] = Field(default=None, ge=0)
    social_threads: Optional[List[ArchiveSocialThread]] = None
    team_rooms: Optional[List[ArchiveTeamRoom]] = None


class ArchiveRestoreRequest(BaseModel):
    google_id_token: str
    user_id: str = Field(min_length=1, max_length=256)
    restore_targets: List[str] = Field(default_factory=list)
    room_ids: List[str] = Field(default_factory=list)
    social_archive_keys: List[str] = Field(default_factory=list)
    meta_user_id: Optional[str] = None


def is_encrypted_message_envelope(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and value.get("v") == 1
        and isinstance(value.get("iv"), str)
        and bool(value["iv"])
        and isinstance(value.get("ciphertext"), str)
        and bool(value["ciphertext"])
        and len(value["ciphertext"]) <= 2_000_000
    )


def get_verified_archive_identity(authorization: Optional[str]) -> Dict[str, str]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required for archive access.")
    identity = verify_google_id_token_claims(authorization.removeprefix("Bearer ").strip())
    if not identity:
        raise HTTPException(status_code=401, detail="Google ID token verification failed.")
    return identity


def save_archive_snapshot(
    user_id: str,
    bucket: str,
    archive_key: str,
    metadata: Dict[str, Any],
    messages: List[Dict[str, Any]],
    saved_at: str,
):
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            connection.execute(
                """
                INSERT INTO archive_snapshots
                    (user_id, bucket, archive_key, metadata_json, messages_json, saved_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, bucket, archive_key) DO UPDATE SET
                    metadata_json = excluded.metadata_json,
                    messages_json = excluded.messages_json,
                    saved_at = excluded.saved_at
                """,
                (
                    user_id,
                    bucket,
                    archive_key,
                    json.dumps(metadata, ensure_ascii=False),
                    json.dumps(messages, ensure_ascii=False),
                    saved_at,
                ),
            )


class RoomConnection:
    def __init__(
        self,
        websocket: WebSocket,
        client_id: str,
        display_name: str,
        avatar_url: str = "",
        email: str = "",
        public_key: Optional[Dict[str, Any]] = None,
        room_title: str = "",
        requested_host_id: str = "",
    ):
        self.websocket = websocket
        self.client_id = client_id
        self.display_name = display_name
        self.avatar_url = avatar_url
        self.email = email
        self.public_key = public_key or {}
        self.room_title = room_title
        self.requested_host_id = requested_host_id


class RoomManager:
    """Blind relay for encrypted room messages and authenticated presence."""

    def __init__(self):
        self.connections: Dict[str, Set[WebSocket]] = {}
        self.identities: Dict[WebSocket, RoomConnection] = {}
        self.messages: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self.lock = asyncio.Lock()

    def _active_users(self, room_id: str) -> List[Dict[str, str]]:
        active_by_id: Dict[str, Dict[str, Any]] = {}
        room_connections = self.connections.get(room_id, set())
        for websocket, info in self.identities.items():
            if websocket in room_connections:
                active_by_id[info.client_id] = {
                    "id": info.client_id,
                    "user_id": info.client_id,
                    "name": info.display_name,
                    "display_name": info.display_name,
                    "email": info.email,
                    "avatar_url": info.avatar_url,
                    "public_key": info.public_key,
                    "status": "active",
                }
        return list(active_by_id.values())

    def _room_members(self, room_id: str) -> List[Dict[str, Any]]:
        with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
            row = connection.execute(
                "SELECT members_json FROM sovereign_rooms WHERE room_id = ?",
                (room_id,),
            ).fetchone()
        if not row:
            return self._active_users(room_id)
        active = {member["id"]: member for member in self._active_users(room_id)}
        try:
            stored_members = json.loads(row[0])
        except (ValueError, TypeError):
            return self._active_users(room_id)
        return [
            {**member, "status": "active" if member["id"] in active else "inactive"}
            for member in stored_members
        ]

    def _persist_room_member(
        self,
        room_id: str,
        connection_info: RoomConnection,
        room_title: str,
        requested_host_id: str,
    ):
        now = datetime.now(timezone.utc).isoformat()
        with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
            with connection:
                connection.execute(
                    "UPDATE social_directory SET public_key_json = ?, updated_at = ? WHERE user_id = ?",
                    (json.dumps(connection_info.public_key), now, connection_info.client_id.removeprefix("google:")),
                )
                row = connection.execute(
                    "SELECT title, host_id, members_json FROM sovereign_rooms WHERE room_id = ?",
                    (room_id,),
                ).fetchone()
                members = json.loads(row[2]) if row else []
                member = {
                    "id": connection_info.client_id,
                    "user_id": connection_info.client_id,
                    "name": connection_info.display_name,
                    "display_name": connection_info.display_name,
                    "email": connection_info.email,
                    "avatar_url": connection_info.avatar_url,
                    "public_key": connection_info.public_key,
                }
                replaced = False
                for index, existing in enumerate(members):
                    if existing.get("id") == connection_info.client_id:
                        members[index] = member
                        replaced = True
                        break
                if not replaced:
                    members.append(member)
                host_id = row[1] if row else (
                    requested_host_id
                    if requested_host_id == connection_info.client_id
                    else connection_info.client_id
                )
                title = row[0] if row else (room_title or room_id)
                connection.execute(
                    """
                    INSERT INTO sovereign_rooms(room_id, title, host_id, members_json, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(room_id) DO UPDATE SET
                        members_json = excluded.members_json,
                        updated_at = excluded.updated_at
                    """,
                    (room_id, title, host_id, json.dumps(members), now),
                )

    def persist_encrypted_message(self, room_id: str, message: Dict[str, Any]):
        with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
            with connection:
                connection.execute(
                    """
                    INSERT INTO encrypted_room_messages(room_id, message_id, message_json, created_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(room_id, message_id) DO UPDATE SET
                        message_json = excluded.message_json
                    """,
                    (
                        room_id,
                        message["message_id"],
                        json.dumps(message),
                        message["created_at"],
                    ),
                )

    async def _presence(self, room_id: str):
        users = self._room_members(room_id)
        for websocket in list(self.connections.get(room_id, set())):
            recipient = self.identities.get(websocket)
            if recipient is None:
                continue
            visible_users = [
                user for user in users
                if user.get("id") == recipient.client_id
                or not are_users_blocked(recipient.client_id, str(user.get("id") or ""))
            ]
            await websocket.send_json({"type": "presence", "users": visible_users})

    def _visible_message(self, message: Dict[str, Any], recipient_id: str) -> bool:
        sender_id = str(message.get("user_id") or message.get("sender_id") or "")
        has_envelope = (
            message.get("is_deleted")
            or recipient_id == sender_id
            or recipient_id in message.get("encrypted_payloads", {})
        )
        return has_envelope and not is_user_blocked(recipient_id, sender_id)

    def _message_for_recipient(self, message: Dict[str, Any], recipient_id: str) -> Dict[str, Any]:
        visible_message = dict(message)
        visible_message["reactions"] = {
            emoji: [
                user_id for user_id in user_ids
                if not are_users_blocked(recipient_id, user_id)
            ]
            for emoji, user_ids in message.get("reactions", {}).items()
            if any(not are_users_blocked(recipient_id, user_id) for user_id in user_ids)
        }
        return visible_message

    async def close_blocked_direct_rooms(self, blocker_id: str, blocked_id: str):
        pair = {f"google:{canonical_user_id(blocker_id)}", f"google:{canonical_user_id(blocked_id)}"}
        async with self.lock:
            for room_id in list(self.connections):
                if not room_id.startswith("direct:"):
                    continue
                members = self._room_members(room_id)
                member_ids = {str(member.get("id") or "") for member in members}
                if not pair.issubset(member_ids):
                    continue
                room_connections = list(self.connections.get(room_id, set()))
                for websocket in room_connections:
                    connection = self.identities.get(websocket)
                    if connection and connection.client_id in pair:
                        self.connections[room_id].discard(websocket)
                        self.identities.pop(websocket, None)
                        await websocket.close(code=1008, reason="This direct room is unavailable because of a block.")
                if not self.connections.get(room_id):
                    self.connections.pop(room_id, None)
                await self._presence(room_id)

    async def connect(self, room_id: str, connection: RoomConnection):
        async with self.lock:
            self.connections.setdefault(room_id, set()).add(connection.websocket)
            self.identities[connection.websocket] = connection
            with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as database:
                rows = database.execute(
                    "SELECT message_json FROM encrypted_room_messages WHERE room_id = ? ORDER BY created_at",
                    (room_id,),
                ).fetchall()
            self.messages[room_id] = {
                message["message_id"]: message
                for (message_json,) in rows
                if (message := json.loads(message_json))
            }
            self._persist_room_member(
                room_id,
                connection,
                getattr(connection, "room_title", room_id),
                getattr(connection, "requested_host_id", ""),
            )
            for message in self.messages[room_id].values():
                if (
                    message["user_id"] != connection.client_id
                    and self._visible_message(message, connection.client_id)
                ):
                    delivered_to = message.setdefault("delivered_to", [])
                    if connection.client_id not in delivered_to:
                        delivered_to.append(connection.client_id)
                        self.persist_encrypted_message(room_id, message)
            await connection.websocket.send_json({
                "type": "room_state",
                "members": [
                    member for member in self._room_members(room_id)
                    if member.get("id") == connection.client_id
                    or not are_users_blocked(connection.client_id, str(member.get("id") or ""))
                ],
                "messages": [
                    self._message_for_recipient(message, connection.client_id)
                    for message in self.messages[room_id].values()
                    if self._visible_message(message, connection.client_id)
                ],
            })
            await self._presence(room_id)
            for message in self.messages[room_id].values():
                if message["delivered_to"]:
                    for peer in list(self.connections.get(room_id, set())):
                        recipient = self.identities.get(peer)
                        if not recipient or not self._visible_message(message, recipient.client_id):
                            continue
                        visible_ids = [
                            user_id for user_id in message["delivered_to"]
                            if not are_users_blocked(recipient.client_id, user_id)
                        ]
                        await peer.send_json({
                            "type": "receipt",
                            "status": "delivered",
                            "message_id": message["message_id"],
                            "user_ids": visible_ids,
                        })

    async def disconnect(self, room_id: str, websocket: WebSocket):
        async with self.lock:
            self.connections.get(room_id, set()).discard(websocket)
            self.identities.pop(websocket, None)
            if not self.connections.get(room_id):
                self.connections.pop(room_id, None)
            await self._presence(room_id)

    async def handle_event(self, room_id: str, websocket: WebSocket, event: Dict[str, Any]):
        async with self.lock:
            connection = self.identities.get(websocket)
            if connection is None:
                return
            event_type = event.get("type")
            messages = self.messages.setdefault(room_id, {})
            if event_type == "message.send":
                if room_id.startswith("direct:") and any(
                    are_users_blocked(connection.client_id, member["id"])
                    for member in self._room_members(room_id)
                    if member["id"] != connection.client_id
                ):
                    await websocket.send_json({"type": "error", "detail": "Direct messages are unavailable because of a block."})
                    await websocket.close(code=1008, reason="Direct room is unavailable.")
                    return
                encrypted_payloads = event.get("encrypted_payloads")
                if (
                    not isinstance(encrypted_payloads, dict)
                    or not encrypted_payloads
                    or len(encrypted_payloads) > 200
                    or not all(
                        isinstance(recipient, str)
                        and isinstance(payload, dict)
                        and payload.get("v") == 1
                        and isinstance(payload.get("iv"), str)
                        and bool(payload.get("iv"))
                        and isinstance(payload.get("ciphertext"), str)
                        and bool(payload.get("ciphertext"))
                        and len(payload.get("ciphertext", "")) <= 2_000_000
                        for recipient, payload in encrypted_payloads.items()
                    )
                ):
                    await websocket.send_json({"type": "error", "detail": "Room messages must be encrypted on the client."})
                    return
                allowed_recipients = {member["id"] for member in self._room_members(room_id)}
                if not set(encrypted_payloads).issubset(allowed_recipients):
                    await websocket.send_json({"type": "error", "detail": "Encrypted payload includes a non-member recipient."})
                    return
                message_id = uuid.uuid4().hex
                created_at = datetime.now(timezone.utc).isoformat()
                message = {
                    "id": message_id,
                    "message_id": message_id,
                    "user_id": connection.client_id,
                    "display_name": str(event.get("sender_name") or connection.display_name)[:80],
                    "encrypted_payloads": encrypted_payloads,
                    "sender_public_key": connection.public_key,
                    "created_at": created_at,
                    "edited": False,
                    "deleted": False,
                    "sender_id": connection.client_id,
                    "sender_name": str(event.get("sender_name") or connection.display_name)[:80],
                    "is_edited": False,
                    "is_deleted": False,
                    "delivered_to": list(dict.fromkeys(
                        self.identities[peer].client_id
                        for peer in self.connections.get(room_id, set())
                        if peer is not websocket and peer in self.identities
                    )),
                    "read_by": [],
                    "reactions": {},
                    "role": "assistant" if event.get("sender_type") == "assistant" else "user",
                }
                eligible_recipients = []
                for peer in list(self.connections.get(room_id, set())):
                    recipient = self.identities.get(peer)
                    if (
                        recipient is None
                        or recipient.client_id not in encrypted_payloads
                        or not self._visible_message(message, recipient.client_id)
                    ):
                        continue
                    eligible_recipients.append(recipient.client_id)
                message["delivered_to"] = [
                    user_id for user_id in message["delivered_to"]
                    if user_id in eligible_recipients
                ]
                messages[message_id] = message
                self.persist_encrypted_message(room_id, message)
                for peer in list(self.connections.get(room_id, set())):
                    recipient = self.identities.get(peer)
                    if recipient is None or recipient.client_id not in eligible_recipients:
                        continue
                    await peer.send_json({
                        "type": "message",
                        "action": "send",
                        "message": self._message_for_recipient(message, recipient.client_id),
                    })
                if message["delivered_to"]:
                    for peer in list(self.connections.get(room_id, set())):
                        recipient = self.identities.get(peer)
                        if recipient and self._visible_message(message, recipient.client_id):
                            await peer.send_json({
                                "type": "receipt",
                                "status": "delivered",
                                "message_id": message_id,
                                "user_ids": message["delivered_to"],
                            })
            elif event_type in ("message.edit", "message.delete"):
                message_id = str(event.get("message_id") or "")
                message = messages.get(message_id)
                if message is None or message["user_id"] != connection.client_id:
                    await websocket.send_json({"type": "error", "detail": "Message not found or not editable."})
                    return
                if event_type == "message.edit":
                    encrypted_payloads = event.get("encrypted_payloads")
                    if (
                        not isinstance(encrypted_payloads, dict)
                        or not encrypted_payloads
                        or len(encrypted_payloads) > 200
                        or not all(is_encrypted_message_envelope(payload) for payload in encrypted_payloads.values())
                        or not set(encrypted_payloads).issubset(
                            {member["id"] for member in self._room_members(room_id)}
                        )
                    ):
                        await websocket.send_json({"type": "error", "detail": "Edited room messages must be encrypted on the client."})
                        return
                    message["encrypted_payloads"] = encrypted_payloads
                    message["sender_public_key"] = connection.public_key
                    message["edited"] = True
                    message["is_edited"] = True
                    action = "edit"
                else:
                    message["deleted"] = True
                    message["is_deleted"] = True
                    message["encrypted_payloads"] = {}
                    action = "delete"
                self.persist_encrypted_message(room_id, message)
                for peer in list(self.connections.get(room_id, set())):
                    recipient = self.identities.get(peer)
                    if recipient and self._visible_message(message, recipient.client_id):
                        await peer.send_json({
                            "type": "message",
                            "action": action,
                            "message": self._message_for_recipient(message, recipient.client_id),
                        })
            elif event_type == "message_reaction":
                message_id = str(event.get("message_id") or "")
                emoji = str(event.get("emoji") or "")
                action = event.get("action")
                message = messages.get(message_id)
                if event.get("room_id") not in (None, room_id) or event.get("user_id") not in (
                    None,
                    connection.client_id,
                ):
                    await websocket.send_json({"type": "error", "detail": "Reaction identity or room did not match this connection."})
                    return
                if message is None or message.get("is_deleted"):
                    await websocket.send_json({"type": "error", "detail": "Message not found or reactions are unavailable."})
                    return
                if action not in ("add", "remove") or emoji not in ALLOWED_ROOM_REACTIONS:
                    await websocket.send_json({"type": "error", "detail": "Choose one valid emoji reaction."})
                    return
                if are_users_blocked(connection.client_id, str(message.get("user_id") or "")):
                    await websocket.send_json({"type": "error", "detail": "Reactions between blocked users are unavailable."})
                    return
                reactions = message.setdefault("reactions", {})
                reactors = reactions.setdefault(emoji, [])
                if action == "add" and connection.client_id not in reactors:
                    if len(reactors) >= 200:
                        await websocket.send_json({"type": "error", "detail": "This reaction has reached its room limit."})
                        return
                    reactors.append(connection.client_id)
                elif action == "remove":
                    reactions[emoji] = [user_id for user_id in reactors if user_id != connection.client_id]
                    if not reactions[emoji]:
                        reactions.pop(emoji, None)
                self.persist_encrypted_message(room_id, message)
                for peer in list(self.connections.get(room_id, set())):
                    recipient = self.identities.get(peer)
                    if not recipient or not self._visible_message(message, recipient.client_id):
                        continue
                    visible_reactions = self._message_for_recipient(
                        message, recipient.client_id
                    )["reactions"]
                    await peer.send_json({
                        "type": "message_reaction",
                        "message_id": message_id,
                        "reactions": {
                            reaction: user_ids for reaction, user_ids in visible_reactions.items() if user_ids
                        },
                    })
            elif event_type in ("receipt.delivered", "receipt.read"):
                message_id = str(event.get("message_id") or "")
                if message_id not in messages:
                    await websocket.send_json({"type": "error", "detail": "Message not found."})
                    return
                receipt_field = "delivered_to" if event_type == "receipt.delivered" else "read_by"
                current_ids = messages[message_id].setdefault(receipt_field, [])
                recipient_ids = (
                    [
                        self.identities[peer].client_id
                        for peer in self.connections.get(room_id, set())
                        if peer is not websocket and peer in self.identities
                        and not is_user_blocked(
                            self.identities[peer].client_id,
                            messages[message_id].get("user_id", ""),
                        )
                    ]
                    if event_type == "receipt.delivered"
                    else [connection.client_id]
                )
                current_ids.extend(user_id for user_id in recipient_ids if user_id not in current_ids)
                self.persist_encrypted_message(room_id, messages[message_id])
                for peer in list(self.connections.get(room_id, set())):
                    recipient = self.identities.get(peer)
                    if not recipient or not self._visible_message(messages[message_id], recipient.client_id):
                        continue
                    visible_ids = [
                        user_id for user_id in current_ids
                        if not are_users_blocked(recipient.client_id, user_id)
                    ]
                    await peer.send_json({
                        "type": "receipt",
                        "status": "delivered" if event_type == "receipt.delivered" else "read",
                        "message_id": message_id,
                        "user_ids": visible_ids,
                        "at": datetime.now(timezone.utc).isoformat(),
                    })
            else:
                await websocket.send_json({"type": "error", "detail": "Unsupported room event."})


room_manager = RoomManager()


def verified_identity_from_token(token: Optional[str]) -> Dict[str, str]:
    identity = verify_google_id_token_claims(token)
    if not identity:
        raise HTTPException(status_code=401, detail="Google ID token verification failed.")
    return identity


class SocialDiscoveryRequest(BaseModel):
    google_id_token: str
    meta_access_token: str = Field(min_length=1, max_length=4096)
    meta_user_id: str = Field(min_length=1, max_length=128)
    handle: str = Field(default="", max_length=120)


class SocialHandleRequest(BaseModel):
    google_id_token: str
    handle: str = Field(min_length=1, max_length=120)


class DirectRoomRequest(BaseModel):
    google_id_token: str
    target_user_id: str = Field(min_length=1, max_length=256)


class FriendRelationshipRequest(BaseModel):
    google_id_token: str
    user_id: str = Field(min_length=1, max_length=256)
    target_user_id: str = Field(min_length=1, max_length=256)


class PublicRoomKeyRequest(BaseModel):
    google_id_token: str
    public_key: Dict[str, Any]


class RoomPasscodeUpdateRequest(BaseModel):
    google_id_token: str
    room_id: str = Field(min_length=1, max_length=128)
    passcode: str = Field(min_length=6, max_length=64)


def get_online_user_ids() -> Set[str]:
    return {
        info.client_id.removeprefix("google:")
        for info in room_manager.identities.values()
        if info.client_id.startswith("google:")
    }


def normalize_room_passcode(value: str) -> str:
    return re.sub(r"[\s-]", "", value)


def hash_room_passcode(passcode: str, salt: bytes) -> str:
    return hashlib.scrypt(
        normalize_room_passcode(passcode).encode("utf-8"),
        salt=salt,
        n=2**14,
        r=8,
        p=1,
        dklen=32,
    ).hex()


def authorize_room_member(
    room_id: str,
    identity: Dict[str, str],
    passcode: str,
    room_title: str,
    public_key: Dict[str, Any],
):
    client_id = f"google:{identity['sub']}"
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        row = connection.execute(
            """
            SELECT title, host_id, members_json, passcode_salt, passcode_hash
            FROM sovereign_rooms WHERE room_id = ?
            """,
            (room_id,),
        ).fetchone()
        if room_id.startswith("direct:"):
            members = json.loads(row[2]) if row else []
            if not any(member.get("id") == client_id for member in members):
                raise HTTPException(status_code=403, detail="Direct room membership is required.")
            return

        normalized_passcode = normalize_room_passcode(passcode)
        if not row:
            if len(normalized_passcode) < 6:
                raise HTTPException(status_code=403, detail="A valid room passcode is required to create this room.")
            salt = os.urandom(16)
            member = {
                "id": client_id,
                "user_id": client_id,
                "name": identity["name"] or identity["email"],
                "display_name": identity["name"] or identity["email"],
                "email": identity["email"],
                "avatar_url": "",
                "public_key": public_key,
            }
            with connection:
                connection.execute(
                    """
                    INSERT INTO sovereign_rooms
                        (room_id, title, host_id, members_json, passcode_salt, passcode_hash, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        room_id,
                        room_title or room_id,
                        client_id,
                        json.dumps([member]),
                        salt.hex(),
                        hash_room_passcode(normalized_passcode, salt),
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
            return

        members = json.loads(row[2])
        if any(member.get("id") == client_id for member in members):
            return
        if not row[3] or not row[4] or len(normalized_passcode) < 6:
            raise HTTPException(status_code=403, detail="Room membership or a valid room passcode is required.")
        try:
            salt = bytes.fromhex(row[3])
        except ValueError as error:
            raise HTTPException(status_code=403, detail="Room access configuration is invalid.") from error
        submitted_hash = hash_room_passcode(normalized_passcode, salt)
        if not hmac.compare_digest(submitted_hash, row[4]):
            raise HTTPException(status_code=403, detail="Room membership or passcode verification failed.")


@app.post("/api/rooms/passcode")
async def update_room_passcode(req: RoomPasscodeUpdateRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
    client_id = f"google:{identity['sub']}"
    salt = os.urandom(16)
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            row = connection.execute(
                "SELECT host_id FROM sovereign_rooms WHERE room_id = ?",
                (req.room_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Room does not exist.")
            if row[0] != client_id:
                raise HTTPException(status_code=403, detail="Only the sovereign room host can update its passcode.")
            connection.execute(
                "UPDATE sovereign_rooms SET passcode_salt = ?, passcode_hash = ?, updated_at = ? WHERE room_id = ?",
                (
                    salt.hex(),
                    hash_room_passcode(req.passcode, salt),
                    datetime.now(timezone.utc).isoformat(),
                    req.room_id,
                ),
            )
    return {"status": "success"}


@app.post("/api/social/discovery")
async def register_social_discovery(req: SocialDiscoveryRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
    try:
        meta_response = await asyncio.to_thread(
            requests.get,
            "https://graph.facebook.com/me",
            params={"fields": "id,name,picture"},
            headers={"Authorization": f"Bearer {req.meta_access_token.strip()}"},
            timeout=8.0,
        )
        if meta_response.status_code != 200:
            raise HTTPException(status_code=401, detail="Meta profile verification failed.")
        meta_profile = meta_response.json()
    except requests.RequestException as error:
        raise HTTPException(status_code=502, detail="Meta profile verification is temporarily unavailable.") from error
    if str(meta_profile.get("id") or "") != req.meta_user_id:
        raise HTTPException(status_code=403, detail="Meta profile does not match the linked account.")

    display_name = str(meta_profile.get("name") or identity["name"] or "Genie user")[:120]
    avatar_url = str(
        (meta_profile.get("picture") or {}).get("data", {}).get("url") or ""
    )[:2048]
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            connection.execute(
                """
                INSERT INTO social_directory
                    (user_id, display_name, handle, avatar_url, meta_user_id, email, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    display_name = excluded.display_name,
                    handle = excluded.handle,
                    avatar_url = excluded.avatar_url,
                    meta_user_id = excluded.meta_user_id,
                    email = excluded.email,
                    updated_at = excluded.updated_at
                """,
                (
                    identity["sub"],
                    display_name,
                    req.handle.strip() or display_name,
                    avatar_url,
                    req.meta_user_id,
                    identity["email"],
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
    return {"status": "success", "is_discoverable": True, "handle": req.handle.strip() or display_name}


@app.delete("/api/social/discovery")
async def remove_social_discovery(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    identity = await asyncio.to_thread(verified_identity_from_token, authorization.removeprefix("Bearer ").strip())
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            connection.execute("DELETE FROM social_directory WHERE user_id = ?", (identity["sub"],))
    return {"status": "success", "is_discoverable": False}


@app.put("/api/social/discovery")
async def update_social_handle(req: SocialHandleRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            cursor = connection.execute(
                "UPDATE social_directory SET handle = ?, updated_at = ? WHERE user_id = ?",
                (req.handle.strip(), datetime.now(timezone.utc).isoformat(), identity["sub"]),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Link Meta before publishing a social handle.")
    return {"status": "success", "handle": req.handle.strip()}


@app.get("/api/social/friends")
async def get_social_friends(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    identity = await asyncio.to_thread(verified_identity_from_token, authorization.removeprefix("Bearer ").strip())
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        rows = connection.execute(
            """
            SELECT user_id, display_name, handle, avatar_url
            FROM social_directory
            WHERE user_id != ?
              AND NOT EXISTS (
                  SELECT 1 FROM user_blocks
                  WHERE (blocker_id = ? AND blocked_id = social_directory.user_id)
                     OR (blocker_id = social_directory.user_id AND blocked_id = ?)
              )
            ORDER BY handle COLLATE NOCASE
            """,
            (identity["sub"], identity["sub"], identity["sub"]),
        ).fetchall()
    online_users = get_online_user_ids()
    return {
        "friends": [
            {
                "user_id": user_id,
                "display_name": name,
                "handle": handle,
                "avatar_url": avatar,
                "is_online": user_id in online_users,
            }
            for user_id, name, handle, avatar in rows
        ]
    }


@app.post("/api/friends/block")
async def block_friend(req: FriendRelationshipRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
    if canonical_user_id(req.user_id) != identity["sub"]:
        raise HTTPException(status_code=403, detail="You can only block users for your signed-in account.")
    target_id = canonical_user_id(req.target_user_id)
    if target_id == identity["sub"]:
        raise HTTPException(status_code=400, detail="You cannot block your own account.")
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            connection.execute(
                "INSERT OR IGNORE INTO user_blocks(blocker_id, blocked_id, created_at) VALUES (?, ?, ?)",
                (identity["sub"], target_id, datetime.now(timezone.utc).isoformat()),
            )
    with user_blocks_lock:
        user_blocks.setdefault(identity["sub"], set()).add(target_id)
    await room_manager.close_blocked_direct_rooms(identity["sub"], target_id)
    return {"status": "success", "user_id": identity["sub"], "target_user_id": target_id}


@app.post("/api/friends/unblock")
async def unblock_friend(req: FriendRelationshipRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
    if canonical_user_id(req.user_id) != identity["sub"]:
        raise HTTPException(status_code=403, detail="You can only unblock users for your signed-in account.")
    target_id = canonical_user_id(req.target_user_id)
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            connection.execute(
                "DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?",
                (identity["sub"], target_id),
            )
    with user_blocks_lock:
        blocked_users = user_blocks.get(identity["sub"])
        if blocked_users:
            blocked_users.discard(target_id)
            if not blocked_users:
                user_blocks.pop(identity["sub"], None)
    return {"status": "success", "user_id": identity["sub"], "target_user_id": target_id}


@app.get("/api/friends/blocked-list")
async def get_blocked_friends(
            user_id: str,
            authorization: Optional[str] = Header(default=None),
):
            if not authorization or not authorization.startswith("Bearer "):
                raise HTTPException(status_code=401, detail="Google sign-in is required.")
            identity = await asyncio.to_thread(verified_identity_from_token, authorization.removeprefix("Bearer ").strip())
            if canonical_user_id(user_id) != identity["sub"]:
                raise HTTPException(status_code=403, detail="You can only view your own blocked users.")
            with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
                rows = connection.execute(
                    """
                    SELECT b.blocked_id, d.display_name, d.handle, d.avatar_url
                    FROM user_blocks b
                    LEFT JOIN social_directory d ON d.user_id = b.blocked_id
                    WHERE b.blocker_id = ?
                    ORDER BY COALESCE(d.handle, d.display_name, b.blocked_id) COLLATE NOCASE
                    """,
                    (identity["sub"],),
                ).fetchall()
            return {
                "blocked_users": [
                    {
                        "user_id": blocked_id,
                        "display_name": display_name or handle or "Genie user",
                        "handle": handle or display_name or "Genie user",
                        "avatar_url": avatar_url or "",
                    }
                    for blocked_id, display_name, handle, avatar_url in rows
                ]
            }


@app.post("/api/crypto/public-key")
async def publish_room_public_key(req: PublicRoomKeyRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
    public_key = req.public_key
    if (
        public_key.get("kty") != "EC"
        or public_key.get("crv") != "P-256"
        or not public_key.get("x")
        or not public_key.get("y")
        or len(public_key.get("x", "")) > 128
        or len(public_key.get("y", "")) > 128
    ):
        raise HTTPException(status_code=400, detail="A valid P-256 public key is required.")
    client_id = f"google:{identity['sub']}"
    encoded_key = json.dumps(public_key)
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            connection.execute(
                "UPDATE social_directory SET public_key_json = ?, updated_at = ? WHERE user_id = ?",
                (encoded_key, datetime.now(timezone.utc).isoformat(), identity["sub"]),
            )
            rooms = connection.execute(
                "SELECT room_id, members_json FROM sovereign_rooms"
            ).fetchall()
            for room_id, members_json in rooms:
                members = json.loads(members_json)
                changed = False
                for member in members:
                    if member.get("id") == client_id:
                        member["public_key"] = public_key
                        changed = True
                if changed:
                    connection.execute(
                        "UPDATE sovereign_rooms SET members_json = ?, updated_at = ? WHERE room_id = ?",
                        (json.dumps(members), datetime.now(timezone.utc).isoformat(), room_id),
                    )
    return {"status": "success"}


@app.post("/api/social/direct-room")
async def create_direct_room(req: DirectRoomRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
    if req.target_user_id == identity["sub"]:
        raise HTTPException(status_code=400, detail="A direct room requires another user.")
    if are_users_blocked(identity["sub"], req.target_user_id):
        raise HTTPException(status_code=403, detail="This direct chat is unavailable because of a block.")
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        target = connection.execute(
            """
            SELECT user_id, display_name, handle, avatar_url, public_key_json
            FROM social_directory WHERE user_id = ?
            """,
            (req.target_user_id,),
        ).fetchone()
        requester_key_row = connection.execute(
            "SELECT public_key_json FROM social_directory WHERE user_id = ?",
            (identity["sub"],),
        ).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="This user is not in the discoverable directory.")
        existing = connection.execute(
            "SELECT room_id, title FROM sovereign_rooms WHERE room_id LIKE 'direct:%' AND members_json LIKE ?",
            (f"%google:{identity['sub']}%",),
        ).fetchall()
        current_member_key = f"google:{identity['sub']}"
        target_member_key = f"google:{req.target_user_id}"
        room_id = ""
        for candidate_id, _ in existing:
            members_row = connection.execute(
                "SELECT members_json FROM sovereign_rooms WHERE room_id = ?", (candidate_id,)
            ).fetchone()
            member_ids = {
                member.get("id")
                for member in json.loads(members_row[0])
            } if members_row else set()
            if current_member_key in member_ids and target_member_key in member_ids:
                room_id = candidate_id
                break
        if not room_id:
            pair = ":".join(sorted((identity["sub"], req.target_user_id)))
            room_id = f"direct:{hashlib.sha256(pair.encode('utf-8')).hexdigest()[:32]}"
            members = [
                {
                    "id": current_member_key,
                    "user_id": current_member_key,
                    "name": identity["name"] or identity["email"],
                    "display_name": identity["name"] or identity["email"],
                    "email": identity["email"],
                    "avatar_url": "",
                    "public_key": json.loads(requester_key_row[0] or "{}") if requester_key_row else {},
                },
                {
                    "id": target_member_key,
                    "user_id": target_member_key,
                    "name": target[1],
                    "display_name": target[1],
                    "email": "",
                    "avatar_url": target[3],
                    "public_key": json.loads(target[4] or "{}"),
                },
            ]
            title = target[2] or target[1]
            with connection:
                connection.execute(
                    """
                    INSERT OR IGNORE INTO sovereign_rooms(room_id, title, host_id, members_json, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        room_id,
                        title,
                        current_member_key,
                        json.dumps(members),
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
    return {"room_id": room_id, "title": target[2] or target[1]}


@app.get("/api/rooms")
async def get_user_rooms(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    identity = await asyncio.to_thread(verified_identity_from_token, authorization.removeprefix("Bearer ").strip())
    member_id = f"google:{identity['sub']}"
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        rows = connection.execute(
            "SELECT room_id, title, host_id, members_json, updated_at FROM sovereign_rooms ORDER BY updated_at DESC"
        ).fetchall()
    online_users = get_online_user_ids()
    return {
        "rooms": [
            {
                "room_id": room_id,
                "title": title,
                "host_id": host_id,
                "members": [
                    {
                        **member,
                        "status": "active" if member.get("id", "").removeprefix("google:") in online_users else "inactive",
                    }
                    for member in json.loads(members_json)
                    if member.get("id") == member_id
                    or not are_users_blocked(member_id, str(member.get("id") or ""))
                ],
                "updated_at": updated_at,
            }
            for room_id, title, host_id, members_json, updated_at in rows
            if any(member.get("id") == member_id for member in json.loads(members_json))
            and not (
                room_id.startswith("direct:")
                and any(
                    are_users_blocked(member_id, str(member.get("id") or ""))
                    for member in json.loads(members_json)
                    if member.get("id") != member_id
                )
            )
        ]
    }


@app.get("/")
def read_root():
    return {"status": "ok", "service": "Personal AI Genie Backend", "version": "4.8.0"}


def verify_google_id_token_claims(id_token: Optional[str]) -> Optional[Dict[str, str]]:
    """Verify a Google ID token and return its verified identity claims."""
    client_id = (os.getenv("NEXT_PUBLIC_GOOGLE_CLIENT_ID") or "").strip()
    client_id = client_id or (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
    token = (id_token or "").strip()
    if not client_id or not token or len(token) > 8192:
        return None
    try:
        response = requests.get(
            GOOGLE_TOKENINFO_URL,
            params={"id_token": token},
            timeout=8.0,
        )
        if response.status_code != 200:
            return None
        claims = response.json()
        audience = claims.get("aud")
        issuer = claims.get("iss")
        expires_at = int(claims.get("exp", "0"))
        email = str(claims.get("email") or "").strip().lower()
        email_verified = claims.get("email_verified") is True or claims.get("email_verified") == "true"
        if (
            audience != client_id
            or issuer not in ("accounts.google.com", "https://accounts.google.com")
            or expires_at <= int(time.time())
            or not claims.get("sub")
            or not email
            or not email_verified
        ):
            return None
        return {
            "email": email,
            "sub": str(claims["sub"]),
            "name": str(claims.get("name") or ""),
        }
    except (requests.RequestException, ValueError, TypeError):
        return None


def verify_google_id_token(id_token: Optional[str]) -> Optional[str]:
    claims = verify_google_id_token_claims(id_token)
    return claims["email"] if claims else None


def get_chat_identity(request: Request, verified_email: Optional[str]) -> str:
    if verified_email:
        return f"google:{verified_email}"
    client_host = request.client.host if request.client else "unknown"
    stable_ip = hashlib.sha256(client_host.encode("utf-8")).hexdigest()
    return f"guest:{stable_ip}"


def consume_daily_message(identity: str):
    today = datetime.now(timezone.utc).date().isoformat()
    with daily_message_counts_lock:
        stale_keys = [key for key in daily_message_counts if key[1] != today]
        for key in stale_keys:
            daily_message_counts.pop(key, None)
        key = (identity, today)
        used = daily_message_counts.get(key, 0)
        if used >= DAILY_MESSAGE_LIMIT:
            raise HTTPException(
                status_code=429,
                detail={"message": "Daily message limit reached.", "limit": DAILY_MESSAGE_LIMIT},
            )
        daily_message_counts[key] = used + 1

def request_openrouter_model(
    model_slug: str,
    api_key: str,
    prompt: str,
    history: List[ChatMessage],
    diagnostics: List[str],
) -> Optional[str]:
    """Helper to query a specific model on OpenRouter."""
    messages = [
        {
            "role": "system",
            "content": (
                "You are Personal AI Genie, an intelligent, authentic, and helpful AI collaborator. "
                "Answer questions thoroughly, accurately, and naturally. Respond in the language used by the user. "
                "Never disclose private configuration, credentials, environment variables, server scripts, or "
                "internal implementations.\n\n"
                + get_platform_system_manifest()
            ),
        }
    ]
    if history:
        for msg in history[-4:]:
            role = "assistant" if msg.role in ["model", "assistant"] else "user"
            messages.append({"role": role, "content": msg.content})
    messages.append({"role": "user", "content": prompt})

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://personal-ai-genie-ten.vercel.app",
        "X-Title": "Personal AI Genie",
    }

    payload = {
        "model": model_slug,
        "messages": messages,
    }

    try:
        resp = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=30.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            choices = data.get("choices", [])
            if choices:
                content = choices[0].get("message", {}).get("content", "")
                if content and content.strip():
                    return scrub_sensitive_tokens(content.strip())
        else:
            diagnostics.append(f"OpenRouter {model_slug} returned HTTP {resp.status_code}.")
            print(f"OpenRouter [{model_slug}] returned HTTP {resp.status_code}.")
            if resp.status_code in (401, 403):
                return None
    except Exception as err:
        diagnostics.append(f"OpenRouter {model_slug} request failed ({type(err).__name__}).")
        print(f"OpenRouter [{model_slug}] request failed ({type(err).__name__}).")

    return None

def request_gemini_direct(
    model_name: str,
    api_key: str,
    prompt: str,
    history: List[ChatMessage],
    diagnostics: List[str],
) -> Optional[str]:
    """Direct Google Gemini REST endpoint."""
    if not api_key:
        return None

    clean_model = model_name.removeprefix("models/")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{clean_model}:generateContent"
    sanitized_key = api_key.strip()
    if not sanitized_key:
        return None

    contents = []
    if history:
        for msg in history[-4:]:
            role = "user" if msg.role == "user" else "model"
            contents.append({"role": role, "parts": [{"text": msg.content}]})

    contents.append({"role": "user", "parts": [{"text": prompt}]})

    payload = {
        "contents": contents,
        "systemInstruction": {
            "parts": [{
                "text": (
                    "You are Personal AI Genie, a helpful and authentic AI collaborator. "
                    "Answer questions directly, thoroughly, and clearly. Never disclose private configuration, "
                    "credentials, environment variables, server scripts, or internal implementations.\n\n"
                    + get_platform_system_manifest()
                )
            }]
        },
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2048},
    }

    try:
        resp = requests.post(
            url,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": sanitized_key,
            },
            timeout=15.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            candidates = data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts and "text" in parts[0]:
                    return scrub_sensitive_tokens(parts[0]["text"].strip())
        else:
            try:
                error_body = resp.json().get("error", {})
            except (ValueError, AttributeError):
                error_body = {}
            upstream_message = error_body.get("message")
            upstream_status = error_body.get("status")
            upstream_detail = ": ".join(
                value for value in (upstream_status, upstream_message) if value
            )
            diagnostic = f"Gemini {clean_model} returned HTTP {resp.status_code}"
            if upstream_detail:
                diagnostic = f"{diagnostic}: {upstream_detail}"
            diagnostics.append(f"{diagnostic}.")
            print(f"{diagnostic}.")
    except Exception as e:
        diagnostics.append(f"Gemini {clean_model} request failed ({type(e).__name__}).")
        print(f"Gemini {clean_model} request failed ({type(e).__name__}).")

    return None

@app.post("/api/chat")
@app.post("//api/chat")
async def handle_chat(req: ChatRequest, request: Request):
    if req.is_team_chat:
        raise HTTPException(
            status_code=400,
            detail="Human room messages must use the room WebSocket and are not sent to an AI provider.",
        )
    history = req.conversation_history or []
    verified_email = verify_google_id_token(req.google_id_token) if req.google_id_token else None
    if req.google_id_token and not verified_email:
        raise HTTPException(status_code=401, detail="Google ID token verification failed.")
    if not (req.custom_api_key or "").strip():
        consume_daily_message(get_chat_identity(request, verified_email))
    or_key = os.getenv("OPENROUTER_API_KEY", OPENROUTER_KEY).strip()
    user_gemini_key = (req.custom_api_key or "").strip()
    server_gemini_key = (os.getenv("GEMINI_API_KEY") or DEFAULT_GEMINI_KEY).strip()
    gemini_key = user_gemini_key or server_gemini_key
    diagnostics: List[str] = []

    # 1. Primary: Direct Google Gemini (if key provided and valid)
    if gemini_key:
        for model in GEMINI_MODELS:
            reply = request_gemini_direct(model, gemini_key, req.prompt, history, diagnostics)
            if reply:
                return {"reply": reply, "model_used": model}

    # 2. Resilient OpenRouter: Loops through free routes including Llama 3.3 70B Free
    if or_key:
        for model_slug in OPENROUTER_FREE_MODELS:
            print(f"Attempting OpenRouter free model: {model_slug}...")
            reply = request_openrouter_model(model_slug, or_key, req.prompt, history, diagnostics)
            if reply:
                return {"reply": reply, "model_used": model_slug}
            if diagnostics and any(
                "OpenRouter" in diagnostic and ("HTTP 401." in diagnostic or "HTTP 403." in diagnostic)
                for diagnostic in diagnostics
            ):
                break

    if not gemini_key and not or_key:
        raise HTTPException(
            status_code=503,
            detail="No AI providers are configured. Set GEMINI_API_KEY or OPENROUTER_API_KEY on the backend, or provide a BYOK key.",
        )

    diagnostic = " ".join(diagnostics) or "All configured AI providers returned empty responses."
    raise HTTPException(status_code=503, detail=f"AI provider requests failed: {diagnostic}")


def verify_topic_owner(token: str, requested_user_id: str) -> Dict[str, str]:
    identity = verified_identity_from_token(token)
    if canonical_user_id(requested_user_id) != identity["sub"]:
        raise HTTPException(status_code=403, detail="Topic channels are available only to their signed-in owner.")
    return identity


def serialize_topic(row: tuple[Any, ...]) -> Dict[str, Any]:
    user_id, topic_id, title, icon, messages_json, created_at, updated_at = row
    messages = json.loads(messages_json)
    return {
        "id": topic_id,
        "user_id": user_id,
        "title": title,
        "icon": icon,
        "messages": messages,
        "message_count": len(messages),
        "created_at": created_at,
        "updated_at": updated_at,
    }


def ensure_default_topic(connection: sqlite3.Connection, user_id: str):
    row = connection.execute(
        "SELECT 1 FROM personal_topic_channels WHERE user_id = ? LIMIT 1",
        (user_id,),
    ).fetchone()
    if row:
        return
    now = datetime.now(timezone.utc).isoformat()
    connection.execute(
        """
        INSERT INTO personal_topic_channels
            (user_id, topic_id, title, icon, messages_json, created_at, updated_at)
        VALUES (?, 'topic_1', 'General', '💬', '[]', ?, ?)
        """,
        (user_id, now, now),
    )


@app.get("/api/personal/topics")
async def list_personal_topics(
    user_id: str,
    authorization: Optional[str] = Header(default=None),
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required for personal topics.")
    identity = verify_topic_owner(
        authorization.removeprefix("Bearer ").strip(),
        user_id,
    )
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            ensure_default_topic(connection, identity["sub"])
        rows = connection.execute(
            """
            SELECT user_id, topic_id, title, icon, messages_json, created_at, updated_at
            FROM personal_topic_channels
            WHERE user_id = ?
            ORDER BY CAST(SUBSTR(topic_id, 7) AS INTEGER)
            LIMIT 10
            """,
            (identity["sub"],),
        ).fetchall()
    return {"topics": [serialize_topic(row) for row in rows], "limit": 10}


@app.post("/api/personal/topics/create")
async def create_personal_topic(req: TopicChannelRequest):
    identity = verify_topic_owner(req.google_id_token, req.user_id)
    title = req.title.strip()
    icon = req.icon.strip()
    if not title or not icon:
        raise HTTPException(status_code=422, detail="Topic title and icon cannot be blank.")
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        connection.execute("BEGIN IMMEDIATE")
        with connection:
            ensure_default_topic(connection, identity["sub"])
            rows = connection.execute(
                "SELECT topic_id FROM personal_topic_channels WHERE user_id = ?",
                (identity["sub"],),
            ).fetchall()
            if len(rows) >= 10:
                raise HTTPException(status_code=409, detail="You can create up to 10 topic channels.")
            existing_ids = {row[0] for row in rows}
            topic_id = next(
                f"topic_{index}" for index in range(1, 11)
                if f"topic_{index}" not in existing_ids
            )
            connection.execute(
                """
                INSERT INTO personal_topic_channels
                    (user_id, topic_id, title, icon, messages_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, '[]', ?, ?)
                """,
                (identity["sub"], topic_id, title, icon, now, now),
            )
    return {
        "topic": {
            "id": topic_id,
            "user_id": identity["sub"],
            "title": title,
            "icon": icon,
            "messages": [],
            "message_count": 0,
            "created_at": now,
            "updated_at": now,
        }
    }


@app.put("/api/personal/topics/{topic_id}")
async def update_personal_topic(topic_id: str, req: TopicChannelRequest):
    identity = verify_topic_owner(req.google_id_token, req.user_id)
    if not re.fullmatch(r"topic_(?:[1-9]|10)", topic_id):
        raise HTTPException(status_code=400, detail="Invalid topic channel ID.")
    title = req.title.strip()
    icon = req.icon.strip()
    if not title or not icon:
        raise HTTPException(status_code=422, detail="Topic title and icon cannot be blank.")
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            cursor = connection.execute(
                """
                UPDATE personal_topic_channels
                SET title = ?, icon = ?, updated_at = ?
                WHERE user_id = ? AND topic_id = ?
                """,
                (
                    title,
                    icon,
                    datetime.now(timezone.utc).isoformat(),
                    identity["sub"],
                    topic_id,
                ),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Topic channel was not found.")
        row = connection.execute(
            """
            SELECT user_id, topic_id, title, icon, messages_json, created_at, updated_at
            FROM personal_topic_channels WHERE user_id = ? AND topic_id = ?
            """,
            (identity["sub"], topic_id),
        ).fetchone()
    return {"topic": serialize_topic(row)}


@app.delete("/api/personal/topics/{topic_id}/clear")
async def clear_personal_topic(topic_id: str, req: TopicClearRequest):
    identity = verify_topic_owner(req.google_id_token, req.user_id)
    if not re.fullmatch(r"topic_(?:[1-9]|10)", topic_id):
        raise HTTPException(status_code=400, detail="Invalid topic channel ID.")
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            cursor = connection.execute(
                """
                UPDATE personal_topic_channels
                SET messages_json = '[]', updated_at = ?
                WHERE user_id = ? AND topic_id = ?
                """,
                (datetime.now(timezone.utc).isoformat(), identity["sub"], topic_id),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Topic channel was not found.")
    return {"status": "success", "topic_id": topic_id}


@app.post("/api/personal/chat")
async def personal_topic_chat(req: PersonalTopicChatRequest):
    identity = verify_topic_owner(req.google_id_token, req.user_id)
    diagnostics: List[str] = []
    api_key = (req.custom_api_key or os.getenv("GEMINI_API_KEY", DEFAULT_GEMINI_KEY)).strip()
    openrouter_key = (os.getenv("OPENROUTER_API_KEY") or OPENROUTER_KEY).strip()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        row = connection.execute(
            """
            SELECT messages_json FROM personal_topic_channels
            WHERE user_id = ? AND topic_id = ?
            """,
            (identity["sub"], req.topic_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Topic channel was not found.")

    saved_messages = json.loads(row[0])
    history = [
        ChatMessage(role=message["role"], content=message.get("content", ""))
        for message in saved_messages[-40:]
        if message.get("role") in ("user", "assistant", "model")
    ]
    if not (req.custom_api_key or "").strip():
        consume_daily_message(f"google:{identity['email']}")

    reply: Optional[str] = None
    model_used = ""
    for model in GEMINI_MODELS:
        reply = request_gemini_direct(model, api_key, req.message, history, diagnostics)
        if reply:
            model_used = model
            break
    if not reply and openrouter_key:
        for model in OPENROUTER_FREE_MODELS:
            reply = request_openrouter_model(model, openrouter_key, req.message, history, diagnostics)
            if reply:
                model_used = model
                break
            if any("HTTP 401." in item or "HTTP 403." in item for item in diagnostics):
                break
    if not reply:
        if not api_key and not openrouter_key:
            raise HTTPException(
                status_code=503,
                detail="No AI providers are configured. Add a BYOK key or ask your administrator to configure a server key.",
            )
        detail = " ".join(diagnostics) or "All configured AI providers returned empty responses."
        raise HTTPException(status_code=503, detail=f"Personal topic chat failed: {detail}")

    now = datetime.now(timezone.utc).isoformat()
    user_message = {
        "id": req.message_id or uuid.uuid4().hex,
        "role": "user",
        "content": req.message,
        "created_at": now,
    }
    assistant_message = {
        "id": uuid.uuid4().hex,
        "role": "assistant",
        "content": sanitize_ai_output(reply),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "model_used": model_used,
    }
    saved_messages.extend((user_message, assistant_message))
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            cursor = connection.execute(
                """
                UPDATE personal_topic_channels
                SET messages_json = ?, updated_at = ?
                WHERE user_id = ? AND topic_id = ?
                """,
                (json.dumps(saved_messages, ensure_ascii=False), assistant_message["created_at"], identity["sub"], req.topic_id),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Topic channel was removed before the reply could be saved.")
    return {
        "reply": assistant_message["content"],
        "model_used": model_used,
        "user_message": user_message,
        "assistant_message": assistant_message,
    }

@app.post("/api/vip/session")
async def update_vip_session(req: VipSessionRequest):
    verified_email = verify_google_id_token(req.google_id_token)
    if not verified_email or verified_email not in VIP_ALLOWED_EMAILS:
        raise HTTPException(status_code=403, detail="VIP session is not eligible.")
    now = time.monotonic()
    with vip_sessions_lock:
        expired_sessions = [
            session_id
            for session_id, (_, last_seen) in vip_sessions.items()
            if now - last_seen > VIP_SESSION_TTL_SECONDS
        ]
        for session_id in expired_sessions:
            vip_sessions.pop(session_id, None)

        if req.action == "release":
            current = vip_sessions.get(req.session_id)
            if current and current[0] == verified_email:
                vip_sessions.pop(req.session_id, None)
            return {
                "active": False,
                "active_count": len(vip_sessions),
                "limit": VIP_SESSION_LIMIT,
            }

        if req.action not in ("acquire", "heartbeat"):
            raise HTTPException(status_code=400, detail="Unsupported VIP session action.")
        if req.session_id not in vip_sessions and len(vip_sessions) >= VIP_SESSION_LIMIT:
            return {
                "active": False,
                "active_count": len(vip_sessions),
                "limit": VIP_SESSION_LIMIT,
            }

        current = vip_sessions.get(req.session_id)
        if current and current[0] != verified_email:
            raise HTTPException(status_code=403, detail="VIP session belongs to another user.")
        vip_sessions[req.session_id] = (verified_email, now)
        return {
            "active": True,
            "active_count": len(vip_sessions),
            "limit": VIP_SESSION_LIMIT,
        }


@app.post("/api/archive/save")
async def save_archive(req: ArchiveSaveRequest):
    identity = await asyncio.to_thread(verify_google_id_token_claims, req.google_id_token)
    if not identity:
        raise HTTPException(status_code=401, detail="Google ID token verification failed.")
    user_id = identity["sub"]
    saved_at = datetime.now(timezone.utc).isoformat()
    saved_buckets = []

    try:
        with archive_lock:
            if req.personal_messages is not None:
                if (
                    len(req.personal_messages) != 1
                    or not is_encrypted_message_envelope(req.personal_messages[0])
                ):
                    raise HTTPException(
                        status_code=400,
                        detail="Personal archive snapshots must be encrypted by the client.",
                    )
                save_archive_snapshot(
                    user_id,
                    "personal",
                    "primary",
                    {
                        "title": "Personal AI Genie Thread",
                        "host_name": identity["name"],
                        "message_count": req.personal_message_count,
                    },
                    req.personal_messages,
                    saved_at,
                )
                saved_buckets.append("personal")

            for thread in req.social_threads or []:
                if (
                    len(thread.messages) != 1
                    or not is_encrypted_message_envelope(thread.messages[0])
                ):
                    raise HTTPException(
                        status_code=400,
                        detail="Social archive snapshots must be encrypted by the client.",
                    )
                with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
                    linked_profile = connection.execute(
                        "SELECT meta_user_id FROM social_directory WHERE user_id = ?",
                        (user_id,),
                    ).fetchone()
                if not linked_profile or linked_profile[0] != thread.meta_user_id:
                    raise HTTPException(
                        status_code=403,
                        detail="Social archive profile is not linked to this Google account.",
                    )
                archive_key = f"{thread.meta_user_id}:{thread.thread_id}"
                save_archive_snapshot(
                    user_id,
                    "social",
                    archive_key,
                    {
                        "meta_user_id": thread.meta_user_id,
                        "thread_id": thread.thread_id,
                        "linked_handle": thread.linked_handle,
                        "title": thread.linked_handle or "Meta-Synced Direct Chat",
                        "host_name": identity["name"],
                        "message_count": thread.message_count,
                    },
                    thread.messages,
                    saved_at,
                )
                if "social" not in saved_buckets:
                    saved_buckets.append("social")

            for room in req.team_rooms or []:
                if room.messages or any(
                    not is_encrypted_message_envelope(review)
                    for review in room.executive_reviews
                ):
                    raise HTTPException(
                        status_code=400,
                        detail="Room archive payloads must not contain client plaintext.",
                    )
                async with room_manager.lock:
                    room_member = next(
                        (
                            room_manager.identities[websocket]
                            for websocket in room_manager.connections.get(room.room_id, set())
                            if websocket in room_manager.identities
                            and room_manager.identities[websocket].client_id == f"google:{user_id}"
                        ),
                        None,
                    )
                    if room_member is None:
                        raise HTTPException(
                            status_code=403,
                            detail=f"Join room {room.room_id} before saving its archive.",
                        )
                    messages = list(room_manager.messages.get(room.room_id, {}).values())
                if any(
                    message.get("content") is not None
                    or message.get("text") is not None
                    or not isinstance(message.get("encrypted_payloads"), dict)
                    for message in messages
                ):
                    raise HTTPException(
                        status_code=409,
                        detail="Room history includes a non-encrypted message and cannot be archived.",
                    )
                save_archive_snapshot(
                    user_id,
                    "team_rooms",
                    room.room_id,
                    {
                        "room_id": room.room_id,
                        "room_title": room.room_title,
                        "host_name": room.host_name,
                        "saved_by": identity["name"],
                        "saved_by_sub": user_id,
                        "executive_reviews": room.executive_reviews,
                    },
                    messages,
                    saved_at,
                )
                if "team_rooms" not in saved_buckets:
                    saved_buckets.append("team_rooms")
    except HTTPException:
        raise
    except (OSError, sqlite3.Error, TypeError, ValueError) as error:
        print(f"Archive save failed: {type(error).__name__}: {error}")
        raise HTTPException(status_code=500, detail="Archive could not be saved.") from error

    return {"status": "success", "saved_at": saved_at, "saved_buckets": saved_buckets}


@app.get("/api/archive/manifest")
async def get_archive_manifest(
    user_id: str,
    authorization: Optional[str] = Header(default=None),
):
    identity = await asyncio.to_thread(get_verified_archive_identity, authorization)
    if user_id != identity["sub"]:
        raise HTTPException(status_code=403, detail="Archive manifest is only available to its owner.")

    with archive_lock, closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        rows = connection.execute(
            """
            SELECT bucket, archive_key, metadata_json, messages_json, saved_at
            FROM archive_snapshots
            WHERE user_id = ?
            ORDER BY saved_at DESC
            """,
            (user_id,),
        ).fetchall()

    manifest: Dict[str, Any] = {"personal": None, "social": [], "team_rooms": []}
    for bucket, archive_key, metadata_json, messages_json, saved_at in rows:
        metadata = json.loads(metadata_json)
        summary = {
            **metadata,
            "archive_key": archive_key,
            "message_count": (
                metadata["message_count"]
                if isinstance(metadata.get("message_count"), int)
                else len(json.loads(messages_json))
            ),
            "saved_at": saved_at,
        }
        if bucket == "personal":
            manifest["personal"] = summary
        elif bucket in ("social", "team_rooms"):
            manifest[bucket].append(summary)
    return manifest


@app.post("/api/archive/restore")
async def restore_archive(req: ArchiveRestoreRequest):
    identity = await asyncio.to_thread(verify_google_id_token_claims, req.google_id_token)
    if not identity:
        raise HTTPException(status_code=401, detail="Google ID token verification failed.")
    if req.user_id != identity["sub"]:
        raise HTTPException(status_code=403, detail="Archive restore is only available to its owner.")

    invalid_targets = set(req.restore_targets) - {"personal", "social", "team_rooms"}
    if invalid_targets:
        raise HTTPException(status_code=400, detail="Restore target contains an unsupported archive bucket.")

    restored: Dict[str, Any] = {"personal": [], "social": [], "team_rooms": []}
    try:
        with archive_lock, closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
            for bucket in req.restore_targets:
                if bucket == "personal":
                    rows = connection.execute(
                        """
                        SELECT archive_key, metadata_json, messages_json, saved_at
                        FROM archive_snapshots
                        WHERE user_id = ? AND bucket = 'personal'
                        """,
                        (req.user_id,),
                    ).fetchall()
                elif bucket == "social":
                    if not req.meta_user_id:
                        raise HTTPException(
                            status_code=403,
                            detail="Link the matching Meta profile before restoring direct chats.",
                        )
                    linked_profile = connection.execute(
                        "SELECT meta_user_id FROM social_directory WHERE user_id = ?",
                        (req.user_id,),
                    ).fetchone()
                    if not linked_profile or linked_profile[0] != req.meta_user_id:
                        raise HTTPException(
                            status_code=403,
                            detail="Social archive restore requires its linked Meta profile.",
                        )
                    if req.social_archive_keys:
                        placeholders = ",".join("?" for _ in req.social_archive_keys)
                        rows = connection.execute(
                            f"""
                            SELECT archive_key, metadata_json, messages_json, saved_at
                            FROM archive_snapshots
                            WHERE user_id = ? AND bucket = 'social'
                              AND archive_key IN ({placeholders})
                            """,
                            (req.user_id, *req.social_archive_keys),
                        ).fetchall()
                    else:
                        rows = connection.execute(
                            """
                            SELECT archive_key, metadata_json, messages_json, saved_at
                            FROM archive_snapshots
                            WHERE user_id = ? AND bucket = 'social'
                            """,
                            (req.user_id,),
                        ).fetchall()
                    rows = [
                        row
                        for row in rows
                        if json.loads(row[1]).get("meta_user_id") == req.meta_user_id
                    ]
                else:
                    if not req.room_ids:
                        continue
                    placeholders = ",".join("?" for _ in req.room_ids)
                    rows = connection.execute(
                        f"""
                        SELECT archive_key, metadata_json, messages_json, saved_at
                        FROM archive_snapshots
                        WHERE user_id = ? AND bucket = 'team_rooms'
                          AND archive_key IN ({placeholders})
                        """,
                        (req.user_id, *req.room_ids),
                    ).fetchall()
                restored[bucket] = [
                    {
                        **json.loads(metadata_json),
                        "archive_key": archive_key,
                        "messages": json.loads(messages_json),
                        "saved_at": saved_at,
                    }
                    for archive_key, metadata_json, messages_json, saved_at in rows
                ]
    except (sqlite3.Error, ValueError, TypeError) as error:
        print(f"Archive restore failed: {type(error).__name__}: {error}")
        raise HTTPException(status_code=500, detail="Archive could not be restored.") from error

    return {"status": "success", **restored}


@app.post("/api/team/summarize-review")
@app.post("/api/chat/room-summon")
async def summarize_team_review(req: TeamReviewRequest):
    identity = await asyncio.to_thread(verify_google_id_token_claims, req.google_id_token)
    if not identity:
        raise HTTPException(status_code=401, detail="Google ID token verification failed.")
    client_id = f"google:{identity['sub']}"
    async with room_manager.lock:
        active_members = {
            room_manager.identities[ws].client_id
            for ws in room_manager.connections.get(req.room_id, set())
            if ws in room_manager.identities
        }
        if client_id not in active_members:
            raise HTTPException(status_code=403, detail="Only an active room member can request a team review.")
    history = [
        ChatMessage(
            role=str(message.get("role") or "user"),
            content=str(message.get("content") or message.get("text") or ""),
            sender_name=str(message.get("sender_name") or message.get("display_name") or ""),
            is_deleted=bool(message.get("is_deleted") or message.get("deleted")),
        )
        for message in req.context_messages
    ]
    if not history:
        raise HTTPException(status_code=400, detail="Conversation history is required for review.")

    condensed_digest = condense_chat_history(history)
    if not condensed_digest:
        raise HTTPException(status_code=400, detail="No substantive room messages were available to review.")

    api_key = (req.custom_api_key or os.getenv("GEMINI_API_KEY", DEFAULT_GEMINI_KEY)).strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="No Gemini API key is configured for Observer review summarization.",
        )

    diagnostics: List[str] = []
    review_prompt = (
        "Write an executive review of the following pre-condensed team digest. Highlight "
        "decisions, unresolved risks, and priorities without inventing details:\n\n"
        + condensed_digest
    )
    digest_history: List[ChatMessage] = []
    for model in GEMINI_MODELS:
        summary = request_gemini_direct(model, api_key, review_prompt, digest_history, diagnostics)
        if summary:
            return {
                "status": "success",
                "condensed_digest": condensed_digest,
                "executive_review": scrub_sensitive_tokens(summary),
                "model_used": model,
            }

    raise HTTPException(
        status_code=503,
        detail="Observer review summarization failed: "
        + (" ".join(diagnostics) or "Gemini returned an empty response."),
    )


def condense_chat_history(messages: List[ChatMessage], max_recent_window: int = 15) -> str:
    """Build a compact review brief while retaining context, questions, decisions, and recent discussion."""
    small_talk = re.compile(
        r"^(hi|hello|hey|thanks|thank you|ok|okay|great|awesome|yes|no|sure|got it)[!. ]*$",
        re.IGNORECASE,
    )
    emoji_only = re.compile(r"^[\W_]+$", re.UNICODE)
    action_pattern = re.compile(
        r"\b(we should|todo|to-do|action item|agreed|decided|need to|must|follow up|assign|let'?s)\b",
        re.IGNORECASE,
    )
    substantive = []
    questions = []
    decisions = []
    for message in messages:
        if (
            getattr(message, "deleted", False)
            or getattr(message, "isDeleted", False)
            or getattr(message, "is_deleted", False)
        ):
            continue
        text = (message.content or message.text or "").strip()
        if not text or small_talk.fullmatch(text) or (
            len(text.split()) <= 2 and emoji_only.fullmatch(text)
        ):
            continue
        speaker = message.sender_name or message.senderName or message.role
        item = f"{speaker}: {text}"
        substantive.append(item)
        if "?" in text:
            questions.append(item)
        if action_pattern.search(text):
            decisions.append(item)

    if not substantive:
        return ""

    sections = []
    if len(substantive) > max_recent_window:
        sections.append("Initial Topic Context:")
        sections.extend(f"- {item}" for item in substantive[:5])
    sections.append("Highlighted Decisions and Action Items:")
    sections.extend(f"- {item}" for item in decisions[-20:] or ["None identified."])
    sections.append("Highlighted Questions:")
    sections.extend(f"- {item}" for item in questions[-20:] or ["None identified."])
    sections.append("Recent Active Discussion:")
    sections.extend(f"- {item}" for item in substantive[-max_recent_window:])
    return "\n".join(sections)

@app.post("/api/tickets")
async def create_ticket(ticket: Dict[str, Any]):
    return {"status": "received", "ticket_id": f"TKT-{os.urandom(3).hex().upper()}"}

@app.post("/api/room/send-invites")
async def send_invites(payload: Dict[str, Any]):
    identity = await asyncio.to_thread(
        verified_identity_from_token,
        str(payload.get("google_id_token") or ""),
    )
    room_id = str(payload.get("room_id") or "")
    required_attendees = payload.get("required_attendees") or []
    optional_attendees = payload.get("optional_attendees") or []
    if not isinstance(required_attendees, list) or not isinstance(optional_attendees, list):
        raise HTTPException(status_code=400, detail="Invite recipients must be supplied as email lists.")
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        room = connection.execute(
            "SELECT host_id, members_json FROM sovereign_rooms WHERE room_id = ?",
            (room_id,),
        ).fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="Room does not exist.")
        if room[0] != f"google:{identity['sub']}":
            raise HTTPException(status_code=403, detail="Only the room host can send room invitations.")
        invite_emails = [
            str(email).strip().lower()
            for email in [*required_attendees, *optional_attendees]
            if str(email).strip()
        ]
        if invite_emails:
            placeholders = ",".join("?" for _ in invite_emails)
            targets = connection.execute(
                f"SELECT user_id FROM social_directory WHERE lower(email) IN ({placeholders})",
                invite_emails,
            ).fetchall()
            if any(are_users_blocked(identity["sub"], target[0]) for target in targets):
                raise HTTPException(status_code=403, detail="An invitation cannot be sent to a blocked contact.")
    return {"status": "dispatched", "room_id": room_id}


@app.websocket("/ws/rooms/{room_id}")
async def room_websocket(websocket: WebSocket, room_id: str):
    await websocket.accept()
    try:
        join_event = await websocket.receive_json()
        if not isinstance(join_event, dict) or join_event.get("type") != "room.join":
            await websocket.close(code=1008, reason="Google sign-in is required to join a room.")
            return
        identity = await asyncio.to_thread(
            verify_google_id_token_claims,
            join_event.get("google_id_token"),
        )
        if not identity:
            await websocket.close(code=1008, reason="Google identity verification failed.")
            return
        public_key = join_event.get("public_key")
        if (
            not isinstance(public_key, dict)
            or public_key.get("kty") != "EC"
            or public_key.get("crv") != "P-256"
            or not isinstance(public_key.get("x"), str)
            or not isinstance(public_key.get("y"), str)
            or len(public_key["x"]) > 128
            or len(public_key["y"]) > 128
        ):
            await websocket.close(code=1008, reason="A Web Crypto P-256 identity key is required.")
            return
        display_name = (
            str(join_event.get("display_name") or "").strip()[:80]
            or identity["name"]
            or identity["email"]
        )
        avatar_url = str(join_event.get("avatar_url") or "")[:2048]
        try:
            await asyncio.to_thread(
                authorize_room_member,
                room_id,
                identity,
                str(join_event.get("room_passcode") or ""),
                str(join_event.get("room_title") or room_id)[:200],
                public_key,
            )
        except HTTPException as error:
            await websocket.close(code=1008, reason=str(error.detail))
            return
        except (OSError, sqlite3.Error, ValueError) as error:
            print(f"Room authorization failed: {type(error).__name__}")
            await websocket.close(code=1011, reason="Room access could not be verified.")
            return
        if room_id.startswith("direct:"):
            members = room_manager._room_members(room_id)
            if any(
                are_users_blocked(identity["sub"], str(member.get("id") or ""))
                for member in members
                if canonical_user_id(str(member.get("id") or "")) != identity["sub"]
            ):
                await websocket.close(code=1008, reason="This direct room is unavailable because of a block.")
                return
        connection = RoomConnection(
            websocket,
            f"google:{identity['sub']}",
            display_name,
            avatar_url,
            identity["email"],
            public_key,
            str(join_event.get("room_title") or room_id)[:200],
            str(join_event.get("host_id") or ""),
        )
        try:
            await room_manager.connect(room_id, connection)
        except (sqlite3.Error, ValueError, TypeError) as error:
            print(f"Room initialization failed: {type(error).__name__}")
            await websocket.close(code=1011, reason="Room could not be initialized.")
            return
        while True:
            event = await websocket.receive_json()
            if isinstance(event, dict):
                await room_manager.handle_event(room_id, websocket, event)
            else:
                await websocket.send_json({"type": "error", "detail": "Room events must be JSON objects."})
    except WebSocketDisconnect:
        await room_manager.disconnect(room_id, websocket)
    
