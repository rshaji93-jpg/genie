from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import io
import json
import logging
import os
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env", override=False)

try:
    from .gemini_pool import gemini_pool
    from .modules.database import initialize_archive_schema
    from .modules.database.helpers import connect_database
    from .modules.sovereign_admin.anon_telemetry import pseudonym as telemetry_pseudonym
    from .modules.sovereign_admin.genesis_claim import decrypt_totp_secret, encrypt_totp_secret
    from .modules.sovereign_admin.vip_passes_totp import hash_vip_code
    from .modules.social_geo_circle import has_mutual_friend, needs_personal_attestation
    from .modules.voice_presence_ws.passcode_invites import (
        create_passcode,
        passcode_hash,
        verify_passcode,
    )
    from .security import (
        SUPER_ADMIN_EMAIL,
        is_zero_knowledge_secret,
        normalize_room_ciphertext,
        validate_room_ciphertext_envelope,
        verify_inline_push_reply_token,
        verify_google_identity,
    )
except ImportError:
    from gemini_pool import gemini_pool
    from modules.database import initialize_archive_schema
    from modules.database.helpers import connect_database
    from modules.sovereign_admin.anon_telemetry import pseudonym as telemetry_pseudonym
    from modules.sovereign_admin.genesis_claim import decrypt_totp_secret, encrypt_totp_secret
    from modules.sovereign_admin.vip_passes_totp import hash_vip_code
    from modules.social_geo_circle import has_mutual_friend, needs_personal_attestation
    from modules.voice_presence_ws.passcode_invites import (
        create_passcode,
        passcode_hash,
        verify_passcode,
    )
    from security import (
        SUPER_ADMIN_EMAIL,
        is_zero_knowledge_secret,
        normalize_room_ciphertext,
        validate_room_ciphertext_envelope,
        verify_inline_push_reply_token,
        verify_google_identity,
    )

LOGGER = logging.getLogger("genie.new_arch")
DATABASE_PATH = Path(os.getenv("GENIE_DB_PATH", str(BACKEND_DIR / "data" / "genie_archive.sqlite3")))
GOOGLE_CLIENT_ID = os.getenv("GENIE_GOOGLE_CLIENT_ID", "").strip()
ADMIN_SIGNING_KEY = os.getenv("GENIE_ADMIN_SIGNING_KEY", "")
METASYNC_HASH_KEY = os.getenv("GENIE_METASYNC_HASH_KEY", "").encode("utf-8")
TELEMETRY_HMAC_KEY = os.getenv("GENIE_TELEMETRY_HMAC_KEY", "").encode("utf-8")
VIP_CODE_PEPPER = os.getenv("GENIE_VIP_CODE_PEPPER", "").encode("utf-8")
SOVEREIGN_TOTP_FERNET_KEY = os.getenv("GENIE_SOVEREIGN_TOTP_FERNET_KEY", "")
SESSION_SIGNING_KEY = os.getenv("SESSION_SIGNING_KEY", "")
GENIE_SESSION_SIGNING_KEY = os.getenv("GENIE_SESSION_SIGNING_KEY", "")
FRONTEND_ORIGINS = {
    origin.strip().rstrip("/")
    for origin in os.getenv("GENIE_FRONTEND_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
}
WEBAUTHN_RP_ID = os.getenv("GENIE_WEBAUTHN_RP_ID", "localhost").strip()
WEBAUTHN_RP_NAME = os.getenv("GENIE_WEBAUTHN_RP_NAME", "Personal AI Genie").strip()
WEBAUTHN_ORIGIN = os.getenv("GENIE_WEBAUTHN_ORIGIN", "http://localhost:3000").strip()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def database() -> sqlite3.Connection:
    return connect_database(DATABASE_PATH)


def initialize_database() -> None:
    with closing(database()) as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS rooms (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                owner_sub TEXT NOT NULL,
                invite_hash TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS room_members (
                room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                user_sub TEXT NOT NULL,
                user_name TEXT NOT NULL,
                joined_at TEXT NOT NULL,
                PRIMARY KEY (room_id, user_sub)
            );
            CREATE TABLE IF NOT EXISTS room_messages (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                sender_sub TEXT NOT NULL,
                sender_name TEXT NOT NULL,
                ciphertext TEXT NOT NULL,
                is_secret INTEGER NOT NULL DEFAULT 0,
                tick_status TEXT NOT NULL DEFAULT 'sent',
                sent_at TEXT NOT NULL,
                delivered_at TEXT,
                read_at TEXT,
                review_at TEXT,
                review_triggered_by TEXT,
                review_cost INTEGER,
                review_breakdown TEXT,
                ai_reply TEXT,
                review_ciphertext TEXT,
                verified_at TEXT,
                verified_by TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_room_messages_room_time
                ON room_messages(room_id, sent_at);
            CREATE TABLE IF NOT EXISTS token_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_sub TEXT NOT NULL,
                room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                message_id TEXT NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
                tokens INTEGER NOT NULL CHECK(tokens > 0),
                breakdown TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS passkeys (
                credential_id BLOB PRIMARY KEY,
                user_sub TEXT NOT NULL,
                public_key BLOB NOT NULL,
                sign_count INTEGER NOT NULL DEFAULT 0,
                transports TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS passkey_challenges (
                id TEXT PRIMARY KEY,
                user_sub TEXT NOT NULL,
                challenge BLOB NOT NULL,
                purpose TEXT NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS users (
                email TEXT PRIMARY KEY COLLATE NOCASE,
                user_sub TEXT NOT NULL UNIQUE,
                user_name TEXT NOT NULL,
                phone TEXT UNIQUE,
                phone_hash TEXT UNIQUE,
                picture_url TEXT,
                last_seen_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                owner_sub TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_chats_owner_updated
                ON chats(owner_sub, updated_at DESC);
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                sender_sub TEXT NOT NULL,
                ciphertext TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_messages_chat_created
                ON messages(chat_id, created_at);
            CREATE TABLE IF NOT EXISTS friend_requests (
                id TEXT PRIMARY KEY,
                sender_sub TEXT NOT NULL,
                receiver_sub TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                UNIQUE(sender_sub, receiver_sub)
            );
            CREATE TABLE IF NOT EXISTS friendships (
                user_a TEXT NOT NULL,
                user_b TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_a, user_b)
            );
            CREATE TABLE IF NOT EXISTS metasync_contacts (
                user_sub TEXT NOT NULL,
                phone_hash TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(user_sub, phone_hash)
            );
            """
        )
        user_columns = connection.execute("PRAGMA table_info(users)").fetchall()
        if not any(row["name"] == "email" and row["pk"] == 1 for row in user_columns):
            connection.execute("ALTER TABLE users RENAME TO users_legacy_schema")
            connection.execute(
                """
                CREATE TABLE users (
                    email TEXT PRIMARY KEY COLLATE NOCASE,
                    user_sub TEXT NOT NULL UNIQUE,
                    user_name TEXT NOT NULL,
                    phone TEXT UNIQUE,
                    phone_hash TEXT UNIQUE,
                    picture_url TEXT,
                    last_seen_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                INSERT INTO users(email, user_sub, user_name, last_seen_at)
                SELECT email, user_sub, user_name, last_seen_at FROM users_legacy_schema
                """
            )
            connection.execute("DROP TABLE users_legacy_schema")
        message_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(room_messages)").fetchall()
        }
        if "review_ciphertext" not in message_columns:
            connection.execute("ALTER TABLE room_messages ADD COLUMN review_ciphertext TEXT")
        initialize_archive_schema(connection)
        connection.commit()


initialize_database()

app = FastAPI(title="Personal AI Genie — Isolated Architecture", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(FRONTEND_ORIGINS),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request, call_next):
    path = request.scope["path"]
    if path.startswith("/api/py/"):
        request.scope["path"] = f"/api/{path[len('/api/py/'):]}"
        request.scope["raw_path"] = request.scope["path"].encode("ascii")
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cache-Control"] = "no-store"
    return response


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChatMessage(StrictModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=20_000)
    is_secret: bool = False
    image_data: dict[str, str] | None = None

    @field_validator("image_data")
    @classmethod
    def validate_media(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        if value is None:
            return None
        mime_type = value.get("mime_type", "")
        data = value.get("data", "")
        if not mime_type.startswith(("image/", "audio/")) or not data or len(data) > 11_000_000:
            raise ValueError("Only supported image or audio attachments up to 8 MB are accepted.")
        return value


class ChatRequest(StrictModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)
    model: str = Field(default="genie-pro", pattern="^(genie-pro|genie-master|individual)$")
    thinking_level: str = Field(default="pro", pattern="^(light|pro|deep)$")
    is_secret: bool = False


class RoomCreate(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    invite_code: str = Field(min_length=32, max_length=128)
    passcode: str | None = Field(default=None, pattern="^[0-9]{6}$")
    max_uses: int = Field(default=20, ge=1, le=100)


class RoomJoin(StrictModel):
    invite_code: str = Field(min_length=32, max_length=128)
    passcode: str | None = Field(default=None, pattern="^[0-9]{6}$")


class RoomEncryptedMessage(StrictModel):
    ciphertext: str = Field(min_length=1, max_length=12_000_000)
    is_secret: bool = False


class InlinePushReply(StrictModel):
    reply_token: str = Field(min_length=1, max_length=4096)
    text: str = Field(min_length=1, max_length=12_000_000)


class RoomInviteIssuance(StrictModel):
    max_uses: int = Field(default=1, ge=1, le=100)
    passcode: str | None = Field(default=None, pattern="^[0-9]{6}$")
    expires_in_hours: int | None = Field(default=72, ge=1, le=720)


class FriendRequest(StrictModel):
    email: str = Field(min_length=3, max_length=254)
    attest_personal: bool = False


class FriendAcceptance(StrictModel):
    attest_personal: bool = False


class ProfilePreferences(StrictModel):
    geo_region_hash: str | None = Field(default=None, max_length=128)
    friend_circle_mode: str = Field(
        default="mutuals_only",
        pattern="^(everyone|local_geo_circle_mutuals|mutuals_only)$",
    )
    lookup_visibility: str = Field(
        default="mutual_contacts_only",
        pattern="^(everyone|mutual_contacts_only|invite_link_only)$",
    )
    allow_broader_discovery: bool = False
    default_dialect: str = Field(default="en-IN", max_length=16)
    presence_override: str = Field(default="online", pattern="^(online|away|busy)$")
    telemetry_enabled: bool = False


class UserRegistration(StrictModel):
    full_name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=254)
    phone: str = Field(min_length=7, max_length=20)
    city_region: str = Field(min_length=1, max_length=120)


class ProfileDetails(StrictModel):
    display_name: str = Field(min_length=1, max_length=100)
    bio: str = Field(default="", max_length=500)
    city_region: str | None = Field(default=None, max_length=120)
    custom_picture_data: str | None = Field(default=None, max_length=2_800_000)
    profile_visibility: str = Field(default="mutuals", pattern="^(public|mutuals|private)$")
    presence_visibility: str = Field(default="mutuals", pattern="^(public|mutuals|private)$")
    directory_visibility: str = Field(default="mutuals", pattern="^(public|mutuals|private)$")
    default_dialect: str = Field(default="en-IN", max_length=16)
    preview_profile: bool = False


class PasskeyLoginEmail(StrictModel):
    email: str = Field(min_length=3, max_length=254)


class GenesisTotpVerify(StrictModel):
    code: str = Field(pattern="^[0-9]{6}$")


class VipPassAction(StrictModel):
    action: str = Field(pattern="^(mint|pause|resume|revoke|recycle)$")
    totp_code: str = Field(pattern="^[0-9]{6}$")
    pass_id: str | None = Field(default=None, max_length=80)


class VipPassClaim(StrictModel):
    code: str = Field(min_length=8, max_length=64)


class TelemetryEvent(StrictModel):
    prompt_count: int = Field(default=0, ge=0, le=100)
    session_minutes: int = Field(default=0, ge=0, le=1440)


class ScanRequest(StrictModel):
    image_base64: str = Field(min_length=1, max_length=16_000_000)


class SpeechRequest(StrictModel):
    text: str = Field(min_length=1, max_length=12_000)
    dialect: str = Field(default="en-IN", max_length=16)


class PhoneRegistration(StrictModel):
    phone: str = Field(min_length=7, max_length=20)


class MetaSyncRequest(StrictModel):
    phone_numbers: list[str] = Field(min_length=1, max_length=500)

    @field_validator("phone_numbers")
    @classmethod
    def validate_phone_numbers(cls, values: list[str]) -> list[str]:
        if any(not isinstance(value, str) or not value.strip() or len(value) > 30 for value in values):
            raise ValueError("Each contact phone number must contain 1 to 30 characters.")
        return values


class RoomReview(StrictModel):
    context: list[dict[str, Any]] = Field(max_length=20)

    @field_validator("context")
    @classmethod
    def validate_context(cls, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        for item in value:
            content = item.get("content")
            if not isinstance(content, str) or len(content) > 20_000:
                raise ValueError("Each room turn must contain at most 20,000 text characters.")
        return value


class EncryptedReview(StrictModel):
    ciphertext: str = Field(min_length=1, max_length=12_000_000)


class EncryptedMessageEdit(StrictModel):
    ciphertext: str = Field(min_length=1, max_length=12_000_000)


class PasskeyCredential(StrictModel):
    credential: dict[str, Any]


class PasskeyLoginCredential(StrictModel):
    email: str = Field(min_length=3, max_length=254)
    credential: dict[str, Any]


def _session_signing_key() -> bytes:
    key = GENIE_SESSION_SIGNING_KEY.encode("utf-8")
    if len(key) < 32:
        raise HTTPException(status_code=503, detail="User passkey session signing is not configured.")
    return key


def issue_user_session(user: sqlite3.Row) -> str:
    header = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').decode().rstrip("=")
    payload = base64.urlsafe_b64encode(
        json.dumps(
            {
                "typ": "genie_user",
                "sub": user["user_sub"],
                "email": user["email"],
                "name": user["display_name"] or user["user_name"],
                "picture": user["picture_url"] or "",
                "iat": int(time.time()),
                "exp": int(time.time()) + 60 * 60 * 24 * 7,
            },
            separators=(",", ":"),
        ).encode("utf-8")
    ).decode("ascii").rstrip("=")
    signing_input = f"{header}.{payload}".encode("ascii")
    signature = hmac.new(_session_signing_key(), signing_input, hashlib.sha256).digest()
    return f"{header}.{payload}.{base64.urlsafe_b64encode(signature).decode('ascii').rstrip('=')}"


def verify_user_session(token: str) -> dict[str, str]:
    parts = token.split(".")
    if len(parts) != 3:
        raise HTTPException(status_code=401, detail="Invalid user session.")
    header_part, payload_part, signature_part = parts
    try:
        signing_input = f"{header_part}.{payload_part}".encode("ascii")
        signature_text = signature_part.encode("ascii")
        signature = base64.b64decode(
            signature_text + b"=" * (-len(signature_text) % 4),
            altchars=b"-_",
            validate=True,
        )
        payload_text = payload_part.encode("ascii")
        payload = json.loads(
            base64.b64decode(
                payload_text + b"=" * (-len(payload_text) % 4),
                altchars=b"-_",
                validate=True,
            )
        )
    except (ValueError, UnicodeError, binascii.Error, json.JSONDecodeError) as error:
        raise HTTPException(status_code=401, detail="Invalid user session.") from error
    expected = hmac.new(_session_signing_key(), signing_input, hashlib.sha256).digest()
    if (
        not hmac.compare_digest(expected, signature)
        or not isinstance(payload, dict)
        or payload.get("typ") != "genie_user"
        or not isinstance(payload.get("exp"), int)
        or payload["exp"] <= int(time.time())
    ):
        raise HTTPException(status_code=401, detail="Invalid or expired user session.")
    subject = payload.get("sub")
    email = payload.get("email")
    name = payload.get("name")
    if not all(isinstance(value, str) and value for value in (subject, email, name)):
        raise HTTPException(status_code=401, detail="User session is incomplete.")
    return {
        "sub": subject,
        "email": email.casefold(),
        "name": name,
        "picture": payload["picture"] if isinstance(payload.get("picture"), str) else "",
    }


async def current_identity(authorization: str | None = Header(default=None)) -> dict[str, str]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    token = authorization[7:].strip()
    token_header = token.split(".", 1)[0]
    try:
        decoded_header = json.loads(
            base64.urlsafe_b64decode(token_header + "=" * (-len(token_header) % 4))
        )
    except (ValueError, UnicodeError, json.JSONDecodeError):
        decoded_header = {}
    if isinstance(decoded_header, dict) and decoded_header.get("alg") == "HS256":
        identity = verify_user_session(token)
        with closing(database()) as connection:
            registered = connection.execute(
                "SELECT 1 FROM users WHERE user_sub = ? AND registration_complete = 1",
                (identity["sub"],),
            ).fetchone()
        if not registered:
            raise HTTPException(status_code=401, detail="User account is no longer active.")
        return identity
    identity = verify_google_identity(token, GOOGLE_CLIENT_ID)
    with closing(database()) as connection:
        connection.execute(
            """
            INSERT INTO users(user_sub, email, user_name, last_seen_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET user_sub = excluded.user_sub,
                user_name = excluded.user_name, last_seen_at = excluded.last_seen_at
            """,
            (identity["sub"], identity["email"], identity["name"], utc_now()),
        )
        connection.execute(
            "UPDATE users SET picture_url = ? WHERE user_sub = ?",
            (identity.get("picture"), identity["sub"]),
        )
        connection.commit()
    return identity


@app.post("/api/auth/register")
async def register_user(
    request: UserRegistration,
    identity: dict[str, str] = Depends(current_identity),
):
    email = request.email.strip().casefold()
    if email != identity["email"].casefold():
        raise HTTPException(status_code=403, detail="Registration email must match the verified Google account.")
    phone = normalize_phone(request.phone)
    phone_hash = metasync_phone_hash(phone)
    name = request.full_name.strip()
    city_region = request.city_region.strip()
    if not name or not city_region:
        raise HTTPException(status_code=422, detail="Full name and city/region are required.")
    with closing(database()) as connection:
        try:
            connection.execute(
                """
                UPDATE users SET user_name = ?, display_name = ?, phone = ?, phone_hash = ?,
                    city_region = ?, registration_complete = 1, last_seen_at = ?
                WHERE user_sub = ? AND email = ?
                """,
                (name, name, phone, phone_hash, city_region, utc_now(), identity["sub"], email),
            )
            connection.commit()
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=409, detail="That phone number is already registered.") from error
        registered = connection.execute(
            "SELECT registration_complete FROM users WHERE user_sub = ?", (identity["sub"],)
        ).fetchone()
    if not registered or not registered["registration_complete"]:
        raise HTTPException(status_code=404, detail="Verified account was not found.")
    return {"registered": True, "email": email, "full_name": name}


@app.put("/api/profile/details")
async def update_profile_details(
    request: ProfileDetails,
    identity: dict[str, str] = Depends(current_identity),
):
    picture_data = request.custom_picture_data
    if not request.display_name.strip():
        raise HTTPException(status_code=422, detail="Display name cannot be empty.")
    if picture_data is not None:
        match = re.fullmatch(
            r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})", picture_data
        )
        if not match:
            raise HTTPException(status_code=422, detail="Profile picture must be a base64 JPG, PNG, or WebP image.")
        try:
            image_bytes = base64.b64decode(match.group(2), validate=True)
        except binascii.Error as error:
            raise HTTPException(status_code=422, detail="Profile picture data is invalid.") from error
        mime = match.group(1)
        valid_signature = (
            mime == "jpeg" and image_bytes.startswith(b"\xff\xd8\xff")
            or mime == "png" and image_bytes.startswith(b"\x89PNG\r\n\x1a\n")
            or mime == "webp" and image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP"
        )
        if not image_bytes or len(image_bytes) > 2_000_000 or not valid_signature:
            raise HTTPException(status_code=422, detail="Profile picture contents do not match the allowed image type or size.")
    with closing(database()) as connection:
        connection.execute(
            """
            UPDATE users SET display_name = ?, bio = ?, city_region = ?,
                custom_picture_data = ?, profile_visibility = ?, presence_visibility = ?,
                directory_visibility = ?, default_dialect = ?, preview_profile = ?
            WHERE user_sub = ?
            """,
            (
                request.display_name.strip(), request.bio.strip(),
                request.city_region.strip() if request.city_region else None,
                picture_data, request.profile_visibility, request.presence_visibility,
                request.directory_visibility, request.default_dialect,
                int(request.preview_profile), identity["sub"],
            ),
        )
        connection.commit()
    return request.model_dump()


@app.delete("/api/profile/account")
async def remove_user_account(identity: dict[str, str] = Depends(current_identity)):
    if identity["email"].casefold() == SUPER_ADMIN_EMAIL.casefold():
        raise HTTPException(status_code=409, detail="The Sovereign Admin account cannot be removed through this control.")
    with closing(database()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DELETE FROM passkeys WHERE user_sub = ?", (identity["sub"],))
        connection.execute("DELETE FROM passkey_challenges WHERE user_sub = ?", (identity["sub"],))
        connection.execute(
            "DELETE FROM metasync_contacts WHERE user_sub = ?", (identity["sub"],)
        )
        connection.execute("DELETE FROM push_subscriptions WHERE user_sub = ?", (identity["sub"],))
        connection.execute("DELETE FROM attachments WHERE owner_sub = ?", (identity["sub"],))
        connection.execute(
            "DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE owner_sub = ?)",
            (identity["sub"],),
        )
        connection.execute("DELETE FROM chats WHERE owner_sub = ?", (identity["sub"],))
        connection.execute("DELETE FROM room_members WHERE user_sub = ?", (identity["sub"],))
        connection.execute(
            "UPDATE room_messages SET sender_name = 'Deleted account' WHERE sender_sub = ?",
            (identity["sub"],),
        )
        connection.execute(
            "DELETE FROM friend_requests WHERE sender_sub = ? OR receiver_sub = ?",
            (identity["sub"], identity["sub"]),
        )
        connection.execute(
            "DELETE FROM friendships WHERE user_a = ? OR user_b = ?",
            (identity["sub"], identity["sub"]),
        )
        connection.execute(
            """
            UPDATE users SET registration_complete = 0, user_name = 'Deleted account',
                display_name = NULL, bio = NULL, city_region = NULL, phone = NULL,
                phone_hash = NULL, picture_url = NULL, custom_picture_data = NULL,
                profile_visibility = 'private', presence_visibility = 'private',
                directory_visibility = 'private', preview_profile = 0
            WHERE user_sub = ?
            """,
            (identity["sub"],),
        )
        connection.commit()
    await room_hub.disconnect_user(identity["sub"])
    return {"removed": True, "encrypted_room_history_retained": True}


def room_member(room_id: str, identity: dict[str, str]) -> None:
    with closing(database()) as connection:
        exists = connection.execute(
            "SELECT 1 FROM room_members WHERE room_id = ? AND user_sub = ?",
            (room_id, identity["sub"]),
        ).fetchone()
    if not exists:
        raise HTTPException(status_code=404, detail="Room not found.")


def secret_chat_confirmation() -> dict[str, Any]:
    return {
        "reply": "🔒 Secret received. It was not sent to an AI provider or archive.",
        "tick_status": "yellow_no_ai",
        "tokens_burned": 0,
    }


def clean_ai_messages(messages: list[ChatMessage]) -> list[dict[str, Any]]:
    return [
        item.model_dump(exclude={"is_secret"})
        for item in messages
        if not is_zero_knowledge_secret(item.content, item.is_secret)
    ]


@app.get("/healthz")
async def healthz():
    return {"status": "ok", "service": "genie-new-architecture"}


@app.get("/api/ai/status")
async def ai_status(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        return {"authenticated": False, "status": "ready"}
    try:
        await current_identity(authorization)
    except HTTPException as error:
        if error.status_code != 401:
            raise
        return {"authenticated": False, "status": "ready"}
    return {
        "authenticated": True,
        **await asyncio.to_thread(gemini_pool.availability),
    }


def normalize_phone(phone: str) -> str:
    trimmed = phone.strip()
    if not re.fullmatch(r"\+[0-9\s().-]+", trimmed):
        raise HTTPException(status_code=422, detail="Phone number must include its international country code.")
    digits = "".join(character for character in trimmed if character.isdigit())
    if not 7 <= len(digits) <= 15:
        raise HTTPException(status_code=422, detail="Phone number must contain 7 to 15 digits.")
    return f"+{digits}"


def metasync_phone_hash(phone: str) -> str:
    if len(METASYNC_HASH_KEY) < 32:
        raise HTTPException(status_code=503, detail="MetaSync contact hashing is not configured.")
    return hmac.new(
        METASYNC_HASH_KEY,
        normalize_phone(phone).encode("ascii"),
        hashlib.sha256,
    ).hexdigest()


@app.get("/api/profile")
async def get_profile(identity: dict[str, str] = Depends(current_identity)):
    with closing(database()) as connection:
        profile = connection.execute(
            """
            SELECT email, user_name, display_name, bio, city_region, phone,
                   picture_url, custom_picture_data, profile_visibility,
                   presence_visibility, directory_visibility, preview_profile,
                   registration_complete, geo_region_hash,
                   friend_circle_mode, lookup_visibility, allow_broader_discovery,
                   default_dialect, presence_override, telemetry_enabled, is_vip
            FROM users WHERE user_sub = ?
            """,
            (identity["sub"],),
        ).fetchone()
    return dict(profile) if profile else {
        "email": identity["email"],
        "user_name": identity["name"],
        "registration_complete": False,
        "display_name": identity["name"],
        "bio": "",
        "city_region": None,
        "phone": None,
        "picture_url": identity.get("picture"),
        "custom_picture_data": None,
        "profile_visibility": "mutuals",
        "presence_visibility": "mutuals",
        "directory_visibility": "mutuals",
        "preview_profile": False,
        "geo_region_hash": None,
        "friend_circle_mode": "mutuals_only",
        "lookup_visibility": "mutual_contacts_only",
        "allow_broader_discovery": False,
        "default_dialect": "en-IN",
        "presence_override": "online",
        "telemetry_enabled": False,
        "is_vip": False,
    }


@app.put("/api/profile/preferences")
async def update_profile_preferences(
    request: ProfilePreferences,
    identity: dict[str, str] = Depends(current_identity),
):
    with closing(database()) as connection:
        connection.execute(
            """
            UPDATE users SET geo_region_hash = ?, friend_circle_mode = ?,
                lookup_visibility = ?, allow_broader_discovery = ?,
                default_dialect = ?, presence_override = ?, telemetry_enabled = ?
            WHERE user_sub = ?
            """,
            (
                request.geo_region_hash.strip() if request.geo_region_hash else None,
                request.friend_circle_mode,
                request.lookup_visibility,
                int(request.allow_broader_discovery),
                request.default_dialect,
                request.presence_override,
                int(request.telemetry_enabled),
                identity["sub"],
            ),
        )
        connection.commit()
    return request.model_dump()


@app.put("/api/profile/phone")
async def register_phone(
    request: PhoneRegistration,
    identity: dict[str, str] = Depends(current_identity),
):
    phone = normalize_phone(request.phone)
    hashed = metasync_phone_hash(phone)
    with closing(database()) as connection:
        try:
            connection.execute(
                "UPDATE users SET phone = ?, phone_hash = ?, last_seen_at = ? WHERE user_sub = ?",
                (phone, hashed, utc_now(), identity["sub"]),
            )
            connection.commit()
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=409, detail="That phone number is already registered.") from error
    return {"registered": True}


@app.post("/api/chat")
async def chat(request: ChatRequest, _identity: dict[str, str] = Depends(current_identity)):
    if request.is_secret or any(
        is_zero_knowledge_secret(item.content, item.is_secret) for item in request.messages
    ):
        return secret_chat_confirmation()
    messages = clean_ai_messages(request.messages)
    if not messages:
        return secret_chat_confirmation()
    try:
        reply = await asyncio.to_thread(
            gemini_pool.chat,
            messages,
            request.model == "genie-master",
            request.thinking_level,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        LOGGER.warning("Chat provider request failed (%s)", type(error).__name__)
        raise HTTPException(status_code=502, detail="AI provider request failed.") from error
    return {"reply": reply, "tick_status": "read_no_ai", "tokens_burned": 0}


@app.post("/api/chat/stream")
async def chat_stream(
    request: ChatRequest, _identity: dict[str, str] = Depends(current_identity)
):
    if request.is_secret or any(
        is_zero_knowledge_secret(item.content, item.is_secret) for item in request.messages
    ):
        confirmation = secret_chat_confirmation()

        def secret_events():
            yield f"event: confirmation\ndata: {json.dumps(confirmation)}\n\n"
            yield "event: done\ndata: {}\n\n"

        return StreamingResponse(secret_events(), media_type="text/event-stream")
    messages = clean_ai_messages(request.messages)

    def events():
        try:
            for token in gemini_pool.stream(
                messages, request.model == "genie-master", request.thinking_level
            ):
                yield f"event: token\ndata: {json.dumps({'text': token})}\n\n"
            yield "event: done\ndata: {}\n\n"
        except Exception as error:
            LOGGER.warning("Streaming provider failed (%s)", type(error).__name__)
            yield f"event: error\ndata: {json.dumps({'detail': 'AI provider request failed.'})}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no"},
    )


@app.post("/api/scan-to-pdf")
async def scan_to_pdf(
    request: ScanRequest,
    _identity: dict[str, str] = Depends(current_identity),
):
    try:
        import cv2
        import numpy as np
        try:
            from .modules.doc_scanner_pdf.a4_pdf_exporter import export_a4_pdf
            from .modules.doc_scanner_pdf.opencv_deskew import deskew_document
        except ImportError:
            from modules.doc_scanner_pdf.a4_pdf_exporter import export_a4_pdf
            from modules.doc_scanner_pdf.opencv_deskew import deskew_document
    except ImportError as error:
        raise HTTPException(status_code=503, detail="OpenCV scanner dependencies are not installed.") from error
    try:
        image_bytes = base64.b64decode(request.image_base64, validate=True)
    except (ValueError, base64.binascii.Error) as error:
        raise HTTPException(status_code=422, detail="The scan image is not valid base64.") from error
    if len(image_bytes) > 12_000_000:
        raise HTTPException(status_code=413, detail="Scan image exceeds 12 MB.")
    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.shape[0] * image.shape[1] > 40_000_000:
        raise HTTPException(status_code=422, detail="The scan image is invalid or too large.")
    try:
        cleaned = await asyncio.to_thread(deskew_document, image)
        success, encoded = cv2.imencode(".png", cleaned)
        if not success:
            raise RuntimeError("The cleaned scan could not be encoded.")
        pdf = await asyncio.to_thread(export_a4_pdf, encoded.tobytes())
    except (ValueError, RuntimeError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {
        "pdf_base64": base64.b64encode(pdf).decode("ascii"),
        "mime_type": "application/pdf",
        "tokens_burned": 0,
    }


@app.post("/api/tts")
async def text_to_speech(
    request: SpeechRequest,
    _identity: dict[str, str] = Depends(current_identity),
):
    language_map = {
        "ta-IN": "ta", "ml-IN": "ml", "te-IN": "te", "kn-IN": "kn",
        "hi-IN": "hi", "bn-IN": "bn", "mr-IN": "mr", "gu-IN": "gu",
        "pa-IN": "pa", "or-IN": "or", "as-IN": "as", "ur-IN": "ur",
        "en-IN": "en", "Tanglish": "en",
    }
    language = language_map.get(request.dialect)
    if not language:
        raise HTTPException(status_code=422, detail="Unsupported speech dialect.")
    try:
        try:
            from .modules.linguist_tts.gtts_streamer import speech_mp3
        except ImportError:
            from modules.linguist_tts.gtts_streamer import speech_mp3
        audio = await asyncio.to_thread(speech_mp3, request.text, language)
    except Exception as error:
        LOGGER.warning("Text-to-speech request failed (%s)", type(error).__name__)
        raise HTTPException(status_code=502, detail="Speech synthesis provider request failed.") from error
    return {"audio_base64": base64.b64encode(audio).decode("ascii"), "mime_type": "audio/mpeg"}


@app.post("/api/personal/chat")
async def personal_chat(
    request: ChatRequest, identity: dict[str, str] = Depends(current_identity)
):
    return await chat(request, identity)


@app.post("/api/rooms")
async def create_room(
    request: RoomCreate, identity: dict[str, str] = Depends(current_identity)
):
    room_id = str(uuid.uuid4())
    invite_hash = hashlib.sha256(request.invite_code.encode("utf-8")).hexdigest()
    timestamp = utc_now()
    with closing(database()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            "INSERT INTO rooms(id, name, owner_sub, invite_hash, created_at) VALUES (?, ?, ?, ?, ?)",
            (room_id, request.name.strip(), identity["sub"], invite_hash, timestamp),
        )
        connection.execute(
            "INSERT INTO room_members(room_id, user_sub, user_name, joined_at) VALUES (?, ?, ?, ?)",
            (room_id, identity["sub"], identity["name"], timestamp),
        )
        if request.passcode:
            passcode_salt = secrets.token_bytes(16)
            encoded_hash = f"{passcode_salt.hex()}:{passcode_hash(request.passcode, passcode_salt)}"
            invite_expires = datetime.now(timezone.utc).timestamp() + 72 * 3600
            invite_expiry = datetime.fromtimestamp(invite_expires, timezone.utc).isoformat()
            connection.execute(
                """
                INSERT INTO room_invites(
                    id, room_id, invite_hash, passcode_hash, max_uses,
                    uses_count, expires_at, created_by, created_at
                ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()), room_id, invite_hash, encoded_hash,
                    request.max_uses, invite_expiry, identity["sub"], timestamp,
                ),
            )
        connection.commit()
    return {"id": room_id, "name": request.name.strip(), "created_at": timestamp}


@app.get("/api/rooms")
async def list_rooms(identity: dict[str, str] = Depends(current_identity)):
    with closing(database()) as connection:
        rows = connection.execute(
            """
            SELECT r.id, r.name, r.created_at,
                   (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.id) AS member_count
            FROM rooms r JOIN room_members m ON m.room_id = r.id
            WHERE m.user_sub = ? ORDER BY r.created_at DESC LIMIT 100
            """,
            (identity["sub"],),
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/rooms/{room_id}/invites")
async def issue_room_invite(
    room_id: str,
    request: RoomInviteIssuance,
    identity: dict[str, str] = Depends(current_identity),
):
    room_member(room_id, identity)
    invite_code = secrets.token_urlsafe(32)
    invite_passcode = request.passcode or create_passcode()
    invite_id = str(uuid.uuid4())
    timestamp = utc_now()
    expires_at = (
        datetime.now(timezone.utc).timestamp() + request.expires_in_hours * 3600
        if request.expires_in_hours is not None else None
    )
    expiry_iso = (
        datetime.fromtimestamp(expires_at, timezone.utc).isoformat() if expires_at else None
    )
    salt = secrets.token_bytes(16)
    with closing(database()) as connection:
        connection.execute(
            """
            INSERT INTO room_invites(
                id, room_id, invite_hash, passcode_hash, max_uses,
                uses_count, expires_at, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
            """,
            (
                invite_id, room_id,
                hashlib.sha256(invite_code.encode("utf-8")).hexdigest(),
                f"{salt.hex()}:{passcode_hash(invite_passcode, salt)}",
                request.max_uses, expiry_iso, identity["sub"], timestamp,
            ),
        )
        connection.commit()
    return {
        "invite_id": invite_id,
        "invite_code": invite_code,
        "passcode": invite_passcode,
        "max_uses": request.max_uses,
        "expires_at": expiry_iso,
    }


@app.post("/api/rooms/join")
async def join_room(
    request: RoomJoin, identity: dict[str, str] = Depends(current_identity)
):
    invite_hash = hashlib.sha256(request.invite_code.encode("utf-8")).hexdigest()
    timestamp = utc_now()
    with closing(database()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        room = connection.execute(
            """
            SELECT r.id, r.name FROM rooms r
            WHERE r.invite_hash = ? OR EXISTS (
                SELECT 1 FROM room_invites i WHERE i.room_id = r.id AND i.invite_hash = ?
            )
            """,
            (invite_hash, invite_hash),
        ).fetchone()
        if not room:
            connection.rollback()
            raise HTTPException(status_code=404, detail="Invalid room invitation.")
        protected_invite = connection.execute(
            """
            SELECT id, passcode_hash, max_uses, uses_count, expires_at, revoked_at
            FROM room_invites WHERE room_id = ? AND invite_hash = ?
            """,
            (room["id"], invite_hash),
        ).fetchone()
        already_member = connection.execute(
            "SELECT 1 FROM room_members WHERE room_id = ? AND user_sub = ?",
            (room["id"], identity["sub"]),
        ).fetchone()
        if protected_invite and not already_member:
            if (
                protected_invite["revoked_at"]
                or protected_invite["uses_count"] >= protected_invite["max_uses"]
                or (
                    protected_invite["expires_at"]
                    and protected_invite["expires_at"] <= timestamp
                )
            ):
                connection.rollback()
                raise HTTPException(status_code=410, detail="This room invitation has expired or been voided.")
            if not request.passcode:
                connection.rollback()
                raise HTTPException(status_code=403, detail="Enter the six-digit room passcode.")
            try:
                salt_hex, expected_hash = protected_invite["passcode_hash"].split(":", 1)
                valid_passcode = verify_passcode(
                    request.passcode, bytes.fromhex(salt_hex), expected_hash
                )
            except (ValueError, TypeError):
                valid_passcode = False
            if not valid_passcode:
                connection.rollback()
                raise HTTPException(status_code=403, detail="The room passcode is incorrect.")
            changed = connection.execute(
                """
                UPDATE room_invites SET uses_count = uses_count + 1
                WHERE id = ? AND uses_count < max_uses AND revoked_at IS NULL
                """,
                (protected_invite["id"],),
            ).rowcount
            if not changed:
                connection.rollback()
                raise HTTPException(status_code=410, detail="This room invitation has reached its use limit.")
        connection.execute(
            "INSERT OR IGNORE INTO room_members(room_id, user_sub, user_name, joined_at) VALUES (?, ?, ?, ?)",
            (room["id"], identity["sub"], identity["name"], timestamp),
        )
        connection.commit()
    return {"id": room["id"], "name": room["name"]}


@app.get("/api/rooms/{room_id}/members")
async def list_room_members(
    room_id: str, identity: dict[str, str] = Depends(current_identity)
):
    room_member(room_id, identity)
    with closing(database()) as connection:
        rows = connection.execute(
            "SELECT user_sub, user_name, joined_at FROM room_members WHERE room_id = ? ORDER BY joined_at",
            (room_id,),
        ).fetchall()
    return [dict(row) for row in rows]


@app.get("/api/rooms/{room_id}/messages")
async def list_room_messages(
    room_id: str, identity: dict[str, str] = Depends(current_identity)
):
    room_member(room_id, identity)
    with closing(database()) as connection:
        rows = connection.execute(
            """
            SELECT id, sender_sub, sender_name, ciphertext, is_secret, tick_status, sent_at,
                   delivered_at, read_at, review_at, review_triggered_by, review_cost,
                   review_breakdown, ai_reply, review_ciphertext, verified_at, verified_by
            FROM room_messages WHERE room_id = ? ORDER BY sent_at DESC LIMIT 100
            """,
            (room_id,),
        ).fetchall()
    return [dict(row) for row in reversed(rows)]


@app.post("/api/rooms/{room_id}/messages")
async def relay_encrypted_room_message(
    room_id: str,
    request: RoomEncryptedMessage,
    identity: dict[str, str] = Depends(current_identity),
):
    room_member(room_id, identity)
    ciphertext = normalize_room_ciphertext(request.ciphertext)
    message_id = str(uuid.uuid4())
    timestamp = utc_now()
    with closing(database()) as connection:
        connection.execute(
            """
            INSERT INTO room_messages(
                id, room_id, sender_sub, sender_name, ciphertext,
                is_secret, tick_status, sent_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'sent', ?)
            """,
            (
                message_id, room_id, identity["sub"], identity["name"],
                ciphertext, int(request.is_secret), timestamp,
            ),
        )
        connection.commit()
    event_message = {
        "id": message_id,
        "sender_sub": identity["sub"],
        "sender_name": identity["name"],
        "ciphertext": ciphertext,
        "is_secret": request.is_secret,
        "tick_status": "sent",
        "sent_at": timestamp,
    }
    await room_hub.broadcast(
        room_id, {"type": "message.new", "client_id": None, "message": event_message},
        exclude_sub=identity["sub"],
    )
    return event_message


@app.post("/api/chat/inline-reply")
async def inline_push_reply(request: InlinePushReply):
    claims = verify_inline_push_reply_token(SESSION_SIGNING_KEY, request.reply_token)
    room_id = claims.get("room_id")
    sender_sub = claims.get("sub")
    sender_name = claims.get("name")
    token_id = claims.get("jti")
    if not all(isinstance(value, str) and value for value in (room_id, sender_sub, sender_name, token_id)):
        raise HTTPException(status_code=401, detail="Reply token is missing required claims.")
    if len(token_id) > 128 or len(sender_name) > 100:
        raise HTTPException(status_code=401, detail="Reply token claims are invalid.")
    room_member(room_id, {"sub": sender_sub})
    ciphertext = validate_room_ciphertext_envelope(request.text)
    message_id = str(uuid.uuid4())
    timestamp = utc_now()
    try:
        with closing(database()) as connection:
            connection.execute("DELETE FROM used_inline_reply_tokens WHERE expires_at <= ?", (int(time.time()),))
            connection.execute(
                """
                INSERT INTO used_inline_reply_tokens(token_id, consumed_at, expires_at)
                VALUES (?, ?, ?)
                """,
                (token_id, timestamp, int(claims["exp"])),
            )
            connection.execute(
                """
                INSERT INTO room_messages(
                    id, room_id, sender_sub, sender_name, ciphertext,
                    is_secret, tick_status, sent_at
                ) VALUES (?, ?, ?, ?, ?, 1, 'yellow_no_ai', ?)
                """,
                (message_id, room_id, sender_sub, sender_name[:100], ciphertext, timestamp),
            )
            connection.commit()
    except sqlite3.IntegrityError as error:
        raise HTTPException(status_code=409, detail="This inline reply token has already been used.") from error
    event = {
        "type": "message.new",
        "message": {
            "id": message_id,
            "sender_sub": sender_sub,
            "sender_name": sender_name[:100],
            "ciphertext": ciphertext,
            "is_secret": True,
            "tick_status": "yellow_no_ai",
            "sent_at": timestamp,
        },
        "tick_status": "yellow_no_ai",
        "tokens_burned": 0,
    }
    await room_hub.broadcast(room_id, event)
    return {"message_id": message_id, "tick_status": "yellow_no_ai", "tokens_burned": 0}


@app.get("/api/social/friends")
async def list_friends(identity: dict[str, str] = Depends(current_identity)):
    with closing(database()) as connection:
        rows = connection.execute(
            """
            SELECT u.user_sub, u.user_name, u.email
            FROM friendships f
            JOIN users u ON u.user_sub = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
            WHERE f.user_a = ? OR f.user_b = ?
            ORDER BY u.user_name COLLATE NOCASE
            """,
            (identity["sub"], identity["sub"], identity["sub"]),
        ).fetchall()
    return [dict(row) for row in rows]


@app.get("/api/social/requests")
async def list_friend_requests(identity: dict[str, str] = Depends(current_identity)):
    with closing(database()) as connection:
        rows = connection.execute(
            """
            SELECT f.id, f.sender_sub, u.user_name AS sender_name, u.email, f.created_at
            FROM friend_requests f JOIN users u ON u.user_sub = f.sender_sub
            WHERE f.receiver_sub = ? AND f.status = 'pending'
            ORDER BY f.created_at DESC LIMIT 100
            """,
            (identity["sub"],),
        ).fetchall()
    return [dict(row) for row in rows]


@app.get("/api/social/directory")
async def search_friend_directory(
    query: str = "",
    identity: dict[str, str] = Depends(current_identity),
):
    normalized = query.strip().casefold()
    if len(normalized) < 2:
        return []
    with closing(database()) as connection:
        viewer = connection.execute(
            """
            SELECT geo_region_hash, friend_circle_mode, allow_broader_discovery
            FROM users WHERE user_sub = ?
            """,
            (identity["sub"],),
        ).fetchone()
        if not viewer:
            return []
        rows = connection.execute(
            """
            SELECT user_sub, user_name, email, geo_region_hash, lookup_visibility
            FROM users
            WHERE user_sub != ? AND (email LIKE ? OR user_name LIKE ?)
            ORDER BY user_name COLLATE NOCASE LIMIT 20
            """,
            (identity["sub"], f"%{normalized}%", f"%{normalized}%"),
        ).fetchall()
        matches: list[dict[str, str]] = []
        for row in rows:
            if row["lookup_visibility"] == "invite_link_only":
                continue
            mutual = has_mutual_friend(connection, identity["sub"], row["user_sub"])
            if row["lookup_visibility"] == "mutual_contacts_only" and not mutual:
                continue
            circle_mode = viewer["friend_circle_mode"]
            if circle_mode == "mutuals_only" and not mutual:
                continue
            if circle_mode == "local_geo_circle_mutuals" and not (
                mutual
                and viewer["geo_region_hash"]
                and row["geo_region_hash"] == viewer["geo_region_hash"]
            ):
                continue
            if not mutual and not viewer["allow_broader_discovery"] and circle_mode != "everyone":
                continue
            matches.append(
                {
                    "user_sub": row["user_sub"],
                    "user_name": row["user_name"],
                    "email": row["email"],
                }
            )
    return matches


@app.post("/api/social/metasync")
async def metasync_contacts(
    request: MetaSyncRequest,
    identity: dict[str, str] = Depends(current_identity),
):
    with closing(database()) as connection:
        self_profile = connection.execute(
            "SELECT phone_hash FROM users WHERE user_sub = ?", (identity["sub"],)
        ).fetchone()
        if not self_profile or not self_profile["phone_hash"]:
            raise HTTPException(
                status_code=409,
                detail="Register your phone number before enabling MetaSync contact discovery.",
            )
        hashes = {metasync_phone_hash(phone) for phone in request.phone_numbers}
        timestamp = utc_now()
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DELETE FROM metasync_contacts WHERE user_sub = ?", (identity["sub"],))
        connection.executemany(
            "INSERT INTO metasync_contacts(user_sub, phone_hash, updated_at) VALUES (?, ?, ?)",
            [(identity["sub"], hashed, timestamp) for hashed in hashes],
        )
        matches = connection.execute(
            """
            SELECT p.user_sub, p.user_name, p.email
            FROM users p
            WHERE p.user_sub != ?
              AND p.phone_hash IN ({})
              AND EXISTS (
                  SELECT 1 FROM metasync_contacts c
                  WHERE c.user_sub = p.user_sub AND c.phone_hash = ?
              )
            ORDER BY p.user_name COLLATE NOCASE LIMIT 100
            """.format(",".join("?" for _ in hashes)),
            (identity["sub"], *hashes, self_profile["phone_hash"]),
        ).fetchall() if hashes else []
        connection.commit()
    return [dict(row) for row in matches]


@app.post("/api/social/requests")
async def send_friend_request(
    request: FriendRequest, identity: dict[str, str] = Depends(current_identity)
):
    email = request.email.strip().casefold()
    with closing(database()) as connection:
        recipient = connection.execute(
            "SELECT user_sub, geo_region_hash FROM users WHERE email = ?", (email,)
        ).fetchone()
        if not recipient:
            raise HTTPException(status_code=404, detail="No Genie user has signed in with that email yet.")
        if recipient["user_sub"] == identity["sub"]:
            raise HTTPException(status_code=422, detail="You cannot send a friend request to yourself.")
        sender = connection.execute(
            "SELECT geo_region_hash FROM users WHERE user_sub = ?", (identity["sub"],)
        ).fetchone()
        cross_geo = needs_personal_attestation(
            sender["geo_region_hash"] if sender else None,
            recipient["geo_region_hash"],
        )
        if cross_geo and not request.attest_personal:
            raise HTTPException(
                status_code=409,
                detail="Confirm that you know this person personally before sending a cross-region request.",
            )
        user_a, user_b = sorted((identity["sub"], recipient["user_sub"]))
        if connection.execute(
            "SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?", (user_a, user_b)
        ).fetchone():
            raise HTTPException(status_code=409, detail="You are already friends.")
        request_id = str(uuid.uuid4())
        connection.execute(
            """
            INSERT INTO friend_requests(
                id, sender_sub, receiver_sub, status, created_at, is_cross_geo,
                sender_attested_personal, sender_attested_at
            ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
            ON CONFLICT(sender_sub, receiver_sub) DO UPDATE SET status = 'pending',
                created_at = excluded.created_at, id = excluded.id,
                is_cross_geo = excluded.is_cross_geo,
                sender_attested_personal = excluded.sender_attested_personal,
                sender_attested_at = excluded.sender_attested_at,
                receiver_attested_personal = 0, receiver_attested_at = NULL
            """,
            (
                request_id, identity["sub"], recipient["user_sub"], utc_now(),
                int(cross_geo), int(cross_geo and request.attest_personal),
                utc_now() if cross_geo and request.attest_personal else None,
            ),
        )
        connection.commit()
    return {"id": request_id, "status": "pending"}


@app.post("/api/social/requests/{request_id}/accept")
async def accept_friend_request(
    request_id: str,
    acceptance: FriendAcceptance = FriendAcceptance(),
    identity: dict[str, str] = Depends(current_identity),
):
    with closing(database()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        request = connection.execute(
            """
            SELECT sender_sub, receiver_sub, is_cross_geo FROM friend_requests
            WHERE id = ? AND receiver_sub = ? AND status = 'pending'
            """,
            (request_id, identity["sub"]),
        ).fetchone()
        if not request:
            connection.rollback()
            raise HTTPException(status_code=404, detail="Friend request not found.")
        if request["is_cross_geo"] and not acceptance.attest_personal:
            connection.rollback()
            raise HTTPException(
                status_code=409,
                detail="Confirm that you personally know the sender before accepting this cross-region request.",
            )
        user_a, user_b = sorted((request["sender_sub"], request["receiver_sub"]))
        connection.execute(
            "INSERT OR IGNORE INTO friendships(user_a, user_b, created_at) VALUES (?, ?, ?)",
            (user_a, user_b, utc_now()),
        )
        connection.execute(
            """
            UPDATE friend_requests SET status = 'confirmed',
                receiver_attested_personal = ?, receiver_attested_at = ?
            WHERE id = ?
            """,
            (
                int(bool(request["is_cross_geo"] and acceptance.attest_personal)),
                utc_now() if request["is_cross_geo"] and acceptance.attest_personal else None,
                request_id,
            ),
        )
        connection.commit()
    return {"status": "confirmed"}


@app.post("/api/social/requests/{request_id}/reject")
async def reject_friend_request(
    request_id: str, identity: dict[str, str] = Depends(current_identity)
):
    with closing(database()) as connection:
        changed = connection.execute(
            """
            UPDATE friend_requests SET status = 'rejected'
            WHERE id = ? AND receiver_sub = ? AND status = 'pending'
            """,
            (request_id, identity["sub"]),
        ).rowcount
        connection.commit()
    if not changed:
        raise HTTPException(status_code=404, detail="Friend request not found.")
    return {"status": "rejected"}


@app.post("/api/rooms/{room_id}/messages/{message_id}/read")
async def mark_room_messages_read(
    room_id: str,
    message_id: str,
    identity: dict[str, str] = Depends(current_identity),
):
    room_member(room_id, identity)
    with closing(database()) as connection:
        timestamp = utc_now()
        connection.execute(
            """
            UPDATE room_messages SET tick_status = 'read_no_ai', read_at = ?
            WHERE id = ? AND room_id = ? AND sender_sub != ?
              AND tick_status IN ('sent', 'delivered')
            """,
            (timestamp, message_id, room_id, identity["sub"]),
        )
        message = connection.execute(
            "SELECT sender_sub FROM room_messages WHERE id = ? AND room_id = ?",
            (message_id, room_id),
        ).fetchone()
        if message and message["sender_sub"] != identity["sub"]:
            connection.execute(
                """
                INSERT OR IGNORE INTO message_read_receipts(message_id, user_sub, read_at)
                VALUES (?, ?, ?)
                """,
                (message_id, identity["sub"], timestamp),
            )
        connection.commit()
        row = connection.execute(
            "SELECT tick_status, read_at FROM room_messages WHERE id = ? AND room_id = ?",
            (message_id, room_id),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Message not found.")
    await room_hub.broadcast(
        room_id,
        {
            "type": "message.tick",
            "message_id": message_id,
            "tick_status": row["tick_status"],
            "read_at": row["read_at"],
        },
    )
    return {"tick_status": row["tick_status"]}


@app.get("/api/rooms/{room_id}/messages/{message_id}/ledger")
async def get_message_ledger(
    room_id: str,
    message_id: str,
    identity: dict[str, str] = Depends(current_identity),
):
    room_member(room_id, identity)
    with closing(database()) as connection:
        message = connection.execute(
            """
            SELECT id, sender_sub, sender_name, sent_at, updated_at, is_edited,
                   edited_by, ai_review_count, ai_reviewed_at, ai_reviewed_by,
                   ai_resolution_msg_id, review_at, review_triggered_by,
                   review_cost, review_breakdown, verified_at, verified_by
            FROM room_messages WHERE id = ? AND room_id = ?
            """,
            (message_id, room_id),
        ).fetchone()
        if not message:
            raise HTTPException(status_code=404, detail="Message not found.")
        receipts = connection.execute(
            """
            SELECT r.user_sub, u.user_name, r.read_at
            FROM message_read_receipts r
            JOIN room_members u ON u.room_id = ? AND u.user_sub = r.user_sub
            WHERE r.message_id = ? ORDER BY r.read_at
            """,
            (room_id, message_id),
        ).fetchall()
    return {**dict(message), "read_receipts": [dict(receipt) for receipt in receipts]}


@app.patch("/api/rooms/{room_id}/messages/{message_id}")
async def edit_room_message(
    room_id: str,
    message_id: str,
    request: EncryptedMessageEdit,
    identity: dict[str, str] = Depends(current_identity),
):
    room_member(room_id, identity)
    ciphertext = normalize_room_ciphertext(request.ciphertext)
    timestamp = utc_now()
    with closing(database()) as connection:
        changed = connection.execute(
            """
            UPDATE room_messages SET ciphertext = ?, updated_at = ?,
                is_edited = 1, edited_by = ?
            WHERE id = ? AND room_id = ? AND sender_sub = ?
            """,
            (ciphertext, timestamp, identity["sub"], message_id, room_id, identity["sub"]),
        ).rowcount
        connection.commit()
    if not changed:
        raise HTTPException(status_code=404, detail="Message not found or cannot be edited.")
    event = {
        "type": "message.edited",
        "message_id": message_id,
        "ciphertext": ciphertext,
        "updated_at": timestamp,
        "edited_by": identity["sub"],
    }
    await room_hub.broadcast(room_id, event)
    return event


@app.post("/api/rooms/{room_id}/messages/{message_id}/review")
async def review_room_message(
    room_id: str,
    message_id: str,
    request: RoomReview,
    identity: dict[str, str] = Depends(current_identity),
):
    room_member(room_id, identity)
    with closing(database()) as connection:
        target = connection.execute(
            "SELECT id, is_secret, tick_status, ai_review_count FROM room_messages WHERE id = ? AND room_id = ?",
            (message_id, room_id),
        ).fetchone()
    if not target:
        raise HTTPException(status_code=404, detail="Message not found.")
    if target["is_secret"]:
        return secret_chat_confirmation()
    if target["tick_status"] != "read_no_ai" or target["ai_review_count"] >= 1:
        raise HTTPException(status_code=409, detail="Read the room message before requesting an AI review.")
    safe_context = [
        item
        for item in request.context[-20:]
        if isinstance(item, dict)
        and not item.get("is_secret")
        and isinstance(item.get("content"), str)
        and not is_zero_knowledge_secret(item["content"])
    ]
    if not safe_context:
        raise HTTPException(status_code=422, detail="No reviewable room context was supplied.")
    with closing(database()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        reserved = connection.execute(
            """
            UPDATE room_messages SET ai_review_count = 1
            WHERE id = ? AND room_id = ? AND tick_status = 'read_no_ai'
              AND is_secret = 0 AND ai_review_count = 0
            """,
            (message_id, room_id),
        ).rowcount
        if reserved != 1:
            connection.rollback()
            raise HTTPException(status_code=409, detail="This message already has an AI review.")
        connection.commit()
    try:
        summary = await asyncio.to_thread(gemini_pool.silent_pro_summarize, safe_context)
        prompt = str(safe_context[-1].get("content", "Review this discussion."))[:20_000]
        cost = gemini_pool.calculate_dynamic_master_tokens(
            prompt,
            len(safe_context),
            sum(len(str(item["content"])) for item in safe_context),
            0,
        )
        reply = await asyncio.to_thread(
            gemini_pool.chat,
            [
                {"role": "user", "content": f"Conversation summary:\n{summary}"},
                {"role": "user", "content": f"Provide a helpful review of this request:\n{prompt}"},
            ],
            True,
        )
    except RuntimeError as error:
        with closing(database()) as connection:
            connection.execute(
                "UPDATE room_messages SET ai_review_count = 0 WHERE id = ? AND room_id = ? AND ai_review_count = 1 AND tick_status = 'read_no_ai'",
                (message_id, room_id),
            )
            connection.commit()
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        with closing(database()) as connection:
            connection.execute(
                "UPDATE room_messages SET ai_review_count = 0 WHERE id = ? AND room_id = ? AND ai_review_count = 1 AND tick_status = 'read_no_ai'",
                (message_id, room_id),
            )
            connection.commit()
        LOGGER.warning("Room review provider request failed (%s)", type(error).__name__)
        raise HTTPException(status_code=502, detail="AI review failed.") from error

    timestamp = utc_now()
    with closing(database()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """
            UPDATE room_messages SET tick_status = 'ai_review_active', review_at = ?,
                review_triggered_by = ?, review_cost = ?, review_breakdown = ?, ai_reply = ?,
                review_ciphertext = NULL, verified_at = NULL, verified_by = NULL
            WHERE id = ? AND room_id = ? AND tick_status = 'read_no_ai' AND ai_review_count = 1
            """,
            (
                timestamp, identity["sub"], cost["tokens_burned"], cost["breakdown"],
                None, message_id, room_id,
            ),
        )
        if connection.execute("SELECT changes() AS changed").fetchone()["changed"] != 1:
            connection.rollback()
            raise HTTPException(status_code=409, detail="This message already has an AI review.")
        connection.execute(
            "INSERT INTO token_ledger(user_sub, room_id, message_id, tokens, breakdown, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (
                identity["sub"], room_id, message_id, cost["tokens_burned"],
                cost["breakdown"], timestamp,
            ),
        )
        connection.commit()
    event = {
        "type": "message.ai_review",
        "message_id": message_id,
        "tick_status": "red",
        "triggered_by": identity["name"],
        "triggered_by_sub": identity["sub"],
        "tokens_burned": cost["tokens_burned"],
        "breakdown": cost["breakdown"],
        "ai_reply": reply,
        "review_at": timestamp,
    }
    await room_hub.broadcast(room_id, event)
    return event


@app.post("/api/rooms/{room_id}/messages/{message_id}/review-ciphertext")
async def save_encrypted_review(
    room_id: str,
    message_id: str,
    request: EncryptedReview,
    identity: dict[str, str] = Depends(current_identity),
):
    room_member(room_id, identity)
    ciphertext = normalize_room_ciphertext(request.ciphertext)
    with closing(database()) as connection:
        connection.execute(
            """
            UPDATE room_messages SET review_ciphertext = ?
            WHERE id = ? AND room_id = ? AND review_triggered_by = ?
              AND tick_status = 'ai_review_active'
            """,
            (ciphertext, message_id, room_id, identity["sub"]),
        )
        connection.commit()
        changed = connection.execute("SELECT changes() AS changed").fetchone()["changed"]
    if not changed:
        raise HTTPException(
            status_code=409,
            detail="Only the active review owner can save its encrypted result.",
        )
    return {"stored": True}


@app.post("/api/rooms/{room_id}/messages/{message_id}/verify")
async def verify_room_review(
    room_id: str,
    message_id: str,
    identity: dict[str, str] = Depends(current_identity),
):
    room_member(room_id, identity)
    timestamp = utc_now()
    with closing(database()) as connection:
        connection.execute(
            """
            UPDATE room_messages SET tick_status = 'ai_verified', verified_at = ?, verified_by = ?
            WHERE id = ? AND room_id = ? AND review_triggered_by = ?
              AND tick_status = 'ai_review_active'
            """,
            (timestamp, identity["sub"], message_id, room_id, identity["sub"]),
        )
        connection.commit()
        updated = connection.execute(
            "SELECT changes() AS changed"
        ).fetchone()["changed"]
    if not updated:
        raise HTTPException(
            status_code=409, detail="Only the user who triggered the active review can verify it."
        )
    event = {
        "type": "message.ai_verified",
        "message_id": message_id,
        "tick_status": "green",
        "verified_at": timestamp,
        "verified_by_sub": identity["sub"],
    }
    await room_hub.broadcast(room_id, event)
    return event


class RoomSocketHub:
    def __init__(self) -> None:
        self.sockets: dict[str, dict[str, set[WebSocket]]] = {}
        self.lock = asyncio.Lock()

    async def connect(self, room_id: str, user_sub: str, socket: WebSocket) -> None:
        async with self.lock:
            self.sockets.setdefault(room_id, {}).setdefault(user_sub, set()).add(socket)
        await self.broadcast(
            room_id, {"type": "presence", "user_sub": user_sub, "online": True}
        )

    async def disconnect_user(self, user_sub: str) -> None:
        async with self.lock:
            sockets = [
                socket
                for members in self.sockets.values()
                for socket in members.get(user_sub, set()).copy()
            ]
        for socket in sockets:
            try:
                await socket.close(code=4401, reason="Account removed")
            except RuntimeError:
                LOGGER.info("Room socket was already closed during account removal.")

    async def disconnect(self, room_id: str, user_sub: str, socket: WebSocket) -> None:
        async with self.lock:
            members = self.sockets.get(room_id, {})
            members.get(user_sub, set()).discard(socket)
            offline = not members.get(user_sub)
            if offline:
                members.pop(user_sub, None)
            if not members:
                self.sockets.pop(room_id, None)
        if offline:
            await self.broadcast(
                room_id, {"type": "presence", "user_sub": user_sub, "online": False}
            )

    async def broadcast(
        self, room_id: str, event: dict[str, Any], exclude_sub: str | None = None
    ) -> int:
        async with self.lock:
            entries = [
                (sub, socket)
                for sub, sockets in self.sockets.get(room_id, {}).items()
                if sub != exclude_sub
                for socket in sockets.copy()
            ]
        stale: list[tuple[str, WebSocket]] = []
        for sub, socket in entries:
            try:
                await socket.send_json(event)
            except Exception:
                stale.append((sub, socket))
        for sub, socket in stale:
            await self.disconnect(room_id, sub, socket)
        return len(entries) - len(stale)

    async def relay_call(
        self, room_id: str, sender: str, recipient: str, payload: dict[str, Any]
    ) -> None:
        async with self.lock:
            sockets = list(self.sockets.get(room_id, {}).get(recipient, set()))
        for socket in sockets:
            await socket.send_json(
                {"type": "call.signal", "from_sub": sender, "payload": payload}
            )


room_hub = RoomSocketHub()


@app.websocket("/api/rooms/{room_id}/socket")
async def room_socket(socket: WebSocket, room_id: str):
    await socket.accept()
    try:
        hello = await asyncio.wait_for(socket.receive_json(), timeout=10)
        if not isinstance(hello, dict) or not isinstance(hello.get("credential"), str):
            await socket.close(code=4401, reason="Authentication required")
            return
        identity = await current_identity(f"Bearer {hello['credential']}")
        room_member(room_id, identity)
    except HTTPException:
        await socket.close(code=4403, reason="Room access denied")
        return
    except (asyncio.TimeoutError, ValueError, WebSocketDisconnect):
        await socket.close(code=4401, reason="Invalid authentication")
        return

    await room_hub.connect(room_id, identity["sub"], socket)
    try:
        with closing(database()) as connection:
            history = connection.execute(
                """
                SELECT id, sender_sub, sender_name, ciphertext, is_secret, tick_status,
                       sent_at, delivered_at, read_at, review_at, review_triggered_by,
                       review_cost, review_breakdown, ai_reply, review_ciphertext,
                       verified_at, verified_by
                FROM room_messages WHERE room_id = ? ORDER BY sent_at DESC LIMIT 100
                """,
                (room_id,),
            ).fetchall()
        await socket.send_json({"type": "history", "messages": [dict(row) for row in reversed(history)]})
        while True:
            event = await socket.receive_json()
            if not isinstance(event, dict):
                continue
            event_type = event.get("type")
            if event_type == "message.send":
                ciphertext = normalize_room_ciphertext(event.get("ciphertext"))
                message_id = str(uuid.uuid4())
                client_id = event.get("client_id")
                if not isinstance(client_id, str) or len(client_id) > 100:
                    client_id = None
                timestamp = utc_now()
                is_secret = bool(event.get("is_secret"))
                with closing(database()) as connection:
                    connection.execute(
                        """
                        INSERT INTO room_messages(id, room_id, sender_sub, sender_name,
                                                  ciphertext, is_secret, tick_status, sent_at)
                        VALUES (?, ?, ?, ?, ?, ?, 'sent', ?)
                        """,
                        (
                            message_id, room_id, identity["sub"], identity["name"],
                            ciphertext, int(is_secret), timestamp,
                        ),
                    )
                    connection.commit()
                deliveries = await room_hub.broadcast(
                    room_id,
                    {
                        "type": "message.new",
                        "client_id": client_id if isinstance(client_id, str) else None,
                        "message": {
                            "id": message_id,
                            "sender_sub": identity["sub"],
                            "sender_name": identity["name"],
                            "ciphertext": ciphertext,
                            "is_secret": is_secret,
                            "tick_status": "sent",
                            "sent_at": timestamp,
                        },
                    },
                    exclude_sub=identity["sub"],
                )
                await socket.send_json(
                    {
                        "type": "message.ack",
                        "client_id": client_id if isinstance(client_id, str) else None,
                        "message": {
                            "id": message_id,
                            "sender_sub": identity["sub"],
                            "sender_name": identity["name"],
                            "ciphertext": ciphertext,
                            "is_secret": is_secret,
                            "tick_status": "sent",
                            "sent_at": timestamp,
                        },
                    }
                )
                if deliveries:
                    delivered_at = utc_now()
                    with closing(database()) as connection:
                        connection.execute(
                            "UPDATE room_messages SET tick_status = 'delivered', delivered_at = ? WHERE id = ?",
                            (delivered_at, message_id),
                        )
                        connection.commit()
                    await room_hub.broadcast(
                        room_id,
                        {
                            "type": "message.tick",
                            "message_id": message_id,
                            "tick_status": "delivered",
                            "delivered_at": delivered_at,
                        },
                    )
            elif event_type == "message.read":
                message_id = event.get("message_id")
                if not isinstance(message_id, str):
                    continue
                read_at = utc_now()
                with closing(database()) as connection:
                    changed = connection.execute(
                        """
                        UPDATE room_messages SET tick_status = 'read_no_ai', read_at = ?
                        WHERE id = ? AND room_id = ? AND sender_sub != ?
                          AND tick_status IN ('sent', 'delivered')
                        """,
                        (read_at, message_id, room_id, identity["sub"]),
                    ).rowcount
                    message = connection.execute(
                        "SELECT read_at, sender_sub FROM room_messages WHERE id = ? AND room_id = ?",
                        (message_id, room_id),
                    ).fetchone() if changed else None
                    if message:
                        connection.execute(
                            """
                            INSERT OR IGNORE INTO message_read_receipts(message_id, user_sub, read_at)
                            VALUES (?, ?, ?)
                            """,
                            (message_id, identity["sub"], read_at),
                        )
                    connection.commit()
                if changed and message:
                    await room_hub.broadcast(
                        room_id,
                        {
                            "type": "message.tick",
                            "message_id": message_id,
                            "tick_status": "read_no_ai",
                            "read_at": message["read_at"],
                        },
                    )
            elif event_type == "message.edit":
                message_id = event.get("message_id")
                ciphertext = normalize_room_ciphertext(event.get("ciphertext"))
                if not isinstance(message_id, str):
                    continue
                updated_at = utc_now()
                with closing(database()) as connection:
                    changed = connection.execute(
                        """
                        UPDATE room_messages SET ciphertext = ?, updated_at = ?,
                            is_edited = 1, edited_by = ?
                        WHERE id = ? AND room_id = ? AND sender_sub = ?
                        """,
                        (
                            ciphertext, updated_at, identity["sub"], message_id,
                            room_id, identity["sub"],
                        ),
                    ).rowcount
                    connection.commit()
                if changed:
                    await room_hub.broadcast(
                        room_id,
                        {
                            "type": "message.edited",
                            "message_id": message_id,
                            "ciphertext": ciphertext,
                            "updated_at": updated_at,
                            "edited_by": identity["sub"],
                        },
                    )
            elif event_type in {"typing", "recording", "prompting", "idle"}:
                await room_hub.broadcast(
                    room_id,
                    {
                        "type": "activity",
                        "activity": None if event_type == "idle" else event_type,
                        "user_sub": identity["sub"],
                        "user_name": identity["name"],
                    },
                    exclude_sub=identity["sub"],
                )
            elif event_type == "call.signal":
                recipient = event.get("to_sub")
                payload = event.get("payload")
                if (
                    isinstance(recipient, str)
                    and isinstance(payload, dict)
                    and len(json.dumps(payload)) <= 32_000
                ):
                    room_member(room_id, {"sub": recipient})
                    await room_hub.relay_call(room_id, identity["sub"], recipient, payload)
    except WebSocketDisconnect:
        pass
    finally:
        await room_hub.disconnect(room_id, identity["sub"], socket)


def _web_authn():
    try:
        from webauthn import (
            generate_authentication_options,
            generate_registration_options,
            verify_authentication_response,
            verify_registration_response,
        )
        from webauthn.helpers import options_to_json
        from webauthn.helpers.structs import (
            AuthenticatorSelectionCriteria,
            PublicKeyCredentialDescriptor,
            ResidentKeyRequirement,
            UserVerificationRequirement,
        )
    except ImportError as error:
        raise HTTPException(status_code=503, detail="WebAuthn support is not installed.") from error
    return (
        generate_authentication_options,
        generate_registration_options,
        verify_authentication_response,
        verify_registration_response,
        options_to_json,
        AuthenticatorSelectionCriteria,
        PublicKeyCredentialDescriptor,
        ResidentKeyRequirement,
        UserVerificationRequirement,
    )


def require_super_admin(identity: dict[str, str]) -> None:
    if identity["email"] != SUPER_ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Super administrator access required.")


def save_challenge(user_sub: str, challenge: bytes, purpose: str) -> None:
    with closing(database()) as connection:
        connection.execute("DELETE FROM passkey_challenges WHERE expires_at < ?", (int(time.time()),))
        connection.execute(
            "INSERT INTO passkey_challenges(id, user_sub, challenge, purpose, expires_at) VALUES (?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), user_sub, challenge, purpose, int(time.time()) + 300),
        )
        connection.commit()


def consume_challenge(user_sub: str, purpose: str) -> bytes:
    with closing(database()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """
            SELECT id, challenge FROM passkey_challenges
            WHERE user_sub = ? AND purpose = ? AND expires_at > ?
            ORDER BY expires_at DESC LIMIT 1
            """,
            (user_sub, purpose, int(time.time())),
        ).fetchone()
        if row:
            connection.execute("DELETE FROM passkey_challenges WHERE id = ?", (row["id"],))
            connection.commit()
            return bytes(row["challenge"])
        connection.rollback()
    raise HTTPException(status_code=400, detail="Passkey challenge expired or was already used.")


@app.post("/api/auth/passkeys/enroll/options")
async def user_passkey_enrollment_options(identity: dict[str, str] = Depends(current_identity)):
    (
        _,
        generate_registration_options,
        _,
        _,
        options_to_json,
        AuthenticatorSelectionCriteria,
        PublicKeyCredentialDescriptor,
        ResidentKeyRequirement,
        UserVerificationRequirement,
    ) = _web_authn()
    with closing(database()) as connection:
        user = connection.execute(
            "SELECT email, display_name, user_name, registration_complete FROM users WHERE user_sub = ?",
            (identity["sub"],),
        ).fetchone()
        existing = connection.execute(
            "SELECT credential_id FROM passkeys WHERE user_sub = ?", (identity["sub"],)
        ).fetchall()
    if not user or not user["registration_complete"]:
        raise HTTPException(status_code=403, detail="Complete registration before adding a passkey.")
    options = generate_registration_options(
        rp_id=WEBAUTHN_RP_ID,
        rp_name=WEBAUTHN_RP_NAME,
        user_id=identity["sub"].encode("utf-8"),
        user_name=user["email"],
        user_display_name=user["display_name"] or user["user_name"],
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=bytes(row["credential_id"]))
            for row in existing
        ],
    )
    save_challenge(identity["sub"], bytes(options.challenge), "user_registration")
    return JSONResponse(content=json.loads(options_to_json(options)), headers={"Cache-Control": "no-store"})


@app.post("/api/auth/passkeys/enroll/verify")
async def user_passkey_enrollment_verify(
    request: PasskeyCredential, identity: dict[str, str] = Depends(current_identity)
):
    challenge = consume_challenge(identity["sub"], "user_registration")
    try:
        result = _web_authn()[3](
            credential=request.credential,
            expected_challenge=challenge,
            expected_rp_id=WEBAUTHN_RP_ID,
            expected_origin=WEBAUTHN_ORIGIN,
            require_user_verification=True,
        )
    except Exception as error:
        raise HTTPException(status_code=400, detail="Passkey registration could not be verified.") from error
    response = request.credential.get("response", {})
    transports = response.get("transports", []) if isinstance(response, dict) else []
    if not isinstance(transports, list) or any(not isinstance(value, str) for value in transports):
        transports = []
    with closing(database()) as connection:
        try:
            connection.execute(
                """
                INSERT INTO passkeys(credential_id, user_sub, public_key, sign_count, transports, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    result.credential_id,
                    identity["sub"],
                    result.credential_public_key,
                    result.sign_count,
                    json.dumps(transports),
                    utc_now(),
                ),
            )
            connection.commit()
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=409, detail="This passkey is already registered.") from error
    return {"registered": True}


@app.post("/api/auth/passkeys/login/options")
async def user_passkey_login_options(request: PasskeyLoginEmail):
    email = request.email.strip().casefold()
    (
        generate_authentication_options,
        _,
        _,
        _,
        options_to_json,
        _,
        PublicKeyCredentialDescriptor,
        _,
        UserVerificationRequirement,
    ) = _web_authn()
    with closing(database()) as connection:
        user = connection.execute(
            "SELECT user_sub FROM users WHERE email = ? AND registration_complete = 1",
            (email,),
        ).fetchone()
        rows = connection.execute(
            """
            SELECT p.credential_id, p.transports
            FROM passkeys p JOIN users u ON u.user_sub = p.user_sub
            WHERE u.email = ? AND u.registration_complete = 1
            """,
            (email,),
        ).fetchall()
    if not user or not rows:
        raise HTTPException(status_code=404, detail="No active account passkey was found for that email.")
    credentials = [
        PublicKeyCredentialDescriptor(
            id=bytes(row["credential_id"]),
            transports=json.loads(row["transports"]),
        )
        for row in rows
    ]
    options = generate_authentication_options(
        rp_id=WEBAUTHN_RP_ID,
        allow_credentials=credentials,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    save_challenge(user["user_sub"], bytes(options.challenge), "user_authentication")
    return JSONResponse(content=json.loads(options_to_json(options)), headers={"Cache-Control": "no-store"})


@app.post("/api/auth/passkeys/login/verify")
async def user_passkey_login_verify(request: PasskeyLoginCredential):
    email = request.email.strip().casefold()
    credential_id = request.credential.get("id")
    if not isinstance(credential_id, str):
        raise HTTPException(status_code=400, detail="Passkey credential identifier is invalid.")
    try:
        credential_id_bytes = base64.urlsafe_b64decode(credential_id + "=" * (-len(credential_id) % 4))
    except (ValueError, binascii.Error) as error:
        raise HTTPException(status_code=400, detail="Passkey credential identifier is invalid.") from error
    with closing(database()) as connection:
        user = connection.execute(
            """
            SELECT u.user_sub, u.email, u.user_name, u.display_name, u.picture_url,
                   u.custom_picture_data, p.public_key, p.sign_count
            FROM users u JOIN passkeys p ON p.user_sub = u.user_sub
            WHERE u.email = ? AND u.registration_complete = 1 AND p.credential_id = ?
            """,
            (email, credential_id_bytes),
        ).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="This passkey is not registered to an active account.")
    challenge = consume_challenge(user["user_sub"], "user_authentication")
    try:
        result = _web_authn()[2](
            credential=request.credential,
            expected_challenge=challenge,
            expected_rp_id=WEBAUTHN_RP_ID,
            expected_origin=WEBAUTHN_ORIGIN,
            credential_public_key=bytes(user["public_key"]),
            credential_current_sign_count=user["sign_count"],
            require_user_verification=True,
        )
    except Exception as error:
        raise HTTPException(status_code=401, detail="Passkey authentication failed.") from error
    with closing(database()) as connection:
        connection.execute(
            "UPDATE passkeys SET sign_count = ? WHERE credential_id = ? AND user_sub = ?",
            (result.new_sign_count, credential_id_bytes, user["user_sub"]),
        )
        connection.commit()
    return {
        "session_token": issue_user_session(user),
        "expires_in": 60 * 60 * 24 * 7,
        "identity": {
            "sub": user["user_sub"],
            "email": user["email"],
            "name": user["display_name"] or user["user_name"],
            "picture": user["custom_picture_data"] or user["picture_url"] or "",
        },
    }


@app.post("/api/admin/passkeys/enroll/options")
async def passkey_enrollment_options(identity: dict[str, str] = Depends(current_identity)):
    require_super_admin(identity)
    (
        _,
        generate_registration_options,
        _,
        _,
        options_to_json,
        AuthenticatorSelectionCriteria,
        _,
        ResidentKeyRequirement,
        UserVerificationRequirement,
    ) = _web_authn()
    with closing(database()) as connection:
        existing = connection.execute(
            "SELECT credential_id FROM passkeys WHERE user_sub = ?", (identity["sub"],)
        ).fetchall()
    options = generate_registration_options(
        rp_id=WEBAUTHN_RP_ID,
        rp_name=WEBAUTHN_RP_NAME,
        user_id=identity["sub"].encode("utf-8"),
        user_name=identity["email"],
        user_display_name=identity["name"],
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[
            _web_authn()[6](id=bytes(row["credential_id"])) for row in existing
        ],
    )
    save_challenge(identity["sub"], bytes(options.challenge), "registration")
    return JSONResponse(content=json.loads(options_to_json(options)), headers={"Cache-Control": "no-store"})


@app.post("/api/admin/passkeys/enroll/verify")
async def passkey_enrollment_verify(
    request: PasskeyCredential, identity: dict[str, str] = Depends(current_identity)
):
    require_super_admin(identity)
    verifier = _web_authn()[3]
    challenge = consume_challenge(identity["sub"], "registration")
    try:
        result = verifier(
            credential=request.credential,
            expected_challenge=challenge,
            expected_rp_id=WEBAUTHN_RP_ID,
            expected_origin=WEBAUTHN_ORIGIN,
            require_user_verification=True,
        )
    except Exception as error:
        raise HTTPException(status_code=400, detail="Passkey registration could not be verified.") from error
    response = request.credential.get("response", {})
    transports = response.get("transports", []) if isinstance(response, dict) else []
    with closing(database()) as connection:
        connection.execute(
            """
            INSERT INTO passkeys(credential_id, user_sub, public_key, sign_count, transports, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(credential_id) DO UPDATE SET public_key = excluded.public_key,
                sign_count = excluded.sign_count, transports = excluded.transports
            """,
            (
                result.credential_id,
                identity["sub"],
                result.credential_public_key,
                result.sign_count,
                json.dumps(transports),
                utc_now(),
            ),
        )
        connection.commit()
    return {"registered": True}


@app.post("/api/admin/passkeys/auth/options")
async def passkey_auth_options(identity: dict[str, str] = Depends(current_identity)):
    require_super_admin(identity)
    (
        generate_authentication_options,
        _,
        _,
        _,
        options_to_json,
        _,
        PublicKeyCredentialDescriptor,
        _,
        UserVerificationRequirement,
    ) = _web_authn()
    with closing(database()) as connection:
        rows = connection.execute(
            "SELECT credential_id, transports FROM passkeys WHERE user_sub = ?",
            (identity["sub"],),
        ).fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail="Enroll a device passkey before unlocking admin.")
    credentials = [
        PublicKeyCredentialDescriptor(
            id=bytes(row["credential_id"]),
            transports=json.loads(row["transports"]),
        )
        for row in rows
    ]
    options = generate_authentication_options(
        rp_id=WEBAUTHN_RP_ID,
        allow_credentials=credentials,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    save_challenge(identity["sub"], bytes(options.challenge), "authentication")
    return JSONResponse(content=json.loads(options_to_json(options)), headers={"Cache-Control": "no-store"})


def make_admin_session(user_sub: str) -> str:
    if len(ADMIN_SIGNING_KEY.encode("utf-8")) < 32:
        raise HTTPException(status_code=503, detail="Admin session signing is not configured.")
    payload = base64.urlsafe_b64encode(
        json.dumps(
            {"sub": user_sub, "exp": int(time.time()) + 300, "jti": secrets.token_urlsafe(18)},
            separators=(",", ":"),
        ).encode("utf-8")
    ).decode("ascii").rstrip("=")
    signature = hmac.new(ADMIN_SIGNING_KEY.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest()
    return f"{payload}.{base64.urlsafe_b64encode(signature).decode('ascii').rstrip('=')}"


def verify_admin_session(token: str) -> dict[str, Any]:
    if len(ADMIN_SIGNING_KEY.encode("utf-8")) < 32:
        raise HTTPException(status_code=503, detail="Admin session signing is not configured.")
    parts = token.split(".")
    if len(parts) != 2:
        raise HTTPException(status_code=401, detail="Invalid admin session.")
    payload_part, signature_part = parts
    expected = hmac.new(ADMIN_SIGNING_KEY.encode("utf-8"), payload_part.encode("ascii"), hashlib.sha256).digest()
    try:
        signature = base64.urlsafe_b64decode(signature_part + "=" * (-len(signature_part) % 4))
        payload = json.loads(base64.urlsafe_b64decode(payload_part + "=" * (-len(payload_part) % 4)))
    except (ValueError, UnicodeError) as error:
        raise HTTPException(status_code=401, detail="Invalid admin session.") from error
    if not hmac.compare_digest(expected, signature) or payload.get("exp", 0) <= int(time.time()):
        raise HTTPException(status_code=401, detail="Invalid or expired admin session.")
    return payload


@app.post("/api/admin/passkeys/auth/verify")
async def passkey_auth_verify(request: PasskeyCredential, identity: dict[str, str] = Depends(current_identity)):
    require_super_admin(identity)
    verifier = _web_authn()[2]
    challenge = consume_challenge(identity["sub"], "authentication")
    credential_id = request.credential.get("id")
    if not isinstance(credential_id, str):
        raise HTTPException(status_code=400, detail="Passkey credential identifier is invalid.")
    try:
        credential_id_bytes = base64.urlsafe_b64decode(credential_id + "=" * (-len(credential_id) % 4))
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Passkey credential identifier is invalid.") from error
    with closing(database()) as connection:
        saved = connection.execute(
            "SELECT public_key, sign_count FROM passkeys WHERE credential_id = ? AND user_sub = ?",
            (credential_id_bytes, identity["sub"]),
        ).fetchone()
    if not saved:
        raise HTTPException(status_code=401, detail="This device passkey is not registered.")
    try:
        result = verifier(
            credential=request.credential,
            expected_challenge=challenge,
            expected_rp_id=WEBAUTHN_RP_ID,
            expected_origin=WEBAUTHN_ORIGIN,
            credential_public_key=bytes(saved["public_key"]),
            credential_current_sign_count=saved["sign_count"],
            require_user_verification=True,
        )
    except Exception as error:
        raise HTTPException(status_code=401, detail="Passkey authentication failed.") from error
    with closing(database()) as connection:
        connection.execute(
            "UPDATE passkeys SET sign_count = ? WHERE credential_id = ?",
            (result.new_sign_count, credential_id_bytes),
        )
        connection.commit()
    return {"admin_session": make_admin_session(identity["sub"]), "expires_in": 300}


@app.get("/api/admin/status")
async def admin_status(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Passkey admin session is required.")
    session = verify_admin_session(authorization[7:].strip())
    with closing(database()) as connection:
        rooms = connection.execute("SELECT COUNT(*) AS total FROM rooms").fetchone()["total"]
        users = connection.execute("SELECT COUNT(*) AS total FROM users").fetchone()["total"]
        review = connection.execute(
            "SELECT COUNT(*) AS total, COALESCE(SUM(tokens), 0) AS tokens FROM token_ledger"
        ).fetchone()
    return {
        "status": "unlocked",
        "expires_at": session["exp"],
        "rooms": rooms,
        "users": users,
        "reviews": review["total"],
        "review_tokens": review["tokens"],
    }


def require_admin_session(
    authorization: str | None, identity: dict[str, str]
) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Passkey admin session is required.")
    session = verify_admin_session(authorization[7:].strip())
    if session.get("sub") != identity["sub"]:
        raise HTTPException(status_code=403, detail="Admin session belongs to another identity.")
    return session


def require_genesis_owner(identity: dict[str, str]) -> None:
    if identity.get("email", "").casefold() != SUPER_ADMIN_EMAIL.casefold():
        raise HTTPException(status_code=404, detail="Not found.")


def verify_sovereign_totp(code: str) -> None:
    try:
        import pyotp
    except ImportError as error:
        raise HTTPException(status_code=503, detail="TOTP support is not installed.") from error
    if not SOVEREIGN_TOTP_FERNET_KEY:
        raise HTTPException(status_code=503, detail="Sovereign TOTP encryption is not configured.")
    with closing(database()) as connection:
        state = connection.execute(
            "SELECT totp_secret_encrypted, sovereign_claimed FROM sovereign_state WHERE id = 1"
        ).fetchone()
    if not state or not state["sovereign_claimed"] or not state["totp_secret_encrypted"]:
        raise HTTPException(status_code=409, detail="Complete the one-time Genesis claim first.")
    try:
        secret = decrypt_totp_secret(state["totp_secret_encrypted"], SOVEREIGN_TOTP_FERNET_KEY)
    except ValueError as error:
        LOGGER.error("Could not decrypt the Sovereign TOTP secret.")
        raise HTTPException(status_code=503, detail="Sovereign TOTP configuration is invalid.") from error
    if not pyotp.TOTP(secret).verify(code, valid_window=1):
        raise HTTPException(status_code=401, detail="The authenticator code is invalid.")


@app.post("/api/admin/genesis/claim")
async def start_genesis_claim(
    identity: dict[str, str] = Depends(current_identity),
    authorization: str | None = Header(default=None),
):
    require_genesis_owner(identity)
    require_admin_session(authorization, identity)
    if not SOVEREIGN_TOTP_FERNET_KEY:
        raise HTTPException(status_code=503, detail="Sovereign TOTP encryption is not configured.")
    try:
        import pyotp
        import qrcode
    except ImportError as error:
        raise HTTPException(status_code=503, detail="TOTP and QR dependencies are not installed.") from error
    with closing(database()) as connection:
        state = connection.execute(
            "SELECT sovereign_claimed, totp_secret_encrypted FROM sovereign_state WHERE id = 1"
        ).fetchone()
        if state["sovereign_claimed"]:
            raise HTTPException(status_code=410, detail="The Genesis claim is permanently sealed.")
        secret = (
            decrypt_totp_secret(state["totp_secret_encrypted"], SOVEREIGN_TOTP_FERNET_KEY)
            if state["totp_secret_encrypted"]
            else pyotp.random_base32()
        )
        if not state["totp_secret_encrypted"]:
            connection.execute(
                "UPDATE sovereign_state SET claimed_by = ?, totp_secret_encrypted = ? WHERE id = 1",
                (identity["sub"], encrypt_totp_secret(secret, SOVEREIGN_TOTP_FERNET_KEY)),
            )
            connection.commit()
    account = pyotp.TOTP(secret)
    uri = account.provisioning_uri(identity["email"], issuer_name="Personal AI Genie")
    image = qrcode.make(uri)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return {
        "provisioning_uri": uri,
        "qr_png_base64": base64.b64encode(output.getvalue()).decode("ascii"),
        "expires_in": 300,
    }


@app.post("/api/admin/genesis/claim/verify")
async def finish_genesis_claim(
    request: GenesisTotpVerify,
    identity: dict[str, str] = Depends(current_identity),
    authorization: str | None = Header(default=None),
):
    require_genesis_owner(identity)
    require_admin_session(authorization, identity)
    try:
        import pyotp
    except ImportError as error:
        raise HTTPException(status_code=503, detail="TOTP support is not installed.") from error
    with closing(database()) as connection:
        state = connection.execute(
            "SELECT sovereign_claimed, claimed_by, totp_secret_encrypted FROM sovereign_state WHERE id = 1"
        ).fetchone()
        if state["sovereign_claimed"]:
            raise HTTPException(status_code=410, detail="The Genesis claim is permanently sealed.")
        if state["claimed_by"] != identity["sub"] or not state["totp_secret_encrypted"]:
            raise HTTPException(status_code=409, detail="Start the Genesis claim on this admin account first.")
        try:
            secret = decrypt_totp_secret(
                state["totp_secret_encrypted"], SOVEREIGN_TOTP_FERNET_KEY
            )
        except ValueError as error:
            LOGGER.error("Could not decrypt the pending Genesis TOTP secret.")
            raise HTTPException(status_code=503, detail="Sovereign TOTP configuration is invalid.") from error
        if not pyotp.TOTP(secret).verify(request.code, valid_window=1):
            raise HTTPException(status_code=401, detail="The authenticator code is invalid.")
        timestamp = utc_now()
        connection.execute(
            """
            UPDATE sovereign_state SET sovereign_claimed = 1, claimed_at = ?,
                totp_verified_at = ? WHERE id = 1 AND sovereign_claimed = 0
            """,
            (timestamp, timestamp),
        )
        connection.commit()
    return {"sovereign_claimed": True, "claimed_at": timestamp}


@app.post("/api/admin/vip-passes")
async def manage_vip_pass(
    request: VipPassAction,
    identity: dict[str, str] = Depends(current_identity),
    authorization: str | None = Header(default=None),
):
    require_genesis_owner(identity)
    require_admin_session(authorization, identity)
    verify_sovereign_totp(request.totp_code)
    if len(VIP_CODE_PEPPER) < 32:
        raise HTTPException(status_code=503, detail="VIP pass hashing is not configured.")
    timestamp = utc_now()
    with closing(database()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        if request.action == "mint":
            total = connection.execute("SELECT COUNT(*) AS total FROM vip_passes").fetchone()["total"]
            if total >= 20:
                connection.rollback()
                raise HTTPException(status_code=409, detail="All 20 VIP passes are already allocated.")
            used_ids = {
                row["id"] for row in connection.execute("SELECT id FROM vip_passes").fetchall()
            }
            pass_id = next(
                f"VIP-{index:02d}" for index in range(1, 21) if f"VIP-{index:02d}" not in used_ids
            )
            code = secrets.token_urlsafe(18)
            connection.execute(
                """
                INSERT INTO vip_passes(id, code_hash, status, created_by, created_at, updated_at)
                VALUES (?, ?, 'active', ?, ?, ?)
                """,
                (pass_id, hash_vip_code(code, VIP_CODE_PEPPER), identity["sub"], timestamp, timestamp),
            )
        else:
            if not request.pass_id:
                connection.rollback()
                raise HTTPException(status_code=422, detail="A VIP pass ID is required for this action.")
            current = connection.execute(
                "SELECT id, status FROM vip_passes WHERE id = ?", (request.pass_id,)
            ).fetchone()
            if not current:
                connection.rollback()
                raise HTTPException(status_code=404, detail="VIP pass not found.")
            if request.action == "recycle":
                code = secrets.token_urlsafe(18)
                connection.execute(
                    """
                    UPDATE vip_passes SET code_hash = ?, status = 'active',
                        claimed_by = NULL, claimed_at = NULL, updated_at = ?
                    WHERE id = ?
                    """,
                    (hash_vip_code(code, VIP_CODE_PEPPER), timestamp, request.pass_id),
                )
            else:
                target_status = {
                    "pause": "paused",
                    "resume": "active",
                    "revoke": "revoked",
                }[request.action]
                connection.execute(
                    "UPDATE vip_passes SET status = ?, updated_at = ? WHERE id = ?",
                    (target_status, timestamp, request.pass_id),
                )
                code = ""
            pass_id = request.pass_id
        connection.commit()
    return {"id": pass_id, "action": request.action, "code": code, "updated_at": timestamp}


@app.post("/api/vip/claim")
async def claim_vip_pass(
    request: VipPassClaim,
    identity: dict[str, str] = Depends(current_identity),
):
    if len(VIP_CODE_PEPPER) < 32:
        raise HTTPException(status_code=503, detail="VIP pass hashing is not configured.")
    code_hash = hash_vip_code(request.code, VIP_CODE_PEPPER)
    timestamp = utc_now()
    with closing(database()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        passed = connection.execute(
            "SELECT id FROM vip_passes WHERE code_hash = ? AND status = 'active'",
            (code_hash,),
        ).fetchone()
        if not passed:
            connection.rollback()
            raise HTTPException(status_code=404, detail="VIP pass is invalid or unavailable.")
        connection.execute(
            """
            UPDATE vip_passes SET status = 'claimed', claimed_by = ?,
                claimed_at = ?, updated_at = ? WHERE id = ? AND status = 'active'
            """,
            (identity["sub"], timestamp, timestamp, passed["id"]),
        )
        if connection.execute("SELECT changes() AS changed").fetchone()["changed"] != 1:
            connection.rollback()
            raise HTTPException(status_code=409, detail="VIP pass was claimed concurrently.")
        connection.execute("UPDATE users SET is_vip = 1 WHERE user_sub = ?", (identity["sub"],))
        connection.commit()
    return {"claimed": True, "badge": "✦ VIP"}


@app.post("/api/telemetry")
async def record_telemetry(
    request: TelemetryEvent,
    identity: dict[str, str] = Depends(current_identity),
):
    if len(TELEMETRY_HMAC_KEY) < 32:
        raise HTTPException(status_code=503, detail="Identity-blind telemetry is not configured.")
    with closing(database()) as connection:
        enabled = connection.execute(
            "SELECT telemetry_enabled FROM users WHERE user_sub = ?", (identity["sub"],)
        ).fetchone()
        if not enabled or not enabled["telemetry_enabled"]:
            return {"recorded": False}
        try:
            key = telemetry_pseudonym(identity["sub"], TELEMETRY_HMAC_KEY)
        except ValueError as error:
            raise HTTPException(status_code=503, detail="Identity-blind telemetry is not configured.") from error
        day = datetime.now(timezone.utc).date().isoformat()
        connection.execute(
            """
            INSERT INTO anon_telemetry(day, pseudonym, session_minutes, prompt_count, last_seen_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(day, pseudonym) DO UPDATE SET
                session_minutes = MIN(1440, session_minutes + excluded.session_minutes),
                prompt_count = MIN(10000, prompt_count + excluded.prompt_count),
                last_seen_at = excluded.last_seen_at
            """,
            (day, key, request.session_minutes, request.prompt_count, utc_now()),
        )
        connection.commit()
    return {"recorded": True, "node": key}
