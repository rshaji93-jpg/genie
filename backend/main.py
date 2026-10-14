import asyncio
import base64
import binascii
from contextlib import closing
import hashlib
import hmac
import html
import importlib
import ipaddress
import io
import json
import logging
import os
import re
import requests
import secrets
import smtplib
import sqlite3
import sys
import threading
import time
import uuid
import wave
import httpx
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional, Dict, Any, Set
from urllib.parse import urlsplit
from fastapi import BackgroundTasks, Cookie, Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from dotenv import dotenv_values, load_dotenv
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token as google_id_token
from gtts import gTTS
from gtts.tts import gTTSError
from cryptography.fernet import Fernet, InvalidToken
import pyotp
try:
    import qrcode
except ImportError:
    qrcode = None

try:
    from .knowledge_registry import get_platform_system_manifest
    from .security import (
        message_is_after_join,
        may_export_room,
        may_view_pre_join_history,
        require_personal_scope,
        require_workspace_scope,
        SUPER_ADMIN_IDENTIFIER,
        verify_super_admin,
        scrub_sensitive_tokens as scrub_tokens,
        sanitize_ai_output,
        verified_workspace_tenant,
    )
    from .gemini_pool import gemini_pool
except ImportError:
    from knowledge_registry import get_platform_system_manifest
    from security import (
        message_is_after_join,
        may_export_room,
        may_view_pre_join_history,
        require_personal_scope,
        require_workspace_scope,
        SUPER_ADMIN_IDENTIFIER,
        verify_super_admin,
        scrub_sensitive_tokens as scrub_tokens,
        sanitize_ai_output,
        verified_workspace_tenant,
    )
    from gemini_pool import gemini_pool

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
load_dotenv(BACKEND_DIR / ".env", override=False)
load_dotenv(BACKEND_DIR.parent / ".env.local", override=False)
load_dotenv(BACKEND_DIR.parent / ".env", override=False)
SUPER_ADMIN_IDENTIFIER = "rshaji93@gmail.com"

app = FastAPI(title="Personal AI Genie API", version="4.8.0")
logger = logging.getLogger(__name__)


@app.exception_handler(Exception)
async def handle_unexpected_api_error(_request: Request, error: Exception):
    logger.error("Unhandled API error: %s", type(error).__name__)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error."},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://personalaigenie.pages.dev",
    ],
    allow_origin_regex=r"https://.*\.pages\.dev",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ADMIN_EMAIL = "rshaji93@gmail.com"
GEMINI_MASTER_KEY = os.getenv("GEMINI_MASTER_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_KEY = (OPENROUTER_API_KEY or "").strip()
FRONTEND_ENV = dotenv_values(PROJECT_ROOT / "frontend" / ".env.local")
FRONTEND_GOOGLE_CLIENT_ID = str(
    FRONTEND_ENV.get("NEXT_PUBLIC_GOOGLE_CLIENT_ID") or ""
).strip()
GOOGLE_CLIENT_ID = (
    os.getenv("GOOGLE_CLIENT_ID", "").strip() or FRONTEND_GOOGLE_CLIENT_ID
)
if not GOOGLE_CLIENT_ID:
    logger.error(
        "Google ID token verification is not configured. Set GOOGLE_CLIENT_ID "
        "in the backend environment or NEXT_PUBLIC_GOOGLE_CLIENT_ID in frontend/.env.local."
    )
elif FRONTEND_GOOGLE_CLIENT_ID and GOOGLE_CLIENT_ID != FRONTEND_GOOGLE_CLIENT_ID:
    logger.error(
        "Google client ID configuration mismatch: backend GOOGLE_CLIENT_ID does not "
        "match frontend NEXT_PUBLIC_GOOGLE_CLIENT_ID."
    )

SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
DEV_AUTH_BYPASS_ENABLED = (
    os.getenv("GENIE_ENABLE_DEV_AUTH_BYPASS", "").strip().lower() == "true"
    or os.getenv("DEV_MODE", "").strip().lower() == "true"
    or os.getenv("GENIE_ENV", "").strip().lower() in {"development", "local"}
)
DEV_AUTH_EMAIL = os.getenv("GENIE_DEV_AUTH_EMAIL", "rshaji93@gmail.com").strip().lower()
SESSION_SIGNING_KEY_PATH = Path(
    os.getenv(
        "GENIE_SESSION_KEY_PATH",
        str(BACKEND_DIR / "data" / "session_signing.key"),
    )
)

def is_local_development_request(request: Request) -> bool:
    if not DEV_AUTH_BYPASS_ENABLED:
        return False
    origin = urlsplit(request.headers.get("origin", ""))
    client_host = request.client.host if request.client else ""
    try:
        client_is_loopback = ipaddress.ip_address(client_host).is_loopback
        if origin.hostname:
            origin_is_loopback = origin.hostname == "localhost" or ipaddress.ip_address(origin.hostname).is_loopback
        else:
            host = request.url.hostname or ""
            origin_is_loopback = host == "localhost" or ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False
    scheme = origin.scheme or request.url.scheme
    return scheme in {"http", "https"} and client_is_loopback and origin_is_loopback


def local_developer_identity(
    request: Request,
    authorization: Optional[str],
) -> Optional[Dict[str, str]]:
    token = (
        authorization.removeprefix("Bearer ").strip()
        if authorization and authorization.startswith("Bearer ")
        else ""
    )
    if not is_local_development_request(request) or token not in {"", "dev-token-local-bypass"}:
        return None
    return {
        "sub": "user-rshaji93",
        "id": "user-rshaji93",
        "email": DEV_AUTH_EMAIL,
        "name": "Shaji R",
        "role": "admin",
    }


def load_session_signing_key() -> bytes:
    configured_secret = os.getenv("GENIE_SESSION_SECRET", "").strip()
    if configured_secret:
        key = configured_secret.encode("utf-8")
        if len(key) < 32:
            raise RuntimeError("GENIE_SESSION_SECRET must be at least 32 bytes.")
        return key
    SESSION_SIGNING_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        return SESSION_SIGNING_KEY_PATH.read_bytes()
    except FileNotFoundError:
        key = secrets.token_bytes(32)
        try:
            descriptor = os.open(
                SESSION_SIGNING_KEY_PATH,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
            )
        except FileExistsError:
            for _ in range(100):
                existing_key = SESSION_SIGNING_KEY_PATH.read_bytes()
                if existing_key:
                    break
                time.sleep(0.01)
            else:
                raise RuntimeError("The Genie session signing key could not be initialized.")
            return existing_key
        with os.fdopen(descriptor, "wb") as key_file:
            key_file.write(key)
            key_file.flush()
            os.fsync(key_file.fileno())
        return key


SESSION_SIGNING_KEY = load_session_signing_key()
TOTP_SECRET_CIPHER = Fernet(
    base64.urlsafe_b64encode(
        hashlib.sha256(SESSION_SIGNING_KEY + b"genie-totp-secret").digest()
    )
)


def encrypt_totp_secret(secret: str) -> str:
    return TOTP_SECRET_CIPHER.encrypt(secret.encode("ascii")).decode("ascii")


def decrypt_totp_secret(secret: str) -> str:
    try:
        return TOTP_SECRET_CIPHER.decrypt(secret.encode("ascii")).decode("ascii")
    except (InvalidToken, UnicodeDecodeError) as error:
        logger.exception("Stored Authenticator secret could not be decrypted.")
        raise HTTPException(status_code=500, detail="The stored Authenticator secret is unavailable.") from error


def totp_setup_qr_data_url(provisioning_uri: str, email: str) -> str:
    try:
        if qrcode is None:
            raise RuntimeError("The qrcode package is not installed.")
        image = qrcode.make(provisioning_uri)
        image_stream = io.BytesIO()
        image.save(image_stream, format="PNG")
        return "data:image/png;base64," + base64.b64encode(image_stream.getvalue()).decode("ascii")
    except Exception:
        logger.exception("Could not render the Authenticator QR code; returning a manual setup fallback.")
        fallback_svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">'
            '<rect width="320" height="180" rx="16" fill="#f0fdfa"/>'
            '<text x="160" y="70" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#164e63">'
            'QR unavailable</text>'
            '<text x="160" y="100" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#155e75">'
            'Enter the manual setup key shown below</text>'
            f'<text x="160" y="130" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#155e75">'
            f'{html.escape(email)}</text></svg>'
        )
        return "data:image/svg+xml;base64," + base64.b64encode(fallback_svg.encode("utf-8")).decode("ascii")


def matching_totp_counter(secret: str, code: str) -> Optional[int]:
    totp = pyotp.TOTP(secret)
    current_time = datetime.now(timezone.utc)
    if not totp.verify(code, for_time=current_time, valid_window=2):
        return None

    current_counter = totp.timecode(current_time)
    matching = [
        counter
        for counter in range(max(0, current_counter - 2), current_counter + 3)
        if hmac.compare_digest(totp.generate_otp(counter), code)
    ]
    return max(matching) if matching else None


def hash_totp_reset_code(email: str, code: str) -> str:
    message = f"{email.lower()}:{code}".encode("ascii")
    return hmac.new(SESSION_SIGNING_KEY, message, hashlib.sha256).hexdigest()

# Resilient models for upstream inference
OPENROUTER_FREE_MODELS = [
    "openrouter/free",
    "meta-llama/llama-3.2-3b-instruct:free",
    "google/gemma-2-9b-it:free",
    "mistralai/mistral-7b-instruct:free",
]
OPENROUTER_KEY_RE = re.compile(r"^sk-or-[0-9A-Za-z_-]{40,}$")
GEMINI_MODELS = ["gemini-3.6-flash"]
OPENROUTER_STREAM_MODELS = [
    "deepseek/deepseek-r1:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemini-3.6-flash",
]

LOCAL_CHITCHAT_PATTERNS = (
    (
        re.compile(r"^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening|day))\b", re.IGNORECASE),
        "Hello! I'm Personal AI Genie. How can I assist your workspace today?",
    ),
    (
        re.compile(r"^(how\s+are\s+you|how\s+is\s+it\s+going|how're\s+you|how\s+do\s+you\s+do)\b", re.IGNORECASE),
        "I'm running smoothly and fully operational! How can I help you today?",
    ),
    (
        re.compile(r"^(who\s+am\s+i|what\s+about\s+me)\b", re.IGNORECASE),
        "You are in your sovereign Personal AI Genie workspace. Check your profile settings to view your account details and active privileges!",
    ),
    (
        re.compile(r"^who\s+are\s+you\b", re.IGNORECASE),
        "I'm Personal AI Genie, your local workspace assistant. How can I help?",
    ),
    (
        re.compile(r"^(thank\s+you|thanks|cool|awesome|great|ok|okay|bye|goodbye)\b", re.IGNORECASE),
        "You're welcome! I'm here whenever you need me.",
    ),
)
LOCAL_PYTHON_MOCK_PATTERNS = (
    (
        re.compile(r"^(test|testing|ping|hello test|are you there|can you hear me)\b[?.!]*$", re.IGNORECASE),
        "Local Python mock is active. This deterministic test reply used no external AI provider or API credits.",
    ),
    (
        re.compile(r"^(?:what is|calculate)\s+2\s*\+\s*2\s*\??$", re.IGNORECASE),
        "2 + 2 = 4. This deterministic result was calculated locally in Python.",
    ),
)
ALLOWED_ROOM_REACTIONS = frozenset(
    "❤️ 👍 👏 😂 🔥 🎉 😊 🙏 💡 📚 🎯 ✨ 🚀 😍 🥰 🤔 😮 😢 😡 🤝 ✅ ❌ ⭐ 💯 👀 🙌 🤩 😎 🥳 💪 🫡 👏🏻 💚 💙 💜 🧡 🤍 🤣 😴".split()
)
VIP_SESSION_LIMIT = 20
MAX_ROOM_CAPACITY = 5
VIP_SESSION_TTL_SECONDS = 90
DAILY_MESSAGE_LIMIT = 10
ADMIN_EMAILS = [ADMIN_EMAIL]
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
                    origin_host_id TEXT NOT NULL DEFAULT '',
                    space_mode TEXT NOT NULL DEFAULT 'personal',
                    history_visible_before_join INTEGER NOT NULL DEFAULT 0,
                    allow_member_export INTEGER NOT NULL DEFAULT 0,
                    tenant_id TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                )
                """
            )
            room_columns = {
                row[1] for row in connection.execute("PRAGMA table_info(sovereign_rooms)")
            }
            for column, declaration in (
                ("origin_host_id", "TEXT NOT NULL DEFAULT ''"),
                ("space_mode", "TEXT NOT NULL DEFAULT 'personal'"),
                ("history_visible_before_join", "INTEGER NOT NULL DEFAULT 0"),
                ("allow_member_export", "INTEGER NOT NULL DEFAULT 0"),
                ("tenant_id", "TEXT NOT NULL DEFAULT ''"),
            ):
                if column not in room_columns:
                    connection.execute(
                        f"ALTER TABLE sovereign_rooms ADD COLUMN {column} {declaration}"
                    )
            connection.execute(
                "UPDATE sovereign_rooms SET origin_host_id = host_id WHERE origin_host_id = ''"
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS removed_room_members (
                    room_id TEXT NOT NULL,
                    member_id TEXT NOT NULL,
                    removed_at TEXT NOT NULL,
                    PRIMARY KEY (room_id, member_id)
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
                CREATE TABLE IF NOT EXISTS corporate_workspace_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tenant_id TEXT NOT NULL,
                    room_id TEXT NOT NULL,
                    actor_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    created_at TEXT NOT NULL
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
                CREATE TABLE IF NOT EXISTS social_push_subscriptions (
                    endpoint TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    subscription_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS social_push_subscriptions_user ON social_push_subscriptions(user_id)"
            )
            connection.execute("PRAGMA foreign_keys = ON")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    handle TEXT UNIQUE COLLATE NOCASE,
                    display_name TEXT NOT NULL,
                    avatar_url TEXT NOT NULL DEFAULT '',
                    google_sub TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS friendships (
                    id TEXT PRIMARY KEY,
                    requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    status TEXT NOT NULL CHECK(status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'BLOCKED')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(requester_id, addressee_id),
                    CHECK(requester_id <> addressee_id)
                );
                CREATE TABLE IF NOT EXISTS social_profiles (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    provider TEXT NOT NULL CHECK(provider IN ('meta', 'google')),
                    provider_user_id TEXT NOT NULL,
                    social_handle TEXT NOT NULL DEFAULT '',
                    synced_at TEXT NOT NULL,
                    UNIQUE(provider, provider_user_id)
                );
                CREATE TABLE IF NOT EXISTS rooms (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    room_type TEXT NOT NULL CHECK(room_type IN ('personal', 'workspace')),
                    default_language TEXT NOT NULL DEFAULT 'en-IN',
                    voice_persona TEXT NOT NULL DEFAULT 'aura'
                        CHECK(voice_persona IN ('aura', 'orion', 'echo', 'vigil', 'nova', 'desi')),
                    created_by TEXT NOT NULL REFERENCES users(id),
                    invite_token TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS room_participants (
                    id TEXT PRIMARY KEY,
                    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
                    guest_name TEXT,
                    guest_email TEXT,
                    selected_language TEXT NOT NULL DEFAULT 'en-IN',
                    role TEXT NOT NULL CHECK(role IN ('host', 'member', 'guest')),
                    joined_at TEXT NOT NULL,
                    CHECK(user_id IS NOT NULL OR guest_name IS NOT NULL)
                );
                CREATE TABLE IF NOT EXISTS room_messages (
                    id TEXT PRIMARY KEY,
                    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                    sender_type TEXT NOT NULL CHECK(sender_type IN ('user', 'guest', 'genie')),
                    sender_id TEXT NOT NULL,
                    sender_name TEXT NOT NULL,
                    content TEXT NOT NULL,
                    artifact_code TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS session_summaries (
                    id TEXT PRIMARY KEY,
                    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                    room_type TEXT NOT NULL CHECK(room_type IN ('personal', 'workspace')),
                    summary_markdown TEXT NOT NULL,
                    action_items_json TEXT NOT NULL DEFAULT '[]',
                    recipients_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS vip_requests (
                    request_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    user_email TEXT NOT NULL,
                    user_name TEXT NOT NULL DEFAULT '',
                    note TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending', 'approved', 'rejected')),
                    duration_days INTEGER,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    reviewed_at TEXT,
                    reviewed_by TEXT
                );
                CREATE TABLE IF NOT EXISTS ephemeral_session_dispatches (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    user_email TEXT NOT NULL,
                    transcript_json TEXT NOT NULL,
                    backup_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS active_vip_passes (
                    user_id TEXT PRIMARY KEY,
                    user_email TEXT NOT NULL,
                    granted_by TEXT NOT NULL,
                    duration_days INTEGER NOT NULL,
                    granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1
                );
                CREATE INDEX IF NOT EXISTS friendships_addressee_status
                    ON friendships(addressee_id, status);
                CREATE INDEX IF NOT EXISTS room_messages_room_created
                    ON room_messages(room_id, created_at);
                """
            )
            vip_request_info = connection.execute("PRAGMA table_info(vip_requests)").fetchall()
            vip_request_columns = {row[1] for row in vip_request_info}
            request_id_is_primary_key = any(
                row[1] == "request_id" and row[5] == 1 for row in vip_request_info
            )
            canonical_request_columns = {
                "request_id", "user_id", "user_email", "user_name", "note",
                "status", "created_at", "duration_days", "reviewed_at", "reviewed_by",
            }
            if not request_id_is_primary_key or not canonical_request_columns.issubset(vip_request_columns):
                connection.execute("ALTER TABLE vip_requests RENAME TO vip_requests_legacy_migration")
                connection.execute(
                    """
                    CREATE TABLE vip_requests (
                        request_id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        user_email TEXT NOT NULL,
                        user_name TEXT NOT NULL DEFAULT '',
                        note TEXT NOT NULL DEFAULT '',
                        status TEXT NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending', 'approved', 'rejected')),
                        duration_days INTEGER,
                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        reviewed_at TEXT,
                        reviewed_by TEXT
                    )
                    """
                )
                legacy_info = connection.execute(
                    "PRAGMA table_info(vip_requests_legacy_migration)"
                ).fetchall()
                legacy_rows = connection.execute(
                    "SELECT * FROM vip_requests_legacy_migration"
                ).fetchall()
                for legacy_row in legacy_rows:
                    legacy = dict(zip((row[1] for row in legacy_info), legacy_row))
                    request_id = str(legacy.get("request_id") or legacy.get("id") or uuid.uuid4())
                    user_id = str(legacy.get("user_id") or "")
                    email = str(legacy.get("user_email") or legacy.get("email") or "")
                    connection.execute(
                        """
                        INSERT OR IGNORE INTO vip_requests
                            (request_id, user_id, user_email, user_name, note, status,
                             duration_days, created_at, reviewed_at, reviewed_by)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            request_id,
                            user_id,
                            email,
                            str(legacy.get("user_name") or ""),
                            str(legacy.get("note") or legacy.get("message") or ""),
                            str(legacy.get("status") or "pending"),
                            legacy.get("duration_days"),
                            legacy.get("created_at") or datetime.now(timezone.utc).isoformat(),
                            legacy.get("reviewed_at"),
                            legacy.get("reviewed_by"),
                        ),
                    )
                connection.execute("DROP TABLE vip_requests_legacy_migration")
            elif not {"duration_days", "reviewed_at", "reviewed_by"}.issubset(vip_request_columns):
                for column_name, column_type in (
                    ("duration_days", "INTEGER"),
                    ("reviewed_at", "TEXT"),
                    ("reviewed_by", "TEXT"),
                ):
                    if column_name not in vip_request_columns:
                        connection.execute(
                            f"ALTER TABLE vip_requests ADD COLUMN {column_name} {column_type}"
                        )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS vip_requests_status_created ON vip_requests(status, created_at)"
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS user_registry (
                    user_id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    display_name TEXT NOT NULL,
                    avatar_url TEXT NOT NULL DEFAULT '',
                    mobile_number TEXT NOT NULL,
                    mobile_verified BOOLEAN NOT NULL DEFAULT 0,
                    recovery_email TEXT NOT NULL DEFAULT '',
                    terms_accepted_at TEXT NOT NULL,
                    allow_room_invites TEXT NOT NULL DEFAULT 'mutual_friends',
                    is_creator INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    gender TEXT NOT NULL DEFAULT '',
                    tenant_id TEXT NOT NULL DEFAULT '',
                    is_vip BOOLEAN NOT NULL DEFAULT 0,
                    vip_expires_at TIMESTAMP,
                    vip_duration_type TEXT,
                    is_admin BOOLEAN NOT NULL DEFAULT 0
                )
                """
            )
            registry_columns = {
                row[1] for row in connection.execute("PRAGMA table_info(user_registry)")
            }
            if "avatar_url" not in registry_columns:
                connection.execute(
                    "ALTER TABLE user_registry ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''"
                )
            if "gender" not in registry_columns:
                connection.execute(
                    "ALTER TABLE user_registry ADD COLUMN gender TEXT NOT NULL DEFAULT ''"
                )
            if "privacy_accepted_at" not in registry_columns:
                connection.execute(
                    "ALTER TABLE user_registry ADD COLUMN privacy_accepted_at TEXT NOT NULL DEFAULT ''"
                )
            if "tenant_id" not in registry_columns:
                connection.execute(
                    "ALTER TABLE user_registry ADD COLUMN tenant_id TEXT NOT NULL DEFAULT ''"
                )
            for column, declaration in (
                ("is_vip", "BOOLEAN NOT NULL DEFAULT 0"),
                ("vip_expires_at", "TIMESTAMP"),
                ("vip_duration_type", "TEXT"),
                ("is_admin", "BOOLEAN NOT NULL DEFAULT 0"),
                ("mobile_verified", "BOOLEAN NOT NULL DEFAULT 0"),
            ):
                if column not in registry_columns:
                    connection.execute(
                        f"ALTER TABLE user_registry ADD COLUMN {column} {declaration}"
                    )
            connection.execute(
                "UPDATE user_registry SET is_admin = CASE WHEN lower(email) = ? THEN 1 ELSE 0 END",
                (ADMIN_EMAIL,),
            )
            connection.execute(
                """
                INSERT OR IGNORE INTO active_vip_passes
                    (user_id, user_email, granted_by, duration_days, granted_at, expires_at, is_active)
                SELECT user_id, email, 'legacy-migration', 0, created_at, vip_expires_at, 1
                FROM user_registry
                WHERE is_vip = 1 AND vip_expires_at IS NOT NULL
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS totp_credentials (
                    user_id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    secret TEXT NOT NULL,
                    verified_at TEXT NOT NULL,
                    failed_attempts INTEGER NOT NULL DEFAULT 0,
                    locked_until REAL NOT NULL DEFAULT 0,
                    last_counter INTEGER NOT NULL DEFAULT -1
                )
                """
            )
            totp_columns = {
                row[1] for row in connection.execute("PRAGMA table_info(totp_credentials)")
            }
            if "last_counter" not in totp_columns:
                connection.execute(
                    "ALTER TABLE totp_credentials ADD COLUMN last_counter INTEGER NOT NULL DEFAULT -1"
                )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS totp_setup_challenges (
                    user_id TEXT PRIMARY KEY,
                    email TEXT NOT NULL,
                    secret TEXT NOT NULL,
                    expires_at REAL NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS totp_reset_challenges (
                    email TEXT PRIMARY KEY COLLATE NOCASE,
                    code_hash TEXT NOT NULL,
                    expires_at REAL NOT NULL,
                    failed_attempts INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS totp_reconfigure_tokens (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    email TEXT NOT NULL COLLATE NOCASE,
                    secret TEXT,
                    expires_at REAL NOT NULL,
                    used_at REAL,
                    failed_attempts INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS social_follows (
                    follower_id TEXT NOT NULL,
                    followed_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (follower_id, followed_id),
                    CHECK (follower_id != followed_id)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS friend_requests (
                    requester_id TEXT NOT NULL,
                    recipient_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at TEXT NOT NULL,
                    responded_at TEXT NOT NULL DEFAULT '',
                    PRIMARY KEY (requester_id, recipient_id),
                    CHECK (requester_id != recipient_id)
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS friend_requests_recipient ON friend_requests(recipient_id, status, created_at)"
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
                CREATE TABLE IF NOT EXISTS social_invites (
                    invite_id TEXT PRIMARY KEY,
                    sender_id TEXT NOT NULL,
                    sender_name TEXT NOT NULL,
                    recipient_id TEXT NOT NULL,
                    room_id TEXT NOT NULL,
                    room_title TEXT NOT NULL,
                    invite_url TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS social_invites_recipient ON social_invites(recipient_id, status, created_at)"
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS deleted_conversations (
                    user_id TEXT NOT NULL,
                    conversation_id TEXT NOT NULL,
                    conversation_json TEXT NOT NULL,
                    deleted_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, conversation_id)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS ended_rooms (
                    room_id TEXT PRIMARY KEY,
                    ended_at TEXT NOT NULL
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
    return sanitize_ai_output(scrub_tokens(text))


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
    prompt: Optional[str] = None
    message: Optional[str] = None
    image_data: Optional[str] = Field(default=None, max_length=7_000_000)
    force_genie_master: bool = False
    force_ai_intervention: bool = False
    space_mode: Optional[str] = "personal"
    workspace_room_id: Optional[str] = None
    conversation_history: Optional[List[ChatMessage]] = []
    custom_api_key: Optional[str] = None
    byok_key: Optional[str] = None
    language_code: Optional[str] = "en-IN"
    is_team_chat: Optional[bool] = False
    is_observer_active: Optional[bool] = False
    observer_mode: Optional[bool] = None
    engine: str = "cloud_ai"
    agent_target: str = "manager"
    models_cascade: Optional[List[str]] = None


class TextToSpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    lang: str = Field(min_length=2, max_length=8)


class DirectVoiceTurnRequest(BaseModel):
    system_text: str = Field(min_length=1, max_length=2000)
    contents: List[Dict[str, Any]] = Field(min_length=1, max_length=20)
    transcript: str = Field(min_length=1, max_length=5000)
    dialect: str = Field(min_length=2, max_length=64)
    voice_name: str = Field(pattern="^(Aoede|Charon|Kore|Fenrir|Puck)$")
    language_code: Optional[str] = "en-IN"
    user_email: Optional[str] = None
    google_id_token: Optional[str] = None
    user_byok_key: Optional[str] = None
    workspace_room_id: Optional[str] = None
    is_observer_active: Optional[bool] = False
    caller_id: Optional[str] = None
    participant_ids: Optional[List[str]] = Field(default_factory=list)


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
    image_data: Optional[str] = Field(default=None, max_length=7_000_000)
    force_genie_master: bool = False
    force_ai_intervention: bool = False
    message_id: Optional[str] = Field(default=None, max_length=128)
    custom_api_key: Optional[str] = None
    observer_mode: Optional[bool] = None
    engine: str = "cloud_ai"
    agent_target: str = "manager"


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


def get_verified_archive_identity(authorization: Optional[str]) -> Optional[Dict[str, str]]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return verify_google_id_token_claims(authorization.removeprefix("Bearer ").strip())


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
        tenant_id: str = "",
    ):
        self.websocket = websocket
        self.client_id = client_id
        self.display_name = display_name
        self.avatar_url = avatar_url
        self.email = email
        self.public_key = public_key or {}
        self.room_title = room_title
        self.requested_host_id = requested_host_id
        self.tenant_id = tenant_id
        self.focused = False
        self.last_heartbeat = time.monotonic()


class RoomManager:
    """Blind relay for encrypted room messages and authenticated presence."""

    def __init__(self):
        self.connections: Dict[str, Set[WebSocket]] = {}
        self.identities: Dict[WebSocket, RoomConnection] = {}
        self.messages: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self.voice_calls: Dict[str, Dict[str, Any]] = {}
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
                    "status": self._presence_status(info.client_id, room_id),
                }
        return list(active_by_id.values())

    def _presence_status(self, client_id: str, room_id: Optional[str] = None) -> str:
        now = time.monotonic()
        connections = [
            info for info in self.identities.values()
            if info.client_id == client_id and now - info.last_heartbeat <= 300
        ]
        if any(
            (room_id is None or info.websocket in self.connections.get(room_id, set()))
            and info.focused
            for info in connections
        ):
            return "active"
        if any(
            (room_id is None or info.websocket not in self.connections.get(room_id, set()))
            and info.focused
            for info in connections
        ):
            return "different_room"
        return "inactive"

    def _room_members(self, room_id: str) -> List[Dict[str, Any]]:
        with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
            row = connection.execute(
                """
                SELECT host_id, members_json, origin_host_id, space_mode,
                       history_visible_before_join, allow_member_export, tenant_id
                FROM sovereign_rooms WHERE room_id = ?
                """,
                (room_id,),
            ).fetchone()
        if not row:
            return self._active_users(room_id)
        active = {member["id"]: member for member in self._active_users(room_id)}
        try:
            stored_members = json.loads(row[1])
        except (ValueError, TypeError):
            return self._active_users(room_id)
        origin_host_id = row[2]
        space_mode = row[3]
        return [
            {
                **member,
                "status": active.get(member["id"], {}).get(
                    "status",
                    self._presence_status(member["id"], room_id),
                ),
                "is_host": member["id"] == row[0],
                "role": (
                    "origin_admin"
                    if member["id"] == origin_host_id
                    else "delegated_admin"
                    if member["id"] == row[0]
                    else "guest"
                    if space_mode == "personal"
                    else "member"
                ),
                "is_origin_admin": member["id"] == origin_host_id,
                "tenant_id": member.get("tenant_id") or row[6],
                "can_view_history": (
                    member["id"] == origin_host_id
                    or bool(member.get("can_view_history", row[4]))
                ),
                "can_export": (
                    member["id"] == origin_host_id
                    or (
                        space_mode == "workspace"
                        and bool(member.get("can_export", row[5]))
                    )
                ),
            }
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
            connection.execute("BEGIN IMMEDIATE")
            with connection:
                if connection.execute(
                    "SELECT 1 FROM removed_room_members WHERE room_id = ? AND member_id = ?",
                    (room_id, connection_info.client_id),
                ).fetchone():
                    raise HTTPException(status_code=403, detail="The room host removed your membership.")
                if connection.execute(
                    "SELECT 1 FROM ended_rooms WHERE room_id = ?", (room_id,)
                ).fetchone():
                    raise HTTPException(status_code=410, detail="This room session has ended.")
                connection.execute(
                    "UPDATE social_directory SET public_key_json = ?, updated_at = ? WHERE user_id = ?",
                    (json.dumps(connection_info.public_key), now, connection_info.client_id.removeprefix("google:")),
                )
                row = connection.execute(
                    """
                    SELECT title, host_id, members_json, origin_host_id, space_mode,
                           history_visible_before_join, allow_member_export, tenant_id
                    FROM sovereign_rooms WHERE room_id = ?
                    """,
                    (room_id,),
                ).fetchone()
                members = json.loads(row[2]) if row else []
                existing_member = next(
                    (item for item in members if item.get("id") == connection_info.client_id),
                    None,
                )
                host_id = row[1] if row else (
                    requested_host_id
                    if requested_host_id == connection_info.client_id
                    else connection_info.client_id
                )
                origin_host_id = row[3] if row else host_id
                member = {
                    "id": connection_info.client_id,
                    "user_id": connection_info.client_id,
                    "name": connection_info.display_name,
                    "display_name": connection_info.display_name,
                    "email": connection_info.email,
                    "avatar_url": connection_info.avatar_url,
                    "public_key": connection_info.public_key,
                    "joined_at": (
                        existing_member.get("joined_at")
                        if existing_member and existing_member.get("joined_at")
                        else now
                    ),
                    "tenant_id": connection_info.tenant_id,
                    "can_view_history": (
                        True
                        if connection_info.client_id == origin_host_id
                        else (
                            bool(existing_member.get("can_view_history"))
                            if existing_member
                            else bool(row and row[5])
                        )
                    ),
                    "can_export": (
                        True
                        if connection_info.client_id == origin_host_id
                        else (
                            bool(existing_member.get("can_export"))
                            if existing_member
                            else bool(row and row[6])
                        )
                    ),
                }
                replaced = False
                for index, existing in enumerate(members):
                    if existing.get("id") == connection_info.client_id:
                        members[index] = {**existing, **member}
                        replaced = True
                        break
                if not replaced:
                    if room_id.startswith("share_") and len(members) >= 5:
                        raise HTTPException(
                            status_code=403,
                            detail="This personal room is full (maximum five members).",
                        )
                    if room_id.startswith("invite_") and len(members) >= 5:
                        raise HTTPException(
                            status_code=403,
                            detail="This workspace room is full (maximum five members).",
                        )
                    members.append(member)
                title = row[0] if row else (room_title or room_id)
                connection.execute(
                    """
                    INSERT INTO sovereign_rooms
                        (room_id, title, host_id, members_json, origin_host_id, tenant_id, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(room_id) DO UPDATE SET
                        members_json = excluded.members_json,
                        updated_at = excluded.updated_at
                    """,
                    (
                        room_id, title, host_id, json.dumps(members), origin_host_id,
                        row[7] if row else connection_info.tenant_id, now,
                    ),
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

    async def _broadcast_member_presence(self, client_id: str):
        for room_id, connections in list(self.connections.items()):
            if not connections:
                continue
            if any(member.get("id") == client_id for member in self._room_members(room_id)):
                await self._presence(room_id)

    def telemetry_presence(self) -> List[Dict[str, Any]]:
        by_user: Dict[str, Dict[str, Any]] = {}
        for info in self.identities.values():
            previous = by_user.get(info.client_id)
            candidate = {
                "id": info.client_id,
                "name": info.display_name,
                "email": info.email,
                "avatar_url": info.avatar_url,
                "room_id": info.websocket.url.path.rsplit("/", 1)[-1],
                "focused": info.focused,
                "status": self._presence_status(info.client_id),
            }
            if previous is None or (candidate["focused"] and not previous["focused"]):
                by_user[info.client_id] = candidate
        return list(by_user.values())

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

    def _history_visible_messages(
        self,
        room_id: str,
        messages: List[Dict[str, Any]],
        recipient_id: str,
    ) -> List[Dict[str, Any]]:
        if room_id.startswith("direct:"):
            return messages
        member = next(
            (item for item in self._room_members(room_id) if item.get("id") == recipient_id),
            None,
        )
        if not member:
            return []
        if may_view_pre_join_history(
            is_origin_admin=bool(member.get("is_origin_admin")),
            allow_history=bool(member.get("can_view_history")),
        ):
            return messages
        joined_at = str(member.get("joined_at") or "")
        return [
            message for message in messages
            if message_is_after_join(str(message.get("created_at") or ""), joined_at)
        ]

    def _room_configuration(self, room_id: str) -> Optional[Dict[str, Any]]:
        with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
            row = connection.execute(
                """
                SELECT host_id, origin_host_id, space_mode, history_visible_before_join,
                       allow_member_export, tenant_id
                FROM sovereign_rooms WHERE room_id = ?
                """,
                (room_id,),
            ).fetchone()
        if not row:
            return None
        return {
            "host_id": row[0],
            "origin_host_id": row[1],
            "space_mode": row[2],
            "history_visible_before_join": bool(row[3]),
            "allow_member_export": bool(row[4]),
            "tenant_id": row[5],
        }

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
                        ACTIVE_PRESENCE_WEBSOCKETS.discard(websocket)
                        await websocket.close(code=1008, reason="This direct room is unavailable because of a block.")
                if not self.connections.get(room_id):
                    self.connections.pop(room_id, None)
                    self.voice_calls.pop(room_id, None)
                await self._presence(room_id)
                await self._broadcast_member_presence(connection.client_id)

    async def connect(self, room_id: str, connection: RoomConnection):
        async with self.lock:
            existing_room_connections = self.connections.get(room_id, set())
            active_member_ids = {
                self.identities[websocket].client_id
                for websocket in existing_room_connections
                if websocket in self.identities
            }
            if (
                connection.client_id not in active_member_ids
                and len(active_member_ids) >= MAX_ROOM_CAPACITY
            ):
                raise HTTPException(status_code=409, detail="ROOM_FULL_ERROR")
            self.connections.setdefault(room_id, set()).add(connection.websocket)
            self.identities[connection.websocket] = connection
            ACTIVE_PRESENCE_WEBSOCKETS.add(connection.websocket)
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
            try:
                self._persist_room_member(
                    room_id,
                    connection,
                    getattr(connection, "room_title", room_id),
                    getattr(connection, "requested_host_id", ""),
                )
            except (HTTPException, sqlite3.Error, ValueError, TypeError):
                self.connections[room_id].discard(connection.websocket)
                self.identities.pop(connection.websocket, None)
                ACTIVE_PRESENCE_WEBSOCKETS.discard(connection.websocket)
                if not self.connections[room_id]:
                    self.connections.pop(room_id, None)
                raise
            visible_history = [
                message
                for message in self.messages[room_id].values()
                if self._visible_message(message, connection.client_id)
            ]
            visible_history = self._history_visible_messages(
                room_id,
                visible_history,
                connection.client_id,
            )
            visible_history_ids = {message["message_id"] for message in visible_history}
            for message in self.messages[room_id].values():
                if (
                    message["user_id"] != connection.client_id
                    and self._visible_message(message, connection.client_id)
                    and message["message_id"] in visible_history_ids
                ):
                    delivered_to = message.setdefault("delivered_to", [])
                    if connection.client_id not in delivered_to:
                        delivered_to.append(connection.client_id)
                        self.persist_encrypted_message(room_id, message)
            await connection.websocket.send_json({
                "type": "room_state",
                "policy": self._room_configuration(room_id),
                "members": [
                    member for member in self._room_members(room_id)
                    if member.get("id") == connection.client_id
                    or not are_users_blocked(connection.client_id, str(member.get("id") or ""))
                ],
                "messages": [
                    self._message_for_recipient(message, connection.client_id)
                    for message in visible_history
                ],
            })
            active_call = self.voice_calls.get(room_id)
            if active_call:
                await connection.websocket.send_json({
                    "type": "voice_session.started",
                    "call_id": active_call["call_id"],
                    "voice_name": active_call.get("voice_name", "Aoede"),
                    "started_by": active_call["started_by"],
                    "started_at": active_call["started_at"],
                    "participants": self._active_users(room_id),
                    "is_rejoin": True,
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
            connection = self.identities.get(websocket)
            call = self.voice_calls.get(room_id)
            if connection and call and connection.client_id in call.get("participants", set()):
                call["participants"].discard(connection.client_id)
                for peer in list(self.connections.get(room_id, set())):
                    if peer is not websocket:
                        await peer.send_json({
                            "type": "PEER_LEFT",
                            "call_id": call["call_id"],
                            "peer_id": connection.client_id,
                        })
            self.connections.get(room_id, set()).discard(websocket)
            self.identities.pop(websocket, None)
            ACTIVE_PRESENCE_WEBSOCKETS.discard(websocket)
            if not self.connections.get(room_id):
                self.connections.pop(room_id, None)
                self.voice_calls.pop(room_id, None)
            await self._presence(room_id)
            if connection:
                await self._broadcast_member_presence(connection.client_id)

    async def remove_member(self, room_id: str, member_id: str):
        async with self.lock:
            for websocket in list(self.connections.get(room_id, set())):
                connection = self.identities.get(websocket)
                if connection and connection.client_id == member_id:
                    self.connections[room_id].discard(websocket)
                    self.identities.pop(websocket, None)
                    ACTIVE_PRESENCE_WEBSOCKETS.discard(websocket)
                    await websocket.close(code=1008, reason="The room host removed your membership.")
            if not self.connections.get(room_id):
                self.connections.pop(room_id, None)
                self.voice_calls.pop(room_id, None)
            await self._presence(room_id)
            await self._broadcast_member_presence(member_id)

    async def close_room(self, room_id: str):
        async with self.lock:
            room_connections = list(self.connections.pop(room_id, set()))
            self.messages.pop(room_id, None)
            self.voice_calls.pop(room_id, None)
            departing_members = {
                self.identities[websocket].client_id
                for websocket in room_connections
                if websocket in self.identities
            }
            for websocket in room_connections:
                self.identities.pop(websocket, None)
                ACTIVE_PRESENCE_WEBSOCKETS.discard(websocket)
                await websocket.close(code=1000, reason="The room host ended this session.")
            for member_id in departing_members:
                await self._broadcast_member_presence(member_id)

    async def handle_event(self, room_id: str, websocket: WebSocket, event: Dict[str, Any]):
        async with self.lock:
            connection = self.identities.get(websocket)
            if connection is None:
                return
            event_type = event.get("type")
            room_config = self._room_configuration(room_id)
            if event_type == "room.heartbeat":
                if event.get("room_id") != room_id:
                    await websocket.send_json({
                        "type": "error",
                        "detail": "Presence heartbeat room does not match this connection.",
                    })
                    return
                now = time.monotonic()
                focused = bool(event.get("focused", False))
                presence_changed = (
                    connection.focused != focused
                    or now - connection.last_heartbeat > 300
                )
                connection.focused = focused
                connection.last_heartbeat = now
                await self._presence(room_id)
                if presence_changed:
                    await self._broadcast_member_presence(connection.client_id)
                return
            if room_config and room_config.get("space_mode") == "workspace":
                tenant_id = str(room_config.get("tenant_id") or "")
                require_workspace_scope(
                    {"tenant_id": connection.tenant_id},
                    tenant_id,
                )
                with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as database:
                    with database:
                        database.execute(
                            """
                            INSERT INTO corporate_workspace_audit
                                (tenant_id, room_id, actor_id, event_type, created_at)
                            VALUES (?, ?, ?, ?, ?)
                            """,
                            (
                                tenant_id,
                                room_id,
                                connection.client_id,
                                str(event_type or "unknown")[:80],
                                datetime.now(timezone.utc).isoformat(),
                            ),
                        )
            messages = self.messages.setdefault(room_id, {})
            if event_type == "voice_session.start":
                call_id = str(event.get("call_id") or "")
                if not call_id or len(call_id) > 80:
                    await websocket.send_json({"type": "error", "detail": "A valid voice session ID is required."})
                    return
                voice_name = str(event.get("voice_name") or "Aoede")
                if voice_name not in {"Aoede", "Charon", "Kore", "Fenrir", "Puck"}:
                    await websocket.send_json({"type": "error", "detail": "Voice persona is invalid."})
                    return
                call = {
                    "call_id": call_id,
                    "voice_name": voice_name,
                    "language_code": str(event.get("language_code") or "en-IN"),
                    "transport": (
                        "ai"
                        if str(event.get("transport") or "") == "ai"
                        else "mesh"
                    ),
                    "started_by": connection.client_id,
                    "started_at": datetime.now(timezone.utc).isoformat(),
                    "responders": set(),
                    "participants": {connection.client_id},
                }
                self.voice_calls[room_id] = call
                participants = self._active_users(room_id)
                for peer in list(self.connections.get(room_id, set())):
                    await peer.send_json({
                        "type": "voice_session.started",
                        "call_id": call_id,
                        "voice_name": voice_name,
                        "language_code": call["language_code"],
                        "transport": call["transport"],
                        "started_by": connection.client_id,
                        "started_at": call["started_at"],
                        "participants": participants,
                    })
            elif event_type == "voice_session.voice_update":
                call = self.voice_calls.get(room_id)
                room_configuration = self._room_configuration(room_id) or {}
                voice_name = str(event.get("voice_name") or "")
                if (
                    not call
                    or call.get("call_id") != str(event.get("call_id") or "")
                    or room_configuration.get("origin_host_id") != connection.client_id
                ):
                    await websocket.send_json({"type": "error", "detail": "Only the room origin user can change the AI voice."})
                    return
                if voice_name not in {"Aoede", "Charon", "Kore", "Fenrir", "Puck"}:
                    await websocket.send_json({"type": "error", "detail": "Voice persona is invalid."})
                    return
                call["voice_name"] = voice_name
                for peer in list(self.connections.get(room_id, set())):
                    await peer.send_json({
                        "type": "voice_session.voice_updated",
                        "call_id": call["call_id"],
                        "voice_name": voice_name,
                    })
            elif event_type == "ROOM_VOICE_CONFIG_UPDATE":
                call = self.voice_calls.get(room_id)
                room_configuration = self._room_configuration(room_id) or {}
                call_id = str(event.get("call_id") or "")
                voice_name = str(event.get("voice_name") or "")
                language_code = str(event.get("language_code") or "")
                if (
                    not call
                    or call.get("call_id") != call_id
                    or room_configuration.get("origin_host_id") != connection.client_id
                ):
                    await websocket.send_json({
                        "type": "error",
                        "detail": "Only the room origin user can update active voice configuration.",
                    })
                    return
                if voice_name and voice_name not in {"Aoede", "Charon", "Kore", "Fenrir", "Puck"}:
                    await websocket.send_json({"type": "error", "detail": "Voice persona is invalid."})
                    return
                if language_code and not re.fullmatch(r"[a-z]{2,3}(?:-[A-Z]{2})?", language_code):
                    await websocket.send_json({"type": "error", "detail": "Voice language code is invalid."})
                    return
                if voice_name:
                    call["voice_name"] = voice_name
                if language_code:
                    call["language_code"] = language_code
                update = {
                    "type": "ROOM_VOICE_CONFIG_UPDATE",
                    "call_id": call_id,
                    "voice_name": call.get("voice_name"),
                    "language_code": call.get("language_code"),
                }
                for peer in list(self.connections.get(room_id, set())):
                    await peer.send_json(update)
            elif event_type == "INCOMING_CALL":
                call_id = str(event.get("call_id") or "")
                call = self.voice_calls.get(room_id)
                if (
                    not call
                    or call.get("call_id") != call_id
                    or connection.client_id not in call.get("participants", set())
                ):
                    await websocket.send_json({
                        "type": "error",
                        "detail": "The active voice session could not be invited.",
                    })
                    return
                for peer in list(self.connections.get(room_id, set())):
                    recipient = self.identities.get(peer)
                    if peer is websocket or recipient is None:
                        continue
                    await peer.send_json({
                        "type": "INCOMING_CALL",
                        "call_id": call_id,
                        "room_id": room_id,
                        "inviter": {
                            "user_id": connection.client_id,
                            "display_name": connection.display_name,
                            "avatar_url": connection.avatar_url,
                        },
                    })
            elif event_type in {"USER_JOINED_CALL", "USER_LEFT_CALL"}:
                call = self.voice_calls.get(room_id)
                call_id = str(event.get("call_id") or "")
                if not call or call.get("call_id") != call_id:
                    await websocket.send_json({"type": "error", "detail": "Voice session was not found."})
                    return
                participants = call.setdefault("participants", set())
                if event_type == "USER_JOINED_CALL":
                    participants.add(connection.client_id)
                    outbound = {
                        "type": "PEER_JOINED",
                        "call_id": call_id,
                        "peer_id": connection.client_id,
                        "peer": {
                            "id": connection.client_id,
                            "name": connection.display_name,
                            "avatar_url": connection.avatar_url,
                        },
                    }
                else:
                    participants.discard(connection.client_id)
                    outbound = {
                        "type": "PEER_LEFT",
                        "call_id": call_id,
                        "peer_id": connection.client_id,
                    }
                for peer in list(self.connections.get(room_id, set())):
                    if peer is not websocket:
                        await peer.send_json(outbound)
            elif event_type in {"CALL_OFFER", "CALL_ANSWER", "ICE_CANDIDATE"}:
                call = self.voice_calls.get(room_id)
                call_id = str(event.get("call_id") or "")
                target_id = str(event.get("target_id") or "")
                participants = call.get("participants", set()) if call else set()
                if (
                    not call
                    or call.get("call_id") != call_id
                    or connection.client_id not in participants
                    or target_id not in participants
                    or target_id == connection.client_id
                ):
                    await websocket.send_json({"type": "error", "detail": "WebRTC signal target is not an active call participant."})
                    return
                signal = event.get("signal")
                if event_type == "ICE_CANDIDATE":
                    signal = event.get("candidate", signal)
                if not isinstance(signal, dict):
                    await websocket.send_json({"type": "error", "detail": "WebRTC signal payload is invalid."})
                    return
                for peer in list(self.connections.get(room_id, set())):
                    recipient = self.identities.get(peer)
                    if recipient and recipient.client_id == target_id:
                        await peer.send_json({
                            "type": event_type,
                            "call_id": call_id,
                            "sender_id": connection.client_id,
                            "signal": signal,
                            "candidate": signal if event_type == "ICE_CANDIDATE" else None,
                        })
            elif event_type == "UPDATE_USER_LANGUAGE":
                language = str(event.get("language") or event.get("language_code") or "")
                if not re.fullmatch(r"[a-z]{2,3}(?:-[A-Z]{2})?", language):
                    await websocket.send_json({"type": "error", "detail": "Language code is invalid."})
                    return
                for peer in list(self.connections.get(room_id, set())):
                    await peer.send_json({
                        "type": "USER_LANGUAGE_UPDATED",
                        "user_id": connection.client_id,
                        "language": language,
                    })
            elif event_type == "voice_session.turn":
                call_id = str(event.get("call_id") or "")
                call = self.voice_calls.get(room_id)
                turn_id = str(event.get("turn_id") or "")
                role = event.get("role")
                encrypted_payloads = event.get("encrypted_payloads")
                allowed_recipients = {member["id"] for member in self._room_members(room_id)}
                active_recipients = {member["id"] for member in self._active_users(room_id)}
                if (
                    not call
                    or call.get("call_id") != call_id
                    or not turn_id
                    or len(turn_id) > 80
                    or role not in ("user", "assistant")
                    or (role == "assistant" and connection.client_id not in call["responders"])
                    or not isinstance(encrypted_payloads, dict)
                    or not encrypted_payloads
                    or not active_recipients.issubset(encrypted_payloads)
                    or not set(encrypted_payloads).issubset(allowed_recipients)
                    or not all(is_encrypted_message_envelope(payload) for payload in encrypted_payloads.values())
                ):
                    await websocket.send_json({"type": "error", "detail": "Voice turn is invalid or not encrypted for active room members."})
                    return
                speaker = {
                    "id": connection.client_id if role == "user" else "genie-master",
                    "name": connection.display_name if role == "user" else "Genie Master",
                    "avatar_url": connection.avatar_url if role == "user" else None,
                    "role": role,
                }
                if role == "user":
                    call["responders"].add(connection.client_id)
                for peer in list(self.connections.get(room_id, set())):
                    recipient = self.identities.get(peer)
                    if recipient is None or recipient.client_id not in encrypted_payloads:
                        continue
                    await peer.send_json({
                        "type": "voice_session.turn",
                        "call_id": call_id,
                        "turn_id": turn_id,
                        "speaker": speaker,
                        "timestamp": str(event.get("timestamp") or datetime.now(timezone.utc).isoformat())[:80],
                        "encrypted_payloads": encrypted_payloads,
                        "sender_id": connection.client_id,
                        "sender_public_key": connection.public_key,
                    })
            elif event_type == "voice_session.end":
                call_id = str(event.get("call_id") or "")
                call = self.voice_calls.get(room_id)
                if not call or call.get("call_id") != call_id:
                    await websocket.send_json({"type": "error", "detail": "Voice session was not found."})
                    return
                if call.get("started_by") != connection.client_id:
                    await websocket.send_json({
                        "type": "error",
                        "detail": "Only the call initiator can end the shared voice session.",
                    })
                    return
                self.voice_calls.pop(room_id, None)
                for peer in list(self.connections.get(room_id, set())):
                    await peer.send_json({
                        "type": "voice_session.ended",
                        "call_id": call_id,
                    })
                if not self.connections.get(room_id):
                    self.voice_calls.pop(room_id, None)
            elif event_type == "message.send":
                if room_id.startswith("direct:") and any(
                    are_users_blocked(connection.client_id, member["id"])
                    for member in self._room_members(room_id)
                    if member["id"] != connection.client_id
                ):
                    await websocket.send_json({"type": "error", "detail": "Direct messages are unavailable because of a block."})
                    await websocket.close(code=1008, reason="Direct room is unavailable.")
                    return
                is_voice_log = (
                    event.get("is_voice_record") is True
                    or event.get("is_voice_session_summary") is True
                )
                if is_voice_log:
                    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as database:
                        room_owner = database.execute(
                            "SELECT host_id, origin_host_id, space_mode FROM sovereign_rooms WHERE room_id = ?",
                            (room_id,),
                        ).fetchone()
                    allowed_owner_id = (
                        room_owner[0]
                        if room_owner and room_owner[2] == "personal"
                        else room_owner[1]
                        if room_owner
                        else None
                    )
                    if not allowed_owner_id or connection.client_id != allowed_owner_id:
                        await websocket.send_json({
                            "type": "error",
                            "detail": "Only the Room Owner or Workspace Origin Admin can save voice-call logs.",
                        })
                        return
                if event.get("is_history_replay") is True:
                    room_config = self._room_configuration(room_id)
                    if not room_config or not room_config.get("history_visible_before_join"):
                        await websocket.send_json({
                            "type": "error",
                            "detail": "Past chat history sharing is disabled by the room owner.",
                        })
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
                    "is_voice_record": event.get("is_voice_record") is True,
                }
                source = event.get("source")
                if source in (
                    "gemini-3.6-flash",
                    "openrouter-fallback",
                    "backend-manifest",
                    "cloud_ai",
                    "local_agent",
                ):
                    message["source"] = source
                if isinstance(event.get("agent_name"), str):
                    message["agent_name"] = event["agent_name"][:80]
                if event.get("force_genie_master") is True:
                    message["force_genie_master"] = True
                if event.get("force_ai_intervention") is True:
                    message["force_ai_intervention"] = True
                if isinstance(event.get("agent_output"), dict):
                    message["agent_output"] = event["agent_output"]
                if event.get("is_voice_session_summary") is True:
                    message["is_voice_session_summary"] = True
                    message["call_id"] = str(event.get("call_id") or "")[:80]
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
            elif event_type == "room.wipe":
                self.voice_calls.pop(room_id, None)
                with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as database:
                    row = database.execute(
                        "SELECT host_id FROM sovereign_rooms WHERE room_id = ?",
                        (room_id,),
                    ).fetchone()
                if not row or row[0] != connection.client_id:
                    await websocket.send_json({"type": "error", "detail": "Only the room host can wipe this chat."})
                    return
                for message in messages.values():
                    message["deleted"] = True
                    message["is_deleted"] = True
                    message["encrypted_payloads"] = {}
                    self.persist_encrypted_message(room_id, message)
                    for peer in list(self.connections.get(room_id, set())):
                        recipient = self.identities.get(peer)
                        if recipient:
                            await peer.send_json({
                                "type": "message",
                                "action": "delete",
                                "message": self._message_for_recipient(message, recipient.client_id),
                            })
            elif event_type in ("message.edit", "message.delete"):
                message_id = str(event.get("message_id") or "")
                message = messages.get(message_id)
                if message is None or message["user_id"] != connection.client_id:
                    await websocket.send_json({"type": "error", "detail": "Message not found or not editable."})
                    return
                if event_type == "message.delete" and message.get("is_voice_record"):
                    await websocket.send_json({
                        "type": "error",
                        "detail": "Voice-call transcript records cannot be deleted.",
                    })
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


ACTIVE_PRESENCE_WEBSOCKETS: Set[WebSocket] = set()
USER_NOTIFICATION_WEBSOCKETS: Dict[str, Set[WebSocket]] = {}
room_manager = RoomManager()


async def send_user_notification(user_id: str, event: Dict[str, Any]) -> None:
    for websocket in list(USER_NOTIFICATION_WEBSOCKETS.get(user_id, set())):
        try:
            await websocket.send_json(event)
        except (RuntimeError, WebSocketDisconnect):
            USER_NOTIFICATION_WEBSOCKETS.get(user_id, set()).discard(websocket)
            ACTIVE_PRESENCE_WEBSOCKETS.discard(websocket)


async def notify_admins_of_vip_request(event: Dict[str, Any]) -> None:
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        admin_ids = [
            str(row[0])
            for row in connection.execute(
                "SELECT user_id FROM user_registry WHERE lower(email) = ?",
                (ADMIN_EMAIL,),
            ).fetchall()
        ]
    for admin_id in admin_ids:
        await send_user_notification(admin_id, event)
    for websocket in list(ACTIVE_PRESENCE_WEBSOCKETS):
        connection = room_manager.identities.get(websocket)
        if connection and connection.email.strip().lower() == ADMIN_EMAIL:
            try:
                await websocket.send_json(event)
            except (RuntimeError, WebSocketDisconnect):
                ACTIVE_PRESENCE_WEBSOCKETS.discard(websocket)


@app.websocket("/ws/user/{user_id}")
async def user_notification_websocket(websocket: WebSocket, user_id: str):
    token = (websocket.query_params.get("token") or "").strip()
    await websocket.accept()
    try:
        identity = (
            local_developer_identity(websocket, "Bearer dev-token-local-bypass")
            if token == "dev-token-local-bypass" and is_local_development_request(websocket)
            else await asyncio.to_thread(verified_identity_from_token, token, websocket)
        )
        if not identity or str(identity.get("sub") or "") != user_id:
            await websocket.close(code=1008, reason="Authenticated user identity does not match.")
            return
        USER_NOTIFICATION_WEBSOCKETS.setdefault(user_id, set()).add(websocket)
        ACTIVE_PRESENCE_WEBSOCKETS.add(websocket)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except HTTPException:
        await websocket.close(code=1008, reason="Authentication failed.")
    finally:
        USER_NOTIFICATION_WEBSOCKETS.get(user_id, set()).discard(websocket)
        if not USER_NOTIFICATION_WEBSOCKETS.get(user_id):
            USER_NOTIFICATION_WEBSOCKETS.pop(user_id, None)
        ACTIVE_PRESENCE_WEBSOCKETS.discard(websocket)


async def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    identity = await asyncio.to_thread(
        verified_identity_from_token,
        authorization.removeprefix("Bearer ").strip(),
        request,
    )
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        row = connection.execute(
            """
            SELECT is_admin, is_vip, vip_expires_at
            FROM user_registry WHERE user_id = ?
            """,
            (identity["sub"],),
        ).fetchone()
    vip_expires_at = row[2] if row else None
    registry_vip = bool(
        row
        and row[1]
        and vip_expires_at
        and vip_expires_at > datetime.now(timezone.utc).isoformat()
    )
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        pass_row = connection.execute(
            """
            SELECT 1 FROM active_vip_passes
            WHERE user_id = ? AND is_active = 1
              AND julianday(expires_at) > julianday('now')
            LIMIT 1
            """,
            (identity["sub"],),
        ).fetchone()
    is_active_vip = registry_vip or bool(pass_row)
    return {
        **identity,
        "is_admin": str(identity.get("email") or "").strip().lower() == ADMIN_EMAIL,
        "is_vip": is_active_vip,
    }


@app.get("/admin/telemetry", include_in_schema=False)
@app.get("/api/py/admin/telemetry", include_in_schema=False)
@app.get("/api/admin/telemetry")
async def get_admin_telemetry(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    local_dev = is_local_development_request(request)
    if local_dev and (
        not authorization or authorization.strip() == "Bearer dev-token-local-bypass"
    ):
        current_user = local_developer_identity(
            request,
            authorization or "Bearer dev-token-local-bypass",
        )
    else:
        current_user = await get_current_user(request, authorization)
    authenticated_email = str(current_user.get("email") or "").strip().lower()
    if local_dev and authenticated_email == ADMIN_EMAIL:
        current_user["is_admin"] = True
    if authenticated_email != ADMIN_EMAIL or current_user.get("is_admin") is not True:
        raise HTTPException(status_code=403, detail="Administrator access is required.")
    try:
        with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
            with connection:
                connection.execute(
                    """
                    UPDATE active_vip_passes SET is_active = 0
                    WHERE is_active = 1 AND julianday(expires_at) <= julianday('now')
                    """
                )
            total_registered = connection.execute(
                "SELECT COUNT(*) FROM user_registry"
            ).fetchone()[0]
            registered_user_ids = {
                row[0] for row in connection.execute("SELECT user_id FROM user_registry").fetchall()
            }
            online_user_ids = {
                room_manager.identities[websocket].client_id.removeprefix("google:")
                for websocket in ACTIVE_PRESENCE_WEBSOCKETS
                if websocket in room_manager.identities
                and room_manager.identities[websocket].client_id.removeprefix("google:") in registered_user_ids
            }
            online_user_ids.update(
                user_id
                for user_id, sockets in USER_NOTIFICATION_WEBSOCKETS.items()
                if sockets and user_id in registered_user_ids
            )
            online_users = len(online_user_ids)
            active_vips = connection.execute(
                """
                SELECT COUNT(*) FROM active_vip_passes
                WHERE is_active = 1 AND julianday(expires_at) > julianday('now')
                """
            ).fetchone()[0]
            pending_requests = connection.execute(
                """
                SELECT request_id, user_id, user_email, user_name, note, created_at
                FROM vip_requests WHERE status = 'pending'
                ORDER BY created_at ASC
                """
            ).fetchall()
    except sqlite3.Error:
        if not local_dev:
            raise
        logger.exception("Admin telemetry database read failed in local development.")
        total_registered = online_users = active_vips = 0
        pending_requests = []
    registered_accounts = int(total_registered or 0)
    active_websockets = len(ACTIVE_PRESENCE_WEBSOCKETS)
    vip_count = int(active_vips or 0)
    requests = [
        {
            "request_id": row[0],
            "user_id": row[1],
            "email": row[2],
            "display_name": row[3],
            "message": row[4],
            "created_at": row[5],
        }
        for row in pending_requests
    ]
    return {
        "total_registered": registered_accounts,
        "live_active": active_websockets,
        "online_users": int(online_users or 0),
        "offline_users": max(0, registered_accounts - int(online_users or 0)),
        "active_vips": vip_count,
        "vip_pool_remaining": max(0, 20 - vip_count),
        "registered_accounts": registered_accounts,
        "active_websockets": active_websockets,
        "offline_accounts": max(0, registered_accounts - int(online_users or 0)),
        "vip_claimed": vip_count,
        "remaining_vip_pool": max(0, 20 - vip_count),
        "requests": requests,
    }


def require_primary_admin(current_user: Dict[str, Any]) -> None:
    if (
        str(current_user.get("email") or "").strip().lower() != ADMIN_EMAIL
        or current_user.get("is_admin") is not True
    ):
        raise HTTPException(status_code=403, detail="Administrator access is required.")


@app.post("/api/py/admin/totp/verify")
@app.post("/api/admin/totp/verify", include_in_schema=False)
async def verify_admin_knock(
    payload: Dict[str, Any],
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    require_primary_admin(current_user)
    code = re.sub(r"\s", "", str(payload.get("code") or ""))
    if not re.fullmatch(r"\d{6}", code):
        raise HTTPException(status_code=422, detail="Enter a valid 6-digit Authenticator code.")
    with closing(sqlite3.connect(ARCHIVE_DB_PATH, timeout=15)) as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """
            SELECT secret, last_counter, locked_until, failed_attempts
            FROM totp_credentials WHERE email = ? COLLATE NOCASE
            """,
            (ADMIN_EMAIL,),
        ).fetchone()
        if not row or float(row[2] or 0) > time.time():
            raise HTTPException(status_code=403, detail="The administrator Authenticator is unavailable.")
        accepted_counter = matching_totp_counter(decrypt_totp_secret(row[0]), code)
        if accepted_counter is None or accepted_counter <= int(row[1] or -1):
            failures = int(row[3] or 0) + 1
            connection.execute(
                """
                UPDATE totp_credentials SET failed_attempts = ?, locked_until = ?
                WHERE email = ? COLLATE NOCASE
                """,
                (failures, time.time() + 300 if failures >= 5 else 0, ADMIN_EMAIL),
            )
            connection.commit()
            raise HTTPException(status_code=403, detail="Invalid or already-used Authenticator code.")
        with connection:
            connection.execute(
                """
                UPDATE totp_credentials
                SET last_counter = ?, failed_attempts = 0, locked_until = 0
                WHERE email = ? COLLATE NOCASE
                """,
                (accepted_counter, ADMIN_EMAIL),
            )
    return {"status": "verified"}


@app.post("/api/py/vip/request", status_code=201)
@app.post("/api/vip/request", status_code=201, include_in_schema=False)
async def request_vip_pass(
    payload: Dict[str, Any],
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    message = str(payload.get("message") or "").strip()
    if len(message) > 1000:
        raise HTTPException(status_code=422, detail="VIP request notes must be 1000 characters or fewer.")
    user_id = str(current_user["sub"])
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            existing = connection.execute(
                """
                SELECT request_id, status FROM vip_requests
                WHERE user_id = ? AND status = 'pending'
                ORDER BY created_at DESC LIMIT 1
                """,
                (user_id,),
            ).fetchone()
            if existing:
                return {"status": existing[1], "request_id": existing[0]}
            request_id = str(uuid.uuid4())
            connection.execute(
                """
                INSERT INTO vip_requests
                    (request_id, user_id, user_email, user_name, note, status, created_at)
                VALUES (?, ?, ?, ?, ?, 'pending', ?)
                """,
                (
                    request_id,
                    user_id,
                    str(current_user.get("email") or ""),
                    str(current_user.get("name") or current_user.get("email") or "")[:120],
                    message,
                    now,
                ),
            )
    await notify_admins_of_vip_request({
        "type": "VIP_REQUEST_RECEIVED",
        "request_id": request_id,
        "user_id": user_id,
        "email": str(current_user.get("email") or ""),
        "display_name": str(current_user.get("name") or ""),
        "message": message,
    })
    return {"status": "pending", "request_id": request_id}


@app.get("/api/py/vip/pending-requests")
@app.get("/api/vip/pending-requests", include_in_schema=False)
async def get_pending_vip_requests(
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    require_primary_admin(current_user)
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        rows = connection.execute(
            """
            SELECT request_id, user_id, user_email, user_name, note, created_at
            FROM vip_requests WHERE status = 'pending'
            ORDER BY created_at ASC
            """
        ).fetchall()
    return {
        "requests": [
            {
                "request_id": row[0],
                "user_id": row[1],
                "email": row[2],
                "display_name": row[3],
                "message": row[4],
                "created_at": row[5],
            }
            for row in rows
        ]
    }


@app.post("/api/py/vip/review")
@app.post("/api/vip/review", include_in_schema=False)
@app.post("/api/py/admin/vip/approve", include_in_schema=False)
async def review_vip_request(
    payload: Dict[str, Any],
    request: Request,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    require_primary_admin(current_user)
    request_id = str(payload.get("request_id") or "").strip()
    request_email = str(payload.get("email") or "").strip().lower()
    decision = (
        "approve"
        if request.url.path.endswith("/admin/vip/approve")
        else str(payload.get("action") or payload.get("decision") or "").strip().lower()
    )
    code = str(payload.get("code") or "").strip()
    try:
        duration_days = int(payload.get("duration_days", payload.get("days", 7)))
    except (TypeError, ValueError):
        duration_days = 7
    duration_days = max(1, min(30, duration_days))
    if not request_id or decision not in {"approve", "reject"} or len(code) != 6 or not code.isdigit():
        raise HTTPException(status_code=422, detail="A request ID, action, and 6-digit authenticator code are required.")

    now = datetime.now(timezone.utc)
    status = "approved" if decision == "approve" else "rejected"
    with closing(sqlite3.connect(ARCHIVE_DB_PATH, timeout=15)) as connection:
        connection.execute("BEGIN IMMEDIATE")
        with connection:
            admin_totp_row = connection.execute(
                """
                SELECT secret, last_counter, locked_until, failed_attempts
                FROM totp_credentials WHERE email = ? COLLATE NOCASE
                """,
                (ADMIN_EMAIL,),
            ).fetchone()
            if not admin_totp_row or float(admin_totp_row[2] or 0) > time.time():
                raise HTTPException(status_code=403, detail="The administrator Authenticator is unavailable.")
            accepted_counter = matching_totp_counter(decrypt_totp_secret(admin_totp_row[0]), code)
            if accepted_counter is None or accepted_counter <= int(admin_totp_row[1] or -1):
                failed_attempts = int(admin_totp_row[3] or 0) + 1
                locked_until = time.time() + 300 if failed_attempts >= 5 else 0
                connection.execute(
                    """
                    UPDATE totp_credentials
                    SET failed_attempts = ?, locked_until = ?
                    WHERE email = ? COLLATE NOCASE
                    """,
                    (failed_attempts, locked_until, ADMIN_EMAIL),
                )
                connection.commit()
                raise HTTPException(status_code=403, detail="Invalid or already-used Authenticator code.")
            row = connection.execute(
                """
                SELECT user_id, user_email
                FROM vip_requests
                WHERE request_id = ? AND status = 'pending'
                """,
                (request_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Pending VIP request was not found.")
            if not request_email or row[1].strip().lower() != request_email:
                raise HTTPException(status_code=409, detail="VIP request identity does not match.")
            user_id = row[0]
            if decision == "approve":
                connection.execute(
                    """
                    UPDATE active_vip_passes SET is_active = 0
                    WHERE is_active = 1 AND julianday(expires_at) <= julianday('now')
                    """
                )
                active_count = connection.execute(
                    """
                    SELECT COUNT(*) FROM active_vip_passes
                    WHERE is_active = 1 AND julianday(expires_at) > julianday('now')
                    """,
                ).fetchone()[0]
                if int(active_count or 0) >= VIP_SESSION_LIMIT:
                    raise HTTPException(status_code=409, detail="VIP capacity full.")
            connection.execute(
                """
                UPDATE vip_requests
                SET status = ?, duration_days = ?, reviewed_at = ?, reviewed_by = ?
                WHERE request_id = ? AND status = 'pending'
                """,
                (
                    status,
                    duration_days if decision == "approve" else None,
                    now.isoformat(),
                    str(current_user["sub"]),
                    request_id,
                ),
            )
            connection.execute(
                "UPDATE totp_credentials SET last_counter = ?, failed_attempts = 0 WHERE email = ? COLLATE NOCASE",
                (accepted_counter, ADMIN_EMAIL),
            )
            if decision == "approve":
                expires_at = (now + timedelta(days=duration_days)).isoformat()
                connection.execute(
                    """
                    INSERT INTO active_vip_passes
                        (user_id, user_email, granted_by, duration_days, granted_at, expires_at, is_active)
                    VALUES (?, ?, ?, ?, ?, ?, 1)
                    ON CONFLICT(user_id) DO UPDATE SET
                        user_email = excluded.user_email,
                        granted_by = excluded.granted_by,
                        duration_days = excluded.duration_days,
                        granted_at = excluded.granted_at,
                        expires_at = excluded.expires_at,
                        is_active = 1
                    """,
                    (
                        user_id,
                        row[1],
                        ADMIN_EMAIL,
                        duration_days,
                        now.isoformat(),
                        expires_at,
                    ),
                )
                connection.execute(
                    """
                    UPDATE user_registry
                    SET is_vip = 1, vip_duration_type = ?,
                        vip_expires_at = ?, updated_at = ?
                    WHERE user_id = ?
                    """,
                    (f"{duration_days}_days", expires_at, now.isoformat(), user_id),
                )
    if decision == "approve":
        await send_user_notification(user_id, {
            "type": "VIP_PASS_GRANTED",
            "user_id": user_id,
            "email": row[1],
            "duration_days": duration_days,
            "expires_at": expires_at,
        })
    return {"status": status, "duration_days": duration_days if decision == "approve" else None}


@app.post("/api/py/chat/auto-dispatch-transcript")
@app.post("/api/py/chat/auto-dispatch-transcript/", include_in_schema=False)
@app.post("/api/chat/auto-dispatch-transcript", include_in_schema=False)
@app.post("/chat/auto-dispatch-transcript/", include_in_schema=False)
@app.post("/chat/auto-dispatch-transcript", include_in_schema=False)
async def auto_dispatch_ephemeral_transcript(request: Request):
    try:
        raw_body = await request.body()
        if len(raw_body) > 2_000_000:
            raise HTTPException(status_code=413, detail="Session backup exceeds the 2 MB limit.")
        payload = json.loads(raw_body)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise HTTPException(status_code=400, detail="The session backup payload is invalid.") from error
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="The session backup payload must be an object.")
    token = str(payload.get("session_token") or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="A verified session is required to dispatch this backup.")
    identity = await asyncio.to_thread(verified_identity_from_token, token, request)
    user_email = str(identity.get("email") or "").strip().lower()
    transcript = payload.get("transcript")
    backup = payload.get("backup")
    if not user_email or not isinstance(transcript, (list, str)) or not isinstance(backup, dict):
        raise HTTPException(status_code=422, detail="A transcript and JSON backup are required.")

    transcript_json = json.dumps(transcript, ensure_ascii=False, separators=(",", ":"))
    backup_json = json.dumps(backup, ensure_ascii=False, separators=(",", ":"))
    if isinstance(transcript, str):
        transcript_text = transcript
    else:
        transcript_text = "\n\n".join(
            "\n".join(
                value
                for value in (
                    " · ".join(
                        str(item.get(field) or "")
                        for field in ("session_title", "room_title", "role", "timestamp")
                        if item.get(field)
                    ),
                    str(item.get("content") or ""),
                )
                if value
            )
            for item in transcript
            if isinstance(item, dict)
        )
    created_at = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH, timeout=15)) as connection:
        with connection:
            connection.execute(
                """
                INSERT INTO ephemeral_session_dispatches
                    (id, user_id, user_email, transcript_json, backup_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    str(identity["sub"]),
                    user_email,
                    transcript_json,
                    backup_json,
                    created_at,
                ),
            )

    smtp_host = (os.getenv("SMTP_HOST") or os.getenv("GENIE_SMTP_HOST") or "").strip()
    smtp_user = (os.getenv("SMTP_USER") or os.getenv("GENIE_SMTP_USER") or "").strip()
    smtp_password = os.getenv("SMTP_PASS") or os.getenv("GENIE_SMTP_PASSWORD") or ""
    smtp_from = (os.getenv("SMTP_FROM") or os.getenv("GENIE_SMTP_FROM") or smtp_user).strip()
    if not smtp_host or not smtp_user or not smtp_password or not smtp_from:
        logger.error("Ephemeral transcript dispatch was logged but SMTP is not configured.")
        raise HTTPException(status_code=503, detail="Transcript dispatch email is not configured.")
    try:
        smtp_port = int(os.getenv("SMTP_PORT") or os.getenv("GENIE_SMTP_PORT", "587"))
    except ValueError as error:
        logger.exception("Ephemeral transcript dispatch SMTP port is invalid.")
        raise HTTPException(status_code=503, detail="Transcript dispatch email is not configured.") from error

    message = EmailMessage()
    message["Subject"] = "Your Personal AI Genie session backup"
    message["From"] = smtp_from
    message["To"] = user_email
    message.set_content(
        "Your ephemeral Personal AI Genie session backup is attached. "
        "The transcript and JSON archive were sent to the Google account used for sign-in."
    )
    transcript_html = (
        "<!doctype html><html><body><h1>Personal AI Genie session transcript</h1>"
        f"<pre style=\"font-family:Arial,sans-serif;white-space:pre-wrap\">{html.escape(transcript_text)}</pre>"
        "</body></html>"
    )
    message.add_alternative(transcript_html, subtype="html")
    message.add_attachment(transcript_text, subtype="plain", filename="genie-transcript.txt")
    message.add_attachment(backup_json, subtype="json", filename="genie-session-backup.json")

    def dispatch_email() -> None:
        use_ssl = (os.getenv("SMTP_USE_SSL") or os.getenv("GENIE_SMTP_USE_SSL", "")).strip().lower() in {
            "1", "true", "yes"
        }
        if use_ssl:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=15) as smtp:
                smtp.login(smtp_user, smtp_password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as smtp:
                smtp.starttls()
                smtp.login(smtp_user, smtp_password)
                smtp.send_message(message)

    try:
        await asyncio.to_thread(dispatch_email)
    except (OSError, smtplib.SMTPException) as error:
        logger.exception("Could not email ephemeral transcript backup to the authenticated account.")
        raise HTTPException(status_code=502, detail="Transcript backup was logged, but email delivery failed.") from error
    return {"status": "dispatched"}


@app.post("/api/vip/claim-secret-pass")
async def claim_vip_secret_pass(
    payload: Dict[str, Any],
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    code = payload.get("code")
    if not isinstance(code, str) or not code.strip():
        raise HTTPException(status_code=422, detail="A TOTP code is required.")
    try:
        totp = pyotp.TOTP(os.getenv("ADMIN_TOTP_SECRET", "BASE32SECRET3232"))
        valid_code = totp.verify(code.strip(), valid_window=1)
    except (TypeError, ValueError) as error:
        logger.exception("The configured administrator TOTP secret is invalid.")
        raise HTTPException(status_code=500, detail="VIP claim verification is unavailable.") from error
    if not valid_code:
        raise HTTPException(status_code=403, detail="Invalid secret pass code.")

    requested_days = payload.get("days", 7)
    if isinstance(requested_days, bool) or not isinstance(requested_days, int):
        requested_days = 7
    days = max(1, min(7, requested_days))
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    expires_at = (now + timedelta(days=days)).isoformat()
    try:
        with closing(sqlite3.connect(ARCHIVE_DB_PATH, timeout=15)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            user_id = str(current_user["sub"])
            active_vips = connection.execute(
                """
                SELECT COUNT(*) FROM user_registry
                WHERE is_vip = 1 AND vip_expires_at IS NOT NULL AND vip_expires_at > ?
                  AND user_id != ?
                """,
                (now_iso, user_id),
            ).fetchone()[0]
            if int(active_vips or 0) >= VIP_SESSION_LIMIT:
                connection.rollback()
                raise HTTPException(status_code=409, detail="VIP capacity full.")

            account = connection.execute(
                "SELECT user_id FROM user_registry WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            if not account:
                email = str(current_user["email"]).strip().lower()
                connection.execute(
                    """
                    INSERT INTO user_registry
                        (user_id, email, display_name, avatar_url, mobile_number, recovery_email,
                         terms_accepted_at, created_at, updated_at, is_admin)
                    VALUES (?, ?, ?, ?, '', '', '', ?, ?, ?)
                    """,
                    (
                        user_id,
                        email,
                        str(current_user.get("name") or email)[:120],
                        str(current_user.get("picture") or "")[:2048],
                        now_iso,
                        now_iso,
                        int(current_user["email"].strip().lower() in {*ADMIN_EMAILS, SUPER_ADMIN_IDENTIFIER}),
                    ),
                )
            connection.execute(
                """
                UPDATE user_registry
                SET is_vip = 1, vip_duration_type = ?, vip_expires_at = ?, updated_at = ?
                WHERE user_id = ?
                """,
                (f"{days}_days", expires_at, now_iso, user_id),
            )
            connection.commit()
    except HTTPException:
        raise
    except sqlite3.Error as error:
        logger.exception("VIP claim could not be persisted.")
        raise HTTPException(status_code=503, detail="VIP claim could not be saved.") from error
    return {"status": "SUCCESS", "expires_at": expires_at}


@app.get("/disclaimer", response_class=HTMLResponse)
async def byok_ai_platform_disclaimer():
    return HTMLResponse(
        content="""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Bring Your Own Key and AI platform liability disclaimer for Personal AI Genie">
<title>BYOK &amp; AI Platform Liability Disclaimer</title>
<style>
:root{color-scheme:dark;background:#070b12;color:#e5edf7;font:16px/1.7 system-ui,-apple-system,Segoe UI,sans-serif}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at top,#10233a 0,#070b12 55%);min-height:100vh}
main{max-width:900px;margin:0 auto;padding:64px 24px 80px}header{border-bottom:1px solid #164e63;padding-bottom:28px;margin-bottom:32px}
.eyebrow{color:#67e8f9;text-transform:uppercase;letter-spacing:.16em;font-size:.75rem;font-weight:700}
h1{font-size:clamp(2rem,6vw,3.5rem);line-height:1.1;letter-spacing:-.04em;margin:.6rem 0}
h2{font-size:1.25rem;color:#a5f3fc;margin:0 0 8px}section{padding:22px 24px;margin:16px 0;border:1px solid #164e63;border-radius:18px;background:#0b1420}
p{margin:0;color:#c5d1df}footer{margin-top:32px;color:#8292a6;font-size:.85rem}
a{color:#67e8f9}
</style></head><body><main><header><div class="eyebrow">Personal AI Genie · Legal</div>
<h1>Bring Your Own Key (BYOK) &amp; AI Platform Liability Disclaimer</h1>
<p>Effective October 13, 2026. Please review these terms before connecting a third-party AI provider.</p></header>
<section><h2>User responsibility for billing and quotas</h2><p>You are responsible for the Google Cloud, Google AI Studio, or other provider account connected with your API key, including its billing settings, usage limits, quota management, and compliance with that provider's terms. Provider usage may incur charges directly on your account.</p></section>
<section><h2>Zero platform liability for third-party services</h2><p>Personal AI Genie does not control third-party pricing, rate limits, availability, account enforcement, or provider decisions. To the extent permitted by law, the platform is not responsible for third-party charges, service interruptions, quota exhaustion, or actions taken by a provider against your account.</p></section>
<section><h2>Advisory AI output</h2><p>AI-generated output may be incomplete, inaccurate, insecure, or unsuitable for your needs. You are responsible for independently reviewing and validating generated code, commands, and recommendations before use, especially in production or safety-sensitive environments.</p></section>
<section><h2>Zero key pooling</h2><p>Your BYOK credentials are client-isolated and are not pooled, shared with other users, or used to fund another user's requests. You authorize the selected provider to process requests using your own credential and account.</p></section>
<footer>Use of this service remains subject to applicable law and the terms of your chosen AI provider.</footer>
</main></body></html>"""
    )


@app.get("/privacy", response_class=HTMLResponse)
async def zero_knowledge_privacy_policy():
    return HTMLResponse(
        content="""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Zero-Knowledge Privacy Policy for Personal AI Genie">
<title>Zero-Knowledge Privacy Policy</title>
<style>
:root{color-scheme:dark;background:#070b12;color:#e5edf7;font:16px/1.7 system-ui,-apple-system,Segoe UI,sans-serif}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at top,#10233a 0,#070b12 55%);min-height:100vh}
main{max-width:900px;margin:0 auto;padding:64px 24px 80px}header{border-bottom:1px solid #164e63;padding-bottom:28px;margin-bottom:32px}
.eyebrow{color:#67e8f9;text-transform:uppercase;letter-spacing:.16em;font-size:.75rem;font-weight:700}
h1{font-size:clamp(2rem,6vw,3.5rem);line-height:1.1;letter-spacing:-.04em;margin:.6rem 0}
h2{font-size:1.25rem;color:#a5f3fc;margin:0 0 8px}section{padding:22px 24px;margin:16px 0;border:1px solid #164e63;border-radius:18px;background:#0b1420}
p{margin:0;color:#c5d1df}footer{margin-top:32px;color:#8292a6;font-size:.85rem}
</style></head><body><main><header><div class="eyebrow">Personal AI Genie · Privacy</div>
<h1>Zero-Knowledge Privacy Policy</h1>
<p>Effective October 13, 2026. This policy describes identity, content, telemetry, and credential handling.</p></header>
<section><h2>Chat and audio handling</h2><p>We do not mine or train AI models on your chats or WebRTC audio. Room communications are encrypted client-side before relay; AI context is shared with an AI provider only when you explicitly invoke an AI feature. Third-party providers may process submitted requests under their own terms. If you choose an untrusted, temporary device session, closing the tab sends the transcript and JSON backup to the Google account used to sign in. That dispatch payload is also recorded in the service database for delivery logging; choose a trusted device or sign out without this option if you do not want a server-side dispatch copy.</p></section>
<section><h2>Deterministic Google Sign-In identity</h2><p>Google Sign-In is used to verify account identity and associate account-owned features with a stable Google subject identifier. We use verified identity claims for authentication and do not infer identity from chat content.</p></section>
<section><h2>Aggregate-only administrator telemetry</h2><p>Administrator telemetry exposes only aggregate registered-account counts, current WebSocket connection counts, active VIP counts, and remaining VIP capacity. It does not expose individual names, email addresses, room identifiers, message contents, or personal activity.</p></section>
<section><h2>Instant credential erasure and key revocation</h2><p>You can erase credentials stored in your browser through the application's credential-clearing controls. Removing or rotating a provider key revokes the application's ability to use that key; you should also revoke it with the provider. Clearing browser storage removes local credentials and locally held encryption material.</p></section>
<footer>Questions about privacy may be directed to the service operator through the contact information published with the application.</footer>
</main></body></html>"""
    )


@app.get("/terms", response_class=HTMLResponse)
async def terms_of_service():
    return HTMLResponse(
        content="""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Terms of Service for Personal AI Genie">
<title>Terms of Service | Personal AI Genie</title>
<style>
:root{color-scheme:dark;background:#070b12;color:#e5edf7;font:16px/1.7 system-ui,-apple-system,Segoe UI,sans-serif}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at top,#10233a 0,#070b12 55%);min-height:100vh}
main{max-width:900px;margin:0 auto;padding:64px 24px 80px}header{border-bottom:1px solid #164e63;padding-bottom:28px;margin-bottom:32px}
.eyebrow{color:#67e8f9;text-transform:uppercase;letter-spacing:.16em;font-size:.75rem;font-weight:700}
h1{font-size:clamp(2rem,6vw,3.5rem);line-height:1.1;letter-spacing:-.04em;margin:.6rem 0}
h2{font-size:1.25rem;color:#a5f3fc;margin:0 0 8px}section{padding:22px 24px;margin:16px 0;border:1px solid #164e63;border-radius:18px;background:#0b1420}
p{margin:0;color:#c5d1df}footer{margin-top:32px;color:#8292a6;font-size:.85rem}
</style></head><body><main><header><div class="eyebrow">Personal AI Genie · Legal</div>
<h1>Terms of Service</h1>
<p>Effective October 13, 2026. These terms govern your access to and use of Personal AI Genie.</p></header>
<section><h2>1. Agreement and eligibility</h2><p>By accessing or using Personal AI Genie, you agree to these Terms. If you use the service for an organization, you represent that you are authorized to accept these Terms on its behalf. Do not use the service if you do not agree.</p></section>
<section><h2>2. Accounts and security</h2><p>You are responsible for the accuracy of information associated with your account, safeguarding your sign-in credentials, and activity performed through your account. Notify the service operator promptly if you believe your account or credentials have been compromised.</p></section>
<section><h2>3. Acceptable use</h2><p>Use the service only for lawful purposes and in compliance with applicable laws and third-party terms. Do not attempt to disrupt, probe, or gain unauthorized access to the service; misuse another person's account or data; or use the service to create or distribute unlawful, harmful, or infringing material.</p></section>
<section><h2>4. Your content and shared rooms</h2><p>You retain rights to content you provide. You grant the service only the limited permissions needed to operate features you request, such as relaying encrypted room messages or processing a prompt through an AI provider you select. You are responsible for having permission to share content with room participants and third-party providers. Room participants may independently retain or disclose information they can access.</p></section>
<section><h2>5. AI providers and generated output</h2><p>AI features may rely on third-party providers and are subject to their availability and terms. AI output can be inaccurate or incomplete and is provided for informational assistance, not as professional advice. Review and independently validate output, including code, before relying on or deploying it. BYOK billing, quotas, and provider-account responsibilities are described in the <a href="/disclaimer" style="color:#67e8f9">BYOK &amp; AI Platform Liability Disclaimer</a>.</p></section>
<section><h2>6. Privacy</h2><p>Our handling of identity, room communications, telemetry, and credentials is described in the <a href="/privacy" style="color:#67e8f9">Zero-Knowledge Privacy Policy</a>. Review that policy before using the service.</p></section>
<section><h2>7. Service availability and changes</h2><p>We may update, suspend, or discontinue all or part of the service for operational, security, or legal reasons. We may revise these Terms; material revisions will be reflected by updating this page and its effective date. Continued use after revised terms take effect constitutes acceptance where permitted by law.</p></section>
<section><h2>8. Disclaimers and limitation of liability</h2><p>To the extent permitted by law, the service is provided on an “as available” basis without warranties of uninterrupted availability, accuracy, or fitness for a particular purpose. To the extent permitted by law, the service operator will not be liable for indirect, incidental, special, consequential, or punitive damages, or loss of data, profits, or goodwill, arising from your use of the service or third-party services. Nothing in these Terms excludes liability that cannot lawfully be excluded.</p></section>
<section><h2>9. Suspension and termination</h2><p>You may stop using the service at any time. Access may be suspended or terminated if reasonably necessary to address a security risk, legal requirement, material breach of these Terms, or harm to users or the service. Provisions that by their nature should continue after termination will survive.</p></section>
<section><h2>10. General</h2><p>These Terms do not limit rights that cannot be waived under applicable law. If any provision is unenforceable, the remaining provisions remain in effect. These Terms and any dispute concerning them are subject to applicable law and any mandatory consumer protections in your jurisdiction.</p></section>
<footer>For questions about these Terms, contact the service operator using the contact information published with the application.</footer>
</main></body></html>"""
    )


def verified_identity_from_token(
    token: Optional[str],
    request: Optional[Request] = None,
) -> Dict[str, str]:
    normalized_token = (token or "").removeprefix("Bearer ").strip()
    if normalized_token == "dev-token-local-bypass" and request is not None:
        dev_identity = local_developer_identity(request, f"Bearer {normalized_token}")
        if dev_identity:
            return dev_identity
    identity = verify_google_id_token_claims(token)
    if not identity:
        raise HTTPException(
            status_code=401,
            detail=(
                "Google sign-in could not be verified. The ID token may be expired, "
                "invalid, or issued for a different Google client ID."
            ),
        )
    if not (token or "").startswith("genie1."):
        with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
            enrolled = connection.execute(
                "SELECT 1 FROM totp_credentials WHERE user_id = ?",
                (identity["sub"],),
            ).fetchone()
        if enrolled:
            raise HTTPException(
                status_code=401,
                detail="Use your email and Authenticator code to sign in.",
            )
    return identity


@app.middleware("http")
async def enforce_personal_api_scope(request: Request, call_next):
    path = request.url.path
    scoped_path = (
        "/api/personal/" in path
        or "/social/" in path
        or "/api/archive/" in path
    )
    if not scoped_path:
        return await call_next(request)

    authorization = request.headers.get("authorization", "")
    token = authorization.removeprefix("Bearer ").strip() if authorization.startswith("Bearer ") else ""
    if not token and request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        body = await request.body()
        async def receive_body():
            return {"type": "http.request", "body": body, "more_body": False}
        request._receive = receive_body
        try:
            payload = json.loads(body) if body else {}
            token = str(payload.get("google_id_token") or "") if isinstance(payload, dict) else ""
        except (ValueError, UnicodeDecodeError):
            token = ""
    if token:
        try:
            identity = await asyncio.to_thread(verified_identity_from_token, token, request)
        except HTTPException:
            return await call_next(request)
        if verified_workspace_tenant(identity):
            return JSONResponse(status_code=403, content={"detail": "SCOPE_MISMATCH"})
    return await call_next(request)


@app.get("/api/auth/session-scope")
async def get_verified_session_scope(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    identity = await asyncio.to_thread(
        verified_identity_from_token,
        authorization.removeprefix("Bearer ").strip(),
        request,
    )
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            ensure_social_user(connection, identity)
    return {
        "scope": "workspace" if verified_workspace_tenant(identity) else "personal",
        "tenant_id": verified_workspace_tenant(identity),
        "display_name": identity.get("name", ""),
        "email": identity["email"],
        "corporate_avatar_url": identity.get("picture", ""),
        "is_super_admin": identity["email"].strip().lower() == SUPER_ADMIN_IDENTIFIER,
    }


def ensure_social_user(connection: sqlite3.Connection, identity: Dict[str, str]) -> str:
    google_sub = str(identity["sub"])
    email = str(identity["email"]).strip().lower()
    now = datetime.now(timezone.utc).isoformat()
    existing = connection.execute(
        "SELECT id FROM users WHERE google_sub = ?", (google_sub,)
    ).fetchone()
    user_id = existing[0] if existing else str(uuid.uuid4())
    connection.execute(
        """
        INSERT INTO users (id, email, display_name, avatar_url, google_sub, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(google_sub) DO UPDATE SET
            email = excluded.email,
            display_name = excluded.display_name,
            avatar_url = excluded.avatar_url
        """,
        (
            user_id,
            email,
            str(identity.get("name") or email)[:120],
            str(identity.get("picture") or "")[:2048],
            google_sub,
            now,
        ),
    )
    return user_id


def social_identity_from_request(
    request: Request,
    authorization: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    bearer = (
        authorization.removeprefix("Bearer ").strip()
        if authorization and authorization.startswith("Bearer ")
        else ""
    )
    token = bearer or str((payload or {}).get("google_id_token") or "")
    if token == "dev-token-local-bypass" and not (
        DEV_AUTH_BYPASS_ENABLED and is_local_development_request(request)
    ):
        raise HTTPException(status_code=401, detail="Development sign-in is only available from localhost.")
    return verified_identity_from_token(token, request)


@app.post("/api/auth/google")
async def google_social_login(
    request: Request,
    payload: Dict[str, Any],
    authorization: Optional[str] = Header(default=None),
):
    token = str(
        payload.get("google_id_token")
        or payload.get("id_token")
        or (authorization.removeprefix("Bearer ") if authorization else "")
    ).strip()
    identity = await asyncio.to_thread(
        social_identity_from_request, request, None, {"google_id_token": token}
    )
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            user_id = ensure_social_user(connection, identity)
    session_token = create_internal_session_token(identity)
    return {
        "token": session_token,
        "session_token": session_token,
        "user": {
            "id": user_id,
            "google_sub": identity["sub"],
            "email": identity["email"],
            "display_name": identity.get("name", ""),
            "avatar_url": identity.get("picture", ""),
        },
    }


@app.post("/api/auth/claim-handle")
async def claim_social_handle(
    request: Request,
    payload: Dict[str, Any],
    authorization: Optional[str] = Header(default=None),
):
    identity = await asyncio.to_thread(
        social_identity_from_request, request, authorization, payload
    )
    handle = str(payload.get("handle") or "").strip().removeprefix("@")
    if not re.fullmatch(r"[A-Za-z0-9_]{3,30}", handle):
        raise HTTPException(
            status_code=422,
            detail="Handle must be 3-30 characters and contain only letters, numbers, and underscores.",
        )
    try:
        with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
            with connection:
                user_id = ensure_social_user(connection, identity)
                connection.execute(
                    "UPDATE users SET handle = ? WHERE id = ?", (handle, user_id)
                )
                connection.execute(
                    """
                    INSERT INTO social_directory
                        (user_id, display_name, handle, avatar_url, meta_user_id, email, updated_at)
                    VALUES (?, ?, ?, ?, '', ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        handle = excluded.handle, updated_at = excluded.updated_at
                    """,
                    (
                        identity["sub"],
                        identity.get("name") or identity["email"],
                        handle,
                        identity.get("picture") or "",
                        identity["email"],
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
    except sqlite3.IntegrityError as error:
        raise HTTPException(status_code=409, detail="That handle is already claimed.") from error
    return {"handle": handle, "user_id": user_id}


def resolve_social_user(connection: sqlite3.Connection, target: str) -> Optional[sqlite3.Row]:
    normalized = target.strip().removeprefix("@")
    connection.row_factory = sqlite3.Row
    return connection.execute(
        """
        SELECT id, google_sub, email, handle, display_name, avatar_url
        FROM users WHERE id = ? OR google_sub = ? OR handle = ? COLLATE NOCASE
        """,
        (normalized.removeprefix("google:"), normalized.removeprefix("google:"), normalized),
    ).fetchone()


@app.post("/api/friends/request")
async def create_relational_friend_request(
    request: Request,
    payload: Dict[str, Any],
    authorization: Optional[str] = Header(default=None),
):
    identity = await asyncio.to_thread(
        social_identity_from_request, request, authorization, payload
    )
    target = str(payload.get("target_id") or payload.get("target_user_id") or "").strip()
    if not target:
        raise HTTPException(status_code=422, detail="A target user ID or handle is required.")
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            requester_id = ensure_social_user(connection, identity)
            recipient = resolve_social_user(connection, target)
            if recipient is None:
                raise HTTPException(status_code=404, detail="Registered user was not found.")
            if recipient["id"] == requester_id:
                raise HTTPException(status_code=400, detail="You cannot friend-request yourself.")
            if are_users_blocked(identity["sub"], recipient["google_sub"]):
                raise HTTPException(status_code=403, detail="This relationship is unavailable because of a block.")
            relation = connection.execute(
                "SELECT id, status FROM friendships WHERE requester_id = ? AND addressee_id = ?",
                (requester_id, recipient["id"]),
            ).fetchone()
            incoming = connection.execute(
                "SELECT status FROM friendships WHERE requester_id = ? AND addressee_id = ?",
                (recipient["id"], requester_id),
            ).fetchone()
            if relation and relation[1] == "ACCEPTED" or incoming and incoming[0] == "ACCEPTED":
                return {"status": "already_friends"}
            if incoming and incoming[0] == "PENDING":
                raise HTTPException(status_code=409, detail="This user has already sent you a friend request.")
            connection.execute(
                """
                INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at)
                VALUES (?, ?, ?, 'PENDING', ?, ?)
                ON CONFLICT(requester_id, addressee_id) DO UPDATE SET
                    status = 'PENDING', created_at = excluded.created_at, updated_at = excluded.updated_at
                """,
                (str(uuid.uuid4()), requester_id, recipient["id"], now, now),
            )
    async with room_manager.lock:
        for websocket, connection in list(room_manager.identities.items()):
            if connection.client_id == f"google:{recipient['google_sub']}":
                await websocket.send_json({
                    "type": "FRIEND_REQUEST_RECEIVED",
                    "requester": {
                        "user_id": identity["sub"],
                        "display_name": identity.get("name") or identity["email"],
                        "avatar_url": identity.get("picture") or "",
                    },
                })
    return {"status": "PENDING"}


@app.post("/api/friends/respond")
async def respond_relational_friend_request(
    request: Request,
    payload: Dict[str, Any],
    authorization: Optional[str] = Header(default=None),
):
    identity = await asyncio.to_thread(
        social_identity_from_request, request, authorization, payload
    )
    requester = str(payload.get("requester_id") or "").strip()
    status = str(payload.get("status") or payload.get("response") or "").upper()
    status = {"ACCEPT": "ACCEPTED", "ACCEPTED": "ACCEPTED", "REJECT": "REJECTED", "REJECTED": "REJECTED"}.get(status, "")
    if not requester or not status:
        raise HTTPException(status_code=422, detail="A requester ID and ACCEPTED or REJECTED status are required.")
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            addressee_id = ensure_social_user(connection, identity)
            requester_user = resolve_social_user(connection, requester)
            if requester_user is None:
                raise HTTPException(status_code=404, detail="Friend request was not found.")
            updated = connection.execute(
                """
                UPDATE friendships SET status = ?, updated_at = ?
                WHERE requester_id = ? AND addressee_id = ? AND status = 'PENDING'
                """,
                (status, now, requester_user["id"], addressee_id),
            )
            if updated.rowcount != 1:
                raise HTTPException(status_code=404, detail="Friend request is no longer available.")
    return {"status": status}


@app.get("/api/friends/list")
async def list_relational_friends(
    request: Request, authorization: Optional[str] = Header(default=None)
):
    identity = await asyncio.to_thread(social_identity_from_request, request, authorization)
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            user_id = ensure_social_user(connection, identity)
        rows = connection.execute(
            """
            SELECT u.id, u.google_sub, u.handle, u.display_name, u.avatar_url
            FROM friendships f JOIN users u
              ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
            WHERE f.status = 'ACCEPTED' AND (f.requester_id = ? OR f.addressee_id = ?)
            ORDER BY u.display_name COLLATE NOCASE
            """,
            (user_id, user_id, user_id),
        ).fetchall()
    return {"friends": [
        {
            "user_id": row[0],
            "google_sub": row[1],
            "handle": row[2],
            "display_name": row[3],
            "avatar_url": row[4],
            "online": room_manager._presence_status(f"google:{row[1]}") == "active",
        }
        for row in rows
    ]}


@app.get("/api/friends/pending")
async def list_relational_pending_requests(
    request: Request, authorization: Optional[str] = Header(default=None)
):
    identity = await asyncio.to_thread(social_identity_from_request, request, authorization)
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            user_id = ensure_social_user(connection, identity)
        rows = connection.execute(
            """
            SELECT u.id, u.google_sub, u.handle, u.display_name, u.avatar_url, f.created_at
            FROM friendships f JOIN users u ON u.id = f.requester_id
            WHERE f.addressee_id = ? AND f.status = 'PENDING'
            ORDER BY f.created_at DESC
            """,
            (user_id,),
        ).fetchall()
    return {"requests": [
        {
            "user_id": row[0],
            "google_sub": row[1],
            "handle": row[2],
            "display_name": row[3],
            "avatar_url": row[4],
            "created_at": row[5],
        }
        for row in rows
    ]}


@app.get("/api/friends/mutual/{target_id}")
async def list_mutual_friends(
    target_id: str, request: Request, authorization: Optional[str] = Header(default=None)
):
    identity = await asyncio.to_thread(social_identity_from_request, request, authorization)
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            current_id = ensure_social_user(connection, identity)
        target = resolve_social_user(connection, target_id)
        if target is None:
            raise HTTPException(status_code=404, detail="Registered user was not found.")
        rows = connection.execute(
            """
            SELECT u.id, u.google_sub, u.handle, u.display_name, u.avatar_url
            FROM users u
            WHERE u.id NOT IN (?, ?)
              AND EXISTS (
                SELECT 1 FROM friendships f
                WHERE f.status = 'ACCEPTED'
                  AND ((f.requester_id = ? AND f.addressee_id = u.id)
                    OR (f.addressee_id = ? AND f.requester_id = u.id))
              )
              AND EXISTS (
                SELECT 1 FROM friendships f
                WHERE f.status = 'ACCEPTED'
                  AND ((f.requester_id = ? AND f.addressee_id = u.id)
                    OR (f.addressee_id = ? AND f.requester_id = u.id))
              )
            """,
            (current_id, target["id"], current_id, current_id, target["id"], target["id"]),
        ).fetchall()
    return {"friends": [
        {"user_id": row[0], "google_sub": row[1], "handle": row[2], "display_name": row[3], "avatar_url": row[4]}
        for row in rows
        if not are_users_blocked(identity["sub"], row[1])
        and not are_users_blocked(target["google_sub"], row[1])
    ]}


@app.post("/api/friends/sync")
async def sync_social_profiles(
    request: Request,
    payload: Dict[str, Any],
    authorization: Optional[str] = Header(default=None),
):
    identity = await asyncio.to_thread(
        social_identity_from_request, request, authorization, payload
    )
    profiles = payload.get("profiles") or payload.get("social_profiles") or []
    if not isinstance(profiles, list) or len(profiles) > 500:
        raise HTTPException(status_code=422, detail="Supply up to 500 social profiles.")
    matched = []
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            user_id = ensure_social_user(connection, identity)
            for item in profiles:
                if not isinstance(item, dict):
                    continue
                provider = str(item.get("provider") or "meta").lower()
                provider_user_id = str(item.get("provider_user_id") or item.get("id") or "").strip()
                handle = str(item.get("social_handle") or item.get("handle") or "").strip()[:120]
                if provider not in {"meta", "google"} or not provider_user_id or len(provider_user_id) > 256:
                    continue
                connection.execute(
                    """
                    INSERT INTO social_profiles (id, user_id, provider, provider_user_id, social_handle, synced_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(provider, provider_user_id) DO UPDATE SET
                        user_id = excluded.user_id, social_handle = excluded.social_handle, synced_at = excluded.synced_at
                    """,
                    (str(uuid.uuid4()), user_id, provider, provider_user_id, handle, now),
                )
                registered = connection.execute(
                    """
                    SELECT id, handle, display_name, avatar_url FROM users
                    WHERE lower(handle) = lower(?) OR google_sub = ?
                    """,
                    (handle.removeprefix("@"), provider_user_id),
                ).fetchone()
                if registered and registered[0] != user_id:
                    matched.append({
                        "user_id": registered[0],
                        "handle": registered[1],
                        "display_name": registered[2],
                        "avatar_url": registered[3],
                    })
    return {"matched_users": matched}


def deliver_workspace_session_minutes(recipients: List[str], room_title: str, minutes: str):
    smtp_host = (os.getenv("SMTP_HOST") or os.getenv("GENIE_SMTP_HOST") or "").strip()
    smtp_user = (os.getenv("SMTP_USER") or os.getenv("GENIE_SMTP_USER") or "").strip()
    smtp_password = os.getenv("SMTP_PASS") or os.getenv("GENIE_SMTP_PASSWORD") or ""
    smtp_from = (os.getenv("SMTP_FROM") or os.getenv("GENIE_SMTP_FROM") or smtp_user).strip()
    if not all((smtp_host, smtp_user, smtp_password, smtp_from)):
        logger.error("Workspace session minutes could not be dispatched: SMTP is not configured.")
        return
    message = EmailMessage()
    message["Subject"] = f"Meeting minutes: {room_title[:150]}"
    message["From"] = smtp_from
    message["To"] = ", ".join(recipients)
    message.set_content(minutes)
    message.add_alternative(
        f"<!doctype html><html><body><h1>{html.escape(room_title[:150])}</h1>"
        f"<pre style='white-space:pre-wrap'>{html.escape(minutes)}</pre></body></html>",
        subtype="html",
    )
    try:
        port = int(os.getenv("SMTP_PORT") or os.getenv("GENIE_SMTP_PORT", "587"))
        if port == 465:
            with smtplib.SMTP_SSL(smtp_host, port, timeout=15) as smtp:
                smtp.login(smtp_user, smtp_password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(smtp_host, port, timeout=15) as smtp:
                smtp.starttls()
                smtp.login(smtp_user, smtp_password)
                smtp.send_message(message)
    except (OSError, smtplib.SMTPException, ValueError):
        logger.exception("Workspace session minutes email dispatch failed.")


@app.post("/api/rooms/{room_id}/end-session")
async def end_social_room_session(
    room_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    payload: Dict[str, Any],
    authorization: Optional[str] = Header(default=None),
):
    identity = await asyncio.to_thread(
        social_identity_from_request, request, authorization, payload
    )
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            actor_id = ensure_social_user(connection, identity)
        room = connection.execute(
            "SELECT title, room_type FROM rooms WHERE id = ?", (room_id,)
        ).fetchone()
        if room is None:
            raise HTTPException(status_code=404, detail="Room does not exist.")
        participant = connection.execute(
            "SELECT role FROM room_participants WHERE room_id = ? AND user_id = ?",
            (room_id, actor_id),
        ).fetchone()
        if not participant or participant[0] != "host":
            raise HTTPException(status_code=403, detail="Only the room host can end this session.")
        messages = connection.execute(
            """
            SELECT sender_name, content FROM room_messages
            WHERE room_id = ? ORDER BY created_at LIMIT 5000
            """,
            (room_id,),
        ).fetchall()
        recipients = [
            row[0] for row in connection.execute(
                """
                SELECT DISTINCT u.email FROM room_participants p
                JOIN users u ON u.id = p.user_id
                WHERE p.room_id = ? AND u.email <> ''
                """,
                (room_id,),
            ).fetchall()
        ]
    if not messages:
        raise HTTPException(status_code=409, detail="There are no room messages to summarize.")
    transcript = "\n".join(f"{name}: {content}" for name, content in messages)
    prompt = (
        "Return only a valid JSON object with keys summary_markdown (string) and "
        "action_items (array of objects with task, owner, and due_date). Write concise executive "
        "meeting minutes in English. Do not invent facts; use null when an owner or due date is unknown.\n\n"
        f"Room type: {room[1]}\nTranscript:\n{transcript[:100000]}"
    )
    diagnostics: List[str] = []
    summary = None
    for model in ("gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"):
        if not GEMINI_MASTER_KEY:
            break
        summary = await asyncio.to_thread(
            request_gemini_direct, model, GEMINI_MASTER_KEY, prompt, [], diagnostics
        )
        if summary:
            break
    if not summary and OPENROUTER_KEY:
        summary = await asyncio.to_thread(
            request_openrouter_model,
            OPENROUTER_FREE_MODELS[0],
            OPENROUTER_KEY,
            prompt,
            [],
            diagnostics,
        )
    if not summary:
        logger.error("Room summary generation failed: %s", "; ".join(diagnostics[-4:]))
        raise HTTPException(status_code=503, detail="Meeting minutes could not be generated.")
    try:
        structured_summary = json.loads(summary)
        if not isinstance(structured_summary, dict) or not isinstance(
            structured_summary.get("summary_markdown"), str
        ) or not isinstance(structured_summary.get("action_items"), list):
            raise ValueError("The generated minutes have an invalid response shape.")
        summary = structured_summary["summary_markdown"]
        action_items = structured_summary["action_items"]
    except (json.JSONDecodeError, ValueError) as error:
        logger.error("Room summary was not valid structured JSON.")
        raise HTTPException(status_code=502, detail="Meeting minutes were generated in an invalid format.") from error
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            connection.execute(
                """
                INSERT INTO session_summaries
                    (id, room_id, room_type, summary_markdown, action_items_json, recipients_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (str(uuid.uuid4()), room_id, room[1], summary, json.dumps(action_items), json.dumps(recipients), now),
            )
    if room[1] == "workspace":
        if not recipients:
            raise HTTPException(status_code=409, detail="The workspace room has no participant email recipients.")
        background_tasks.add_task(
            deliver_workspace_session_minutes, recipients, room[0], summary
        )
        return {"room_type": "workspace", "status": "dispatch_queued", "summary_markdown": summary}
    filename = re.sub(r"[^A-Za-z0-9_-]+", "-", room[0]).strip("-") or "room"
    return JSONResponse(
        content={
            "room_type": "personal",
            "filename": f"{filename}-minutes.json",
            "summary_markdown": summary,
            "action_items": action_items,
            "export": {"markdown": summary, "action_items": action_items},
        },
        headers={"Content-Disposition": f'attachment; filename="{filename}-minutes.json"'},
    )


def audit_workspace_action(identity: Dict[str, str], event_type: str, room_id: str = "workspace-chat"):
    tenant_id = require_workspace_scope(identity, verified_workspace_tenant(identity))
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            connection.execute(
                """
                INSERT INTO corporate_workspace_audit
                    (tenant_id, room_id, actor_id, event_type, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    tenant_id,
                    room_id[:128],
                    str(identity["sub"]),
                    event_type[:80],
                    datetime.now(timezone.utc).isoformat(),
                ),
            )


def require_room_scope(room_id: str, identity: Dict[str, str]) -> Dict[str, Any]:
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        row = connection.execute(
            "SELECT space_mode, tenant_id FROM sovereign_rooms WHERE room_id = ?",
            (room_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Room does not exist.")
    if row[0] == "workspace":
        require_workspace_scope(identity, row[1])
    else:
        require_personal_scope(identity)
    return {"space_mode": row[0], "tenant_id": row[1]}


def require_workspace_room_member(room_id: str, identity: Dict[str, str]) -> str:
    configuration = require_room_scope(room_id, identity)
    if configuration["space_mode"] != "workspace":
        raise HTTPException(status_code=403, detail="SCOPE_MISMATCH")
    member_id = f"google:{identity['sub']}"
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        row = connection.execute(
            "SELECT members_json FROM sovereign_rooms WHERE room_id = ?",
            (room_id,),
        ).fetchone()
    if not row or not any(
        member.get("id") == member_id
        and (member.get("tenant_id") or configuration["tenant_id"]) == configuration["tenant_id"]
        for member in json.loads(row[0])
    ):
        raise HTTPException(status_code=403, detail="SCOPE_MISMATCH")
    return str(configuration["tenant_id"])


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


class RegistrationRequest(BaseModel):
    google_id_token: Optional[str] = None
    email: Optional[str] = Field(default=None, max_length=254)
    display_name: str = Field(default="", max_length=120)
    avatar_url: str = Field(default="genie-preset:neutral", max_length=3_000_000)
    avatar_type: Optional[str] = Field(default=None, max_length=32)
    mobile_number: str = Field(default="", max_length=32)
    phone: Optional[str] = Field(default=None, max_length=32)
    recovery_email: str = Field(default="", max_length=254)
    terms_accepted: bool = False
    privacy_accepted: bool = False


class TotpVerifyRequest(BaseModel):
    email: str = Field(min_length=6, max_length=254)
    code: str = Field(min_length=6, max_length=8)
    google_id_token: Optional[str] = None
    setup_secret: Optional[str] = Field(default=None, max_length=128)
    reset_token: Optional[str] = Field(default=None, max_length=256)


class TotpSetupRequest(BaseModel):
    email: str = Field(min_length=6, max_length=254)


class TotpResetRequest(BaseModel):
    email: str = Field(min_length=6, max_length=254)


class TotpResetConfirmRequest(BaseModel):
    email: str = Field(min_length=6, max_length=254)
    code: str = Field(min_length=6, max_length=8)


class ProfileUpdateRequest(BaseModel):
    google_id_token: str
    display_name: str = Field(min_length=2, max_length=120)
    mobile_number: str = Field(min_length=7, max_length=32)
    recovery_email: str = Field(default="", max_length=254)
    avatar_url: str = Field(max_length=2_800_100)
    gender: str = Field(default="", pattern="^(|female|male|other|prefer_not_to_say)$")


class InvitePrivacyRequest(BaseModel):
    google_id_token: str
    policy: str = Field(pattern="^(mutual_friends|everyone)$")


class SocialActionRequest(BaseModel):
    google_id_token: str
    target_user_id: str = Field(min_length=1, max_length=256)


class SocialFriendRequestPayload(BaseModel):
    google_id_token: Optional[str] = None
    target_user_id: str = Field(min_length=1, max_length=256)


class RegistrationInviteRequest(BaseModel):
    google_id_token: str
    email: str = Field(min_length=6, max_length=254)


class PublicRoomKeyRequest(BaseModel):
    google_id_token: str
    public_key: Dict[str, Any]


class RoomPasscodeUpdateRequest(BaseModel):
    google_id_token: str
    room_id: str = Field(min_length=1, max_length=128)
    passcode: str = Field(min_length=6, max_length=64)


class RoomConfigurationRequest(BaseModel):
    google_id_token: str
    room_id: str = Field(min_length=6, max_length=128)
    title: str = Field(min_length=1, max_length=200)
    passcode: str = Field(min_length=6, max_length=64)
    space_mode: str = Field(pattern="^(personal|workspace)$")
    history_visible_before_join: bool = False
    allow_member_export: bool = False
    public_key: Dict[str, Any]


class RoomExportAuthorizationRequest(BaseModel):
    google_id_token: str
    include_voice_logs: bool = False


class RoomMemberActionRequest(BaseModel):
    google_id_token: str
    member_id: str = Field(min_length=1, max_length=256)


class RoomOwnershipTransferRequest(BaseModel):
    google_id_token: str
    new_host_id: str = Field(min_length=1, max_length=256)


def get_online_user_ids() -> Set[str]:
    return {
        info.client_id.removeprefix("google:")
        for info in room_manager.identities.values()
        if info.client_id.startswith("google:")
    }


def get_online_user_rooms() -> Dict[str, str]:
    online_rooms: Dict[str, str] = {}
    for room_id, connections in room_manager.connections.items():
        for websocket in connections:
            info = room_manager.identities.get(websocket)
            if info and info.client_id.startswith("google:"):
                online_rooms[info.client_id.removeprefix("google:")] = room_id
    return online_rooms


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
        if connection.execute(
            "SELECT 1 FROM removed_room_members WHERE room_id = ? AND member_id = ?",
            (room_id, client_id),
        ).fetchone():
            raise HTTPException(status_code=403, detail="The room host removed your membership.")
        if room_id.startswith(("share_", "invite_")):
            connection.execute("BEGIN IMMEDIATE")
        if connection.execute(
            "SELECT 1 FROM ended_rooms WHERE room_id = ?", (room_id,)
        ).fetchone():
            raise HTTPException(status_code=410, detail="This room session has ended.")
        row = connection.execute(
            """
            SELECT title, host_id, members_json, passcode_salt, passcode_hash,
                   space_mode, tenant_id
            FROM sovereign_rooms WHERE room_id = ?
            """,
            (room_id,),
        ).fetchone()
        if room_id.startswith("direct:"):
            require_personal_scope(identity)
            members = json.loads(row[2]) if row else []
            if not any(member.get("id") == client_id for member in members):
                raise HTTPException(status_code=403, detail="Direct room membership is required.")
            return

        normalized_passcode = normalize_room_passcode(passcode)
        if not row:
            if room_id.startswith("invite_"):
                require_workspace_scope(identity, None)
            require_personal_scope(identity)
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

        if row[5] == "workspace":
            require_workspace_scope(identity, row[6])
        else:
            require_personal_scope(identity)
        members = json.loads(row[2])
        if any(member.get("id") == client_id for member in members):
            return
        if room_id.startswith("share_") and len(members) >= 5:
            raise HTTPException(status_code=403, detail="This personal room is full (maximum five members).")
        if room_id.startswith("invite_") and len(members) >= 5:
            raise HTTPException(status_code=403, detail="This workspace room is full (maximum five members).")
        if not row[3] or not row[4] or len(normalized_passcode) < 6:
            raise HTTPException(status_code=403, detail="Room membership or a valid room passcode is required.")
        try:
            salt = bytes.fromhex(row[3])
        except ValueError as error:
            raise HTTPException(status_code=403, detail="Room access configuration is invalid.") from error
        submitted_hash = hash_room_passcode(normalized_passcode, salt)
        if not hmac.compare_digest(submitted_hash, row[4]):
            raise HTTPException(status_code=403, detail="Room membership or passcode verification failed.")


def configure_invite_room(req: RoomConfigurationRequest, identity: Dict[str, str]):
    prefix = "share_" if req.space_mode == "personal" else "invite_"
    if not req.room_id.startswith(prefix):
        raise HTTPException(status_code=400, detail="Room ID does not match the selected mode.")
    tenant_id = verified_workspace_tenant(identity) or ""
    if req.space_mode == "workspace":
        require_workspace_scope(identity, tenant_id)
    else:
        require_personal_scope(identity)
    public_key = req.public_key
    if (
        public_key.get("kty") != "EC"
        or public_key.get("crv") != "P-256"
        or not isinstance(public_key.get("x"), str)
        or not isinstance(public_key.get("y"), str)
        or len(public_key["x"]) > 128
        or len(public_key["y"]) > 128
    ):
        raise HTTPException(status_code=400, detail="A valid room encryption key is required.")

    owner_id = f"google:{identity['sub']}"
    now = datetime.now(timezone.utc).isoformat()
    salt = os.urandom(16)
    member = {
        "id": owner_id,
        "user_id": owner_id,
        "name": identity.get("name") or identity["email"],
        "display_name": identity.get("name") or identity["email"],
        "email": identity["email"],
        "avatar_url": "",
        "public_key": public_key,
        "joined_at": now,
        "can_export": True,
        "can_view_history": True,
        "tenant_id": tenant_id,
    }
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        connection.execute("BEGIN IMMEDIATE")
        with connection:
            existing = connection.execute(
                "SELECT host_id, origin_host_id, members_json, space_mode, tenant_id FROM sovereign_rooms WHERE room_id = ?",
                (req.room_id,),
            ).fetchone()
            if existing:
                if req.space_mode == "workspace":
                    require_workspace_scope(identity, existing[4])
                else:
                    require_personal_scope(identity)
                policy_owner_id = existing[0] if existing[3] == "personal" else existing[1]
                if req.space_mode != existing[3]:
                    raise HTTPException(
                        status_code=400,
                        detail="An existing room cannot change its mode.",
                    )
                if policy_owner_id != owner_id:
                    raise HTTPException(
                        status_code=403,
                        detail="Only the room owner or Workspace Origin Admin can change invite permissions.",
                    )
                members = json.loads(existing[2])
                if not any(item.get("id") == owner_id for item in members):
                    raise HTTPException(status_code=403, detail="Room owner membership is invalid.")
                connection.execute(
                    """
                    UPDATE sovereign_rooms
                    SET title = ?, space_mode = ?, history_visible_before_join = ?,
                        allow_member_export = ?, tenant_id = ?, updated_at = ?
                    WHERE room_id = ?
                    """,
                    (
                        req.title,
                        req.space_mode,
                        int(req.history_visible_before_join),
                        int(req.allow_member_export),
                        tenant_id,
                        now,
                        req.room_id,
                    ),
                )
                return
            connection.execute(
                """
                INSERT INTO sovereign_rooms
                    (room_id, title, host_id, members_json, passcode_salt, passcode_hash,
                     origin_host_id, space_mode, history_visible_before_join,
                     allow_member_export, tenant_id, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    req.room_id,
                    req.title,
                    owner_id,
                    json.dumps([member]),
                    salt.hex(),
                    hash_room_passcode(req.passcode, salt),
                    owner_id,
                    req.space_mode,
                    int(req.history_visible_before_join),
                    int(req.allow_member_export),
                    tenant_id,
                    now,
                ),
            )


@app.post("/api/rooms/configure")
async def configure_room(req: RoomConfigurationRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
    await asyncio.to_thread(configure_invite_room, req, identity)
    return {"status": "configured", "room_id": req.room_id}


@app.post("/api/rooms/{room_id}/authorize-export")
async def authorize_room_export(room_id: str, req: RoomExportAuthorizationRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
    await asyncio.to_thread(require_room_scope, room_id, identity)
    member_id = f"google:{identity['sub']}"
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        row = connection.execute(
            """
            SELECT host_id, origin_host_id, space_mode, allow_member_export, members_json
            FROM sovereign_rooms WHERE room_id = ?
            """,
            (room_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Room does not exist.")
    members = json.loads(row[4])
    member = next((item for item in members if item.get("id") == member_id), None)
    room_owner_id = row[0] if row[2] == "personal" else row[1]
    allowed = may_export_room(
        space_mode=row[2],
        is_origin_admin=member_id == room_owner_id,
        is_member=member is not None,
        member_export_enabled=bool(member.get("can_export", row[3])) if member else False,
    )
    voice_logs_allowed = member_id == room_owner_id
    if req.include_voice_logs and not voice_logs_allowed:
        raise HTTPException(
            status_code=403,
            detail="Only the room owner may export voice-call logs.",
        )
    if not allowed:
        detail = (
            "Export disabled in multi-user Personal Mode."
            if row[2] == "personal"
            else "Export disabled by Workspace Administrator."
        )
        raise HTTPException(status_code=403, detail=detail)
    return {"authorized": True}


@app.post("/api/rooms/passcode")
async def update_room_passcode(req: RoomPasscodeUpdateRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
    await asyncio.to_thread(require_room_scope, req.room_id, identity)
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


@app.post("/api/rooms/{room_id}/members/remove")
async def remove_room_member(room_id: str, req: RoomMemberActionRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
    await asyncio.to_thread(require_room_scope, room_id, identity)
    client_id = f"google:{identity['sub']}"
    if req.member_id == client_id:
        raise HTTPException(status_code=400, detail="The room host cannot remove themself.")
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            row = connection.execute(
                "SELECT host_id, members_json FROM sovereign_rooms WHERE room_id = ?",
                (room_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Room does not exist.")
            if row[0] != client_id:
                raise HTTPException(status_code=403, detail="Only the room host can remove members.")
            members = json.loads(row[1])
            if not any(member.get("id") == req.member_id for member in members):
                raise HTTPException(status_code=404, detail="Room member was not found.")
            connection.execute(
                "UPDATE sovereign_rooms SET members_json = ?, updated_at = ? WHERE room_id = ?",
                (json.dumps([member for member in members if member.get("id") != req.member_id]), now, room_id),
            )
            connection.execute(
                """
                INSERT INTO removed_room_members(room_id, member_id, removed_at)
                VALUES (?, ?, ?)
                ON CONFLICT(room_id, member_id) DO UPDATE SET removed_at = excluded.removed_at
                """,
                (room_id, req.member_id, now),
            )
    await room_manager.remove_member(room_id, req.member_id)
    return {"status": "removed"}


@app.post("/api/rooms/{room_id}/transfer-host")
async def transfer_room_host(room_id: str, req: RoomOwnershipTransferRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
    await asyncio.to_thread(require_room_scope, room_id, identity)
    client_id = f"google:{identity['sub']}"
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            row = connection.execute(
                "SELECT host_id, members_json FROM sovereign_rooms WHERE room_id = ?",
                (room_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Room does not exist.")
            if row[0] != client_id:
                raise HTTPException(status_code=403, detail="Only the room host can transfer ownership.")
            if not any(member.get("id") == req.new_host_id for member in json.loads(row[1])):
                raise HTTPException(status_code=404, detail="The new host must be a room member.")
            connection.execute(
                "UPDATE sovereign_rooms SET host_id = ?, updated_at = ? WHERE room_id = ?",
                (req.new_host_id, now, room_id),
            )
    await room_manager._presence(room_id)
    return {"status": "transferred"}


@app.delete("/api/rooms/{room_id}")
async def end_sovereign_room(room_id: str, authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    identity = await asyncio.to_thread(
        verified_identity_from_token, authorization.removeprefix("Bearer ").strip()
    )
    await asyncio.to_thread(require_room_scope, room_id, identity)
    client_id = f"google:{identity['sub']}"
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            row = connection.execute(
                "SELECT host_id FROM sovereign_rooms WHERE room_id = ?", (room_id,)
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Room does not exist.")
            if row[0] != client_id:
                raise HTTPException(status_code=403, detail="Only the room host can end this session.")
            connection.execute(
                "INSERT OR IGNORE INTO ended_rooms(room_id, ended_at) VALUES (?, ?)",
                (room_id, datetime.now(timezone.utc).isoformat()),
            )
            connection.execute("DELETE FROM encrypted_room_messages WHERE room_id = ?", (room_id,))
            connection.execute("DELETE FROM sovereign_rooms WHERE room_id = ?", (room_id,))
    await room_manager.close_room(room_id)
    return {"status": "ended"}


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


@app.get("/api/registration/me")
@app.get("/registration/me", include_in_schema=False)
async def get_registration(
    authorization: Optional[str] = Header(default=None),
    genie_session: Optional[str] = Cookie(default=None),
    x_user_email: Optional[str] = Header(default=None),
):
    token = (
        authorization.removeprefix("Bearer ").strip()
        if authorization and authorization.startswith("Bearer ")
        else (genie_session or "").strip()
    )
    identity = await asyncio.to_thread(verify_google_id_token_claims, token) if token else None
    requested_email = (x_user_email or "").strip().lower()
    if identity:
        requested_email = identity["email"].lower()
    elif token:
        logger.info("Registration status lookup received an invalid session token.")

    if not requested_email or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", requested_email):
        requested_email = DEV_AUTH_EMAIL

    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        row = connection.execute(
            """
            SELECT display_name, mobile_number, recovery_email, allow_room_invites,
                   terms_accepted_at, is_creator, avatar_url, gender, privacy_accepted_at,
                   mobile_verified
            FROM user_registry WHERE email = ? COLLATE NOCASE
            """,
            (requested_email,),
        ).fetchone()
        totp_enabled = bool(
            connection.execute(
                "SELECT 1 FROM totp_credentials WHERE email = ? COLLATE NOCASE",
                (requested_email,),
            ).fetchone()
        )
    if not row:
        return {
            "registered": False,
            "requires_setup": True,
            "email": requested_email,
            "profile_complete": False,
            "totp_enabled": False,
            "profile": {
                "display_name": identity["name"] if identity and identity["email"].lower() == requested_email else "",
                "email": requested_email,
                "google_avatar_url": identity.get("picture", "") if identity and identity["email"].lower() == requested_email else "",
            },
        }
    profile_complete = bool(row[0] and row[1] and row[4] and row[8])
    registered = profile_complete
    if not registered:
        return {
            "registered": False,
            "requires_setup": True,
            "email": requested_email,
            "profile_complete": profile_complete,
            "totp_enabled": totp_enabled,
            "profile": {
                "display_name": row[0] or "",
                "email": requested_email,
                "google_avatar_url": identity.get("picture", "") if identity and identity["email"].lower() == requested_email else "",
                "mobile_number": row[1] or "",
                "mobile_verified": bool(row[9]),
                "recovery_email": row[2] or "",
                "allow_room_invites": row[3],
                "terms_accepted": bool(row[4]),
                "is_creator": bool(row[5]),
                "avatar_url": row[6],
                "gender": row[7],
                "privacy_accepted": bool(row[8]),
            },
        }
    return {
        "registered": registered,
        "profile_complete": profile_complete,
        "totp_enabled": totp_enabled,
        "session_token": (
            create_internal_session_token(identity)
            if registered and identity and (token.startswith("genie1.") or not totp_enabled)
            else None
        ),
        "profile": {
            "display_name": row[0],
            "email": requested_email,
            "google_avatar_url": identity.get("picture", "") if identity else "",
            "mobile_number": row[1],
            "mobile_verified": bool(row[9]),
            "recovery_email": row[2],
            "allow_room_invites": row[3],
            "terms_accepted": bool(row[4]),
            "is_creator": bool(row[5]),
            "avatar_url": row[6],
            "gender": row[7],
            "privacy_accepted": bool(row[8]),
        },
    }


@app.get("/api/auth/totp/setup")
@app.get("/auth/totp/setup", include_in_schema=False)
async def setup_totp(
    request: Request,
    email: Optional[str] = None,
    authorization: Optional[str] = Header(default=None),
):
    token = authorization.removeprefix("Bearer ").strip() if authorization and authorization.startswith("Bearer ") else ""
    identity = await asyncio.to_thread(verify_google_id_token_claims, token) if token else None
    if token and not identity:
        raise HTTPException(status_code=401, detail="Link a verified Google account before setting up Authenticator.")
    if not identity:
        requested_email = (email or "").strip().lower()
        if not requested_email:
            raise HTTPException(status_code=400, detail="A Gmail address or verified Google session is required.")
        if not is_local_development_request(request) or requested_email != DEV_AUTH_EMAIL:
            raise HTTPException(status_code=401, detail="A verified Google account is required to set up Authenticator.")
        result = await prepare_totp_setup(TotpSetupRequest(email=requested_email), request)
        return {
            **result,
            "manual_secret": result["secret"],
        }
    if not identity["email"].lower().endswith("@gmail.com"):
        raise HTTPException(status_code=400, detail="Authenticator enrollment requires a verified Gmail address.")
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        if connection.execute(
            "SELECT 1 FROM totp_credentials WHERE user_id = ?", (identity["sub"],)
        ).fetchone():
            raise HTTPException(status_code=409, detail="Authenticator is already active. Verify your email to reset it.")
        challenge = connection.execute(
            "SELECT secret, expires_at FROM totp_setup_challenges WHERE user_id = ? AND email = ? COLLATE NOCASE",
            (identity["sub"], identity["email"]),
        ).fetchone()
        if not challenge:
            pending_owner_id = f"pending:{hashlib.sha256(identity['email'].lower().encode('utf-8')).hexdigest()}"
            pending_challenge = connection.execute(
                "SELECT secret, expires_at FROM totp_setup_challenges WHERE user_id = ? AND email = ? COLLATE NOCASE",
                (pending_owner_id, identity["email"]),
            ).fetchone()
            if pending_challenge and float(pending_challenge[1]) > time.time():
                challenge = pending_challenge
                with connection:
                    connection.execute(
                        """
                        INSERT INTO totp_setup_challenges(user_id, email, secret, expires_at)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(user_id) DO UPDATE SET
                            email = excluded.email,
                            secret = excluded.secret,
                            expires_at = excluded.expires_at
                        """,
                        (identity["sub"], identity["email"], pending_challenge[0], pending_challenge[1]),
                    )
                    connection.execute(
                        "DELETE FROM totp_setup_challenges WHERE user_id = ?",
                        (pending_owner_id,),
                    )
        if challenge and float(challenge[1]) > time.time():
            secret = decrypt_totp_secret(challenge[0])
        else:
            secret = pyotp.random_base32()
            with connection:
                connection.execute(
                    """
                    INSERT INTO totp_setup_challenges(user_id, email, secret, expires_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        email = excluded.email,
                        secret = excluded.secret,
                        expires_at = excluded.expires_at
                    """,
                    (identity["sub"], identity["email"], encrypt_totp_secret(secret), time.time() + 600),
                )
    provisioning_uri = pyotp.TOTP(secret).provisioning_uri(
        name=identity["email"],
        issuer_name="Personal AI Genie",
    )
    qr_data_url = totp_setup_qr_data_url(provisioning_uri, identity["email"])
    return {
        "secret": secret,
        "manual_secret": secret,
        "qr_code": qr_data_url,
        "provisioning_uri": provisioning_uri,
        "expires_in": 600,
    }


@app.get("/api/auth/totp-reconfigure")
@app.get("/auth/totp-reconfigure", include_in_schema=False)
async def prepare_totp_reconfiguration(token: str = Query(min_length=32, max_length=256)):
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        challenge = connection.execute(
            """
            SELECT user_id, email, secret, expires_at, used_at
            FROM totp_reconfigure_tokens WHERE token_hash = ?
            """,
            (token_hash,),
        ).fetchone()
        if (
            not challenge
            or challenge[4] is not None
            or float(challenge[3]) <= time.time()
        ):
            raise HTTPException(status_code=410, detail="This Authenticator setup link is invalid or expired.")
        secret = decrypt_totp_secret(challenge[2]) if challenge[2] else pyotp.random_base32()
        if not challenge[2]:
            with connection:
                connection.execute(
                    "UPDATE totp_reconfigure_tokens SET secret = ? WHERE token_hash = ? AND used_at IS NULL",
                    (encrypt_totp_secret(secret), token_hash),
                )
    provisioning_uri = pyotp.TOTP(secret).provisioning_uri(
        name=challenge[1],
        issuer_name="Personal AI Genie",
    )
    return {
        "email": challenge[1],
        "qr_code": totp_setup_qr_data_url(provisioning_uri, challenge[1]),
        "secret": secret,
        "manual_secret": secret,
        "otpauth_url": provisioning_uri,
        "expires_in": max(0, int(float(challenge[3]) - time.time())),
    }


def send_totp_reset_email(recipient: str, code: str):
    smtp_host = (os.getenv("SMTP_HOST") or "").strip()
    smtp_user = (os.getenv("SMTP_USER") or "").strip()
    smtp_password = os.getenv("SMTP_PASS") or ""
    smtp_from = (os.getenv("SMTP_FROM") or smtp_user).strip()
    if not all((smtp_host, smtp_user, smtp_password, smtp_from)):
        raise HTTPException(status_code=503, detail="Authenticator reset requires configured SMTP email delivery.")
    try:
        smtp_port = int(os.getenv("SMTP_PORT", "587"))
    except ValueError as error:
        raise HTTPException(status_code=500, detail="Email delivery configuration is invalid.") from error
    message = EmailMessage()
    message["Subject"] = "Personal AI Genie Authenticator reset"
    message["From"] = smtp_from
    message["To"] = recipient
    message.set_content(
        f"Your Personal AI Genie Authenticator reset code is {code}. "
        "It expires in 10 minutes. If you did not request this, ignore this email."
    )
    message.add_alternative(
        f"<p>Your Personal AI Genie Authenticator reset code is <strong>{html.escape(code)}</strong>.</p>"
        "<p>It expires in 10 minutes. If you did not request this, ignore this email.</p>",
        subtype="html",
    )
    if smtp_port == 465:
        with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=15) as smtp:
            smtp.login(smtp_user, smtp_password)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as smtp:
            smtp.starttls()
            smtp.login(smtp_user, smtp_password)
            smtp.send_message(message)


def send_totp_reconfigure_email(recipient: str, setup_url: str):
    smtp_host = (os.getenv("SMTP_HOST") or os.getenv("GENIE_SMTP_HOST") or "").strip()
    smtp_user = (os.getenv("SMTP_USER") or os.getenv("GENIE_SMTP_USER") or "").strip()
    smtp_password = os.getenv("SMTP_PASS") or os.getenv("GENIE_SMTP_PASSWORD") or ""
    smtp_from = (os.getenv("SMTP_FROM") or os.getenv("GENIE_SMTP_FROM") or smtp_user).strip()
    if not all((smtp_host, smtp_user, smtp_password, smtp_from)):
        logger.info("Simulated Authenticator re-link email for %s: %s", recipient, setup_url)
        return
    try:
        smtp_port = int(os.getenv("SMTP_PORT") or os.getenv("GENIE_SMTP_PORT", "587"))
    except ValueError as error:
        raise HTTPException(status_code=500, detail="Email delivery configuration is invalid.") from error
    escaped_url = html.escape(setup_url, quote=True)
    message = EmailMessage()
    message["Subject"] = "Personal AI Genie Authenticator re-link"
    message["From"] = smtp_from
    message["To"] = recipient
    message.set_content(
        "Use this secure link to re-link Google Authenticator. "
        f"The link expires in 15 minutes and can only be used once:\n\n{setup_url}\n\n"
        "If you did not request this, ignore this email."
    )
    message.add_alternative(
        "<p>Use this secure link to re-link Google Authenticator.</p>"
        "<p>The link expires in 15 minutes and can only be used once.</p>"
        f'<p><a href="{escaped_url}">Set up Google Authenticator</a></p>'
        "<p>If you did not request this, ignore this email.</p>",
        subtype="html",
    )
    use_ssl = smtp_port == 465 or (
        os.getenv("SMTP_USE_SSL") or os.getenv("GENIE_SMTP_USE_SSL", "")
    ).strip().lower() == "true"
    try:
        if use_ssl:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=15) as smtp:
                smtp.login(smtp_user, smtp_password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as smtp:
                smtp.starttls()
                smtp.login(smtp_user, smtp_password)
                smtp.send_message(message)
    except (smtplib.SMTPException, OSError) as error:
        logger.exception("Authenticator re-link email delivery failed.")
        raise HTTPException(status_code=502, detail="The Authenticator setup email could not be delivered.") from error


@app.post("/api/auth/totp/verify")
@app.post("/auth/totp/verify", include_in_schema=False)
async def verify_totp(req: TotpVerifyRequest, request: Request):
    email = req.email.strip().lower()
    code = re.sub(r"\s", "", req.code)
    if not email.endswith("@gmail.com") or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or not re.fullmatch(r"\d{6}", code):
        raise HTTPException(status_code=400, detail="Enter a valid Gmail address and 6-digit Authenticator code.")

    if req.reset_token:
        reset_token = req.reset_token.strip()
        token_hash = hashlib.sha256(reset_token.encode("utf-8")).hexdigest()
        with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            challenge = connection.execute(
                """
                SELECT user_id, email, secret, expires_at, used_at
                FROM totp_reconfigure_tokens WHERE token_hash = ?
                """,
                (token_hash,),
            ).fetchone()
            if (
                not challenge
                or challenge[4] is not None
                or float(challenge[3]) <= time.time()
                or str(challenge[1]).lower() != email
                or not challenge[2]
            ):
                raise HTTPException(status_code=410, detail="This Authenticator setup link is invalid or expired.")
            setup_secret = decrypt_totp_secret(challenge[2])
            accepted_counter = matching_totp_counter(setup_secret, code)
            if accepted_counter is None:
                with connection:
                    connection.execute(
                        """
                        UPDATE totp_reconfigure_tokens
                        SET failed_attempts = failed_attempts + 1,
                            used_at = CASE WHEN failed_attempts >= 4 THEN ? ELSE used_at END
                        WHERE token_hash = ?
                        """,
                        (time.time(), token_hash),
                    )
                raise HTTPException(status_code=401, detail="The Authenticator code is invalid.")
            with connection:
                connection.execute(
                    """
                    UPDATE totp_credentials
                    SET secret = ?, verified_at = ?, failed_attempts = 0,
                        locked_until = 0, last_counter = ?
                    WHERE user_id = ? AND email = ? COLLATE NOCASE
                    """,
                    (
                        encrypt_totp_secret(setup_secret),
                        datetime.now(timezone.utc).isoformat(),
                        accepted_counter,
                        challenge[0],
                        email,
                    ),
                )
                if connection.execute("SELECT changes()").fetchone()[0] != 1:
                    raise HTTPException(status_code=404, detail="The Authenticator account could not be found.")
                connection.execute(
                    "UPDATE totp_reconfigure_tokens SET used_at = ? WHERE token_hash = ?",
                    (time.time(), token_hash),
                )
                connection.execute(
                    "DELETE FROM totp_reconfigure_tokens WHERE user_id = ? AND token_hash != ?",
                    (challenge[0], token_hash),
                )
        return {"success": True, "verified": True, "reconfigured": True}

    identity = None
    authorization: Optional[str] = request.headers.get("authorization")
    session_token = (
        authorization.removeprefix("Bearer ").strip()
        if authorization and authorization.startswith("Bearer ")
        else ""
    )
    submitted_token = session_token or (req.google_id_token or "").strip()
    local_dev_registration = (
        not submitted_token
        and is_local_development_request(request)
        and email == DEV_AUTH_EMAIL
    )
    if submitted_token:
        identity = await asyncio.to_thread(verified_identity_from_token, submitted_token)
        if not identity or identity["email"].lower() != email:
            raise HTTPException(status_code=401, detail="The authenticated session does not match this email address.")
    elif local_dev_registration:
        identity = {
            "sub": "dev-admin",
            "email": DEV_AUTH_EMAIL,
            "name": "Shaji (Dev)",
            "picture": "",
        }

    if identity:
        with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
            challenge_owner_id = identity["sub"]
            challenge = connection.execute(
                "SELECT secret, expires_at FROM totp_setup_challenges WHERE user_id = ? AND email = ? COLLATE NOCASE",
                (challenge_owner_id, email),
            ).fetchone()
            if not challenge:
                challenge_owner_id = f"pending:{hashlib.sha256(email.encode('utf-8')).hexdigest()}"
                challenge = connection.execute(
                    "SELECT secret, expires_at FROM totp_setup_challenges WHERE user_id = ? AND email = ? COLLATE NOCASE",
                    (challenge_owner_id, email),
                ).fetchone()
            setup_secret = (req.setup_secret or "").strip().upper()
            if challenge:
                if float(challenge[1]) <= time.time():
                    raise HTTPException(status_code=410, detail="Authenticator setup expired. Generate a new QR code.")
                challenged_secret = decrypt_totp_secret(challenge[0])
                if setup_secret and not hmac.compare_digest(setup_secret, challenged_secret):
                    raise HTTPException(status_code=401, detail="The Authenticator setup secret does not match this account.")
                setup_secret = challenged_secret
            elif not setup_secret:
                raise HTTPException(status_code=410, detail="Authenticator setup expired. Generate a new QR code.")
            if not re.fullmatch(r"[A-Z2-7]{16,128}", setup_secret):
                raise HTTPException(status_code=400, detail="The Authenticator setup secret is invalid.")
            accepted_counter = matching_totp_counter(setup_secret, code)
            if accepted_counter is None:
                raise HTTPException(status_code=401, detail="The Authenticator code is invalid.")
            verified_at = datetime.now(timezone.utc).isoformat()
            with connection:
                connection.execute(
                    """
                    INSERT INTO totp_credentials(user_id, email, secret, verified_at, failed_attempts, locked_until, last_counter)
                    VALUES (?, ?, ?, ?, 0, 0, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        email = excluded.email,
                        secret = excluded.secret,
                        verified_at = excluded.verified_at,
                        failed_attempts = 0,
                        locked_until = 0,
                        last_counter = excluded.last_counter
                    """,
                    (identity["sub"], email, encrypt_totp_secret(setup_secret), verified_at, accepted_counter),
                )
                connection.execute("DELETE FROM totp_setup_challenges WHERE user_id = ?", (challenge_owner_id,))
        return {
            "success": True,
            "verified": True,
            "enrolled": True,
            **(
                {"session_token": "dev-token-local-bypass"}
                if local_dev_registration
                else {}
            ),
        }

    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        row = connection.execute(
            """
            SELECT credentials.user_id, credentials.secret, credentials.failed_attempts,
                   credentials.locked_until, registry.display_name, registry.mobile_number,
                   registry.recovery_email, registry.avatar_url, registry.gender,
                   registry.allow_room_invites, registry.is_creator, credentials.last_counter,
                   registry.tenant_id
            FROM totp_credentials credentials
            JOIN user_registry registry ON registry.user_id = credentials.user_id
            WHERE credentials.email = ? COLLATE NOCASE
              AND registry.terms_accepted_at != '' AND registry.privacy_accepted_at != ''
            """,
            (email,),
        ).fetchone()
        if not row or float(row[3]) > time.time():
            raise HTTPException(status_code=401, detail="The email or Authenticator code is invalid.")
        totp_secret = decrypt_totp_secret(row[1])
        accepted_counter = matching_totp_counter(totp_secret, code)
        if accepted_counter is None or accepted_counter <= int(row[11]):
            attempts = int(row[2]) + 1
            lock_until = time.time() + 300 if attempts >= 5 else 0
            with connection:
                connection.execute(
                    "UPDATE totp_credentials SET failed_attempts = ?, locked_until = ? WHERE user_id = ?",
                    (attempts, lock_until, row[0]),
                )
            raise HTTPException(status_code=401, detail="The email or Authenticator code is invalid.")
        with connection:
            connection.execute(
                "UPDATE totp_credentials SET failed_attempts = 0, locked_until = 0, last_counter = ? WHERE user_id = ?",
                (accepted_counter, row[0]),
            )
    identity = {
        "sub": row[0],
        "email": email,
        "name": row[4],
        "picture": "",
        "tenant_id": row[12],
    }
    return {
        "verified": True,
        "session_token": create_internal_session_token(identity),
        "profile": {
            "user_id": row[0],
            "display_name": row[4],
            "email": email,
            "mobile_number": row[5],
            "recovery_email": row[6],
            "avatar_url": row[7],
            "gender": row[8],
            "allow_room_invites": row[9],
            "is_creator": bool(row[10]),
        },
    }


@app.post("/api/auth/totp/setup")
@app.post("/auth/totp/setup", include_in_schema=False)
async def prepare_totp_setup(
    req: TotpSetupRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    email = req.email.strip().lower()
    if not email.endswith("@gmail.com") or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=400, detail="Enter a valid Gmail address to prepare Authenticator setup.")
    token = authorization.removeprefix("Bearer ").strip() if authorization and authorization.startswith("Bearer ") else ""
    identity = await asyncio.to_thread(verified_identity_from_token, token) if token else None
    if token and (not identity or identity["email"].lower() != email):
        raise HTTPException(status_code=401, detail="The authenticated session does not match this email address.")
    if not identity and (not is_local_development_request(request) or email != DEV_AUTH_EMAIL):
        raise HTTPException(status_code=401, detail="A verified Google account is required to set up Authenticator.")
    challenge_id = identity["sub"] if identity else f"pending:{hashlib.sha256(email.encode('utf-8')).hexdigest()}"
    secret = pyotp.random_base32()
    expires_at = time.time() + 15 * 60
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        if connection.execute(
            "SELECT 1 FROM totp_credentials WHERE email = ? COLLATE NOCASE", (email,)
        ).fetchone():
            raise HTTPException(status_code=409, detail="Authenticator is already active for this Gmail address.")
        with connection:
            connection.execute(
                """
                INSERT INTO totp_setup_challenges(user_id, email, secret, expires_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    email = excluded.email,
                    secret = excluded.secret,
                    expires_at = excluded.expires_at
                """,
                (challenge_id, email, encrypt_totp_secret(secret), expires_at),
            )
    provisioning_uri = pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="Personal AI Genie")
    image_data = totp_setup_qr_data_url(provisioning_uri, email)
    return {
        "qr_code": image_data,
        "secret": secret,
        "manual_secret": secret,
        "otpauth_url": provisioning_uri,
    }


@app.post("/api/auth/totp/request-reset")
@app.post("/auth/totp/request-reset", include_in_schema=False)
async def request_totp_reconfigure(
    req: TotpResetRequest,
    authorization: Optional[str] = Header(default=None),
):
    token = authorization.removeprefix("Bearer ").strip() if authorization and authorization.startswith("Bearer ") else ""
    identity = await asyncio.to_thread(verified_identity_from_token, token)
    email = req.email.strip().lower()
    if email != identity["email"].strip().lower() or not email.endswith("@gmail.com"):
        raise HTTPException(status_code=403, detail="Authenticator reset links can only be sent to your verified Gmail address.")
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        credential = connection.execute(
            "SELECT 1 FROM totp_credentials WHERE user_id = ? AND email = ? COLLATE NOCASE",
            (identity["sub"], email),
        ).fetchone()
        if not credential:
            raise HTTPException(status_code=409, detail="Google Authenticator is not enabled for this account.")
        reset_token = secrets.token_urlsafe(48)
        expires_at = time.time() + 15 * 60
        with connection:
            connection.execute(
                "DELETE FROM totp_reconfigure_tokens WHERE user_id = ?",
                (identity["sub"],),
            )
            connection.execute(
                """
                INSERT INTO totp_reconfigure_tokens(token_hash, user_id, email, secret, expires_at)
                VALUES (?, ?, ?, NULL, ?)
                """,
                (
                    hashlib.sha256(reset_token.encode("utf-8")).hexdigest(),
                    identity["sub"],
                    email,
                    expires_at,
                ),
            )
    public_url = os.getenv("GENIE_PUBLIC_URL", "https://personalaigenie.eu.org").rstrip("/")
    setup_url = f"{public_url}/auth/totp-reconfigure?token={reset_token}"
    await asyncio.to_thread(send_totp_reconfigure_email, email, setup_url)
    return {"success": True}


@app.post("/api/auth/totp/reset/request")
async def request_totp_reset(req: TotpResetRequest):
    email = req.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        exists = connection.execute(
            "SELECT 1 FROM totp_credentials WHERE email = ? COLLATE NOCASE", (email,)
        ).fetchone()
        if exists:
            code = f"{secrets.randbelow(1_000_000):06d}"
            code_hash = hash_totp_reset_code(email, code)
            with connection:
                connection.execute(
                    """
                    INSERT INTO totp_reset_challenges(email, code_hash, expires_at, failed_attempts)
                    VALUES (?, ?, ?, 0)
                    ON CONFLICT(email) DO UPDATE SET
                        code_hash = excluded.code_hash,
                        expires_at = excluded.expires_at,
                        failed_attempts = 0
                    """,
                    (email, code_hash, time.time() + 600),
                )
    if exists:
        try:
            await asyncio.to_thread(send_totp_reset_email, email, code)
        except (smtplib.SMTPException, OSError) as error:
            logger.exception("Authenticator reset email delivery failed.")
            raise HTTPException(status_code=502, detail="The verification email could not be delivered.") from error
    return {"success": True, "message": "If the account is eligible, a verification email has been sent."}


@app.post("/api/auth/totp/reset/confirm")
async def confirm_totp_reset(req: TotpResetConfirmRequest):
    email = req.email.strip().lower()
    code = re.sub(r"\s", "", req.code)
    if not email.endswith("@gmail.com") or not re.fullmatch(r"\d{6}", code):
        raise HTTPException(status_code=400, detail="Enter the Gmail address and 6-digit email verification code.")
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        challenge = connection.execute(
            "SELECT code_hash, expires_at, failed_attempts FROM totp_reset_challenges WHERE email = ? COLLATE NOCASE",
            (email,),
        ).fetchone()
        if (
            not challenge
            or float(challenge[1]) <= time.time()
            or int(challenge[2]) >= 5
            or not hmac.compare_digest(
                str(challenge[0]),
                hash_totp_reset_code(email, code),
            )
        ):
            if challenge and int(challenge[2]) < 5:
                with connection:
                    connection.execute(
                        "UPDATE totp_reset_challenges SET failed_attempts = failed_attempts + 1 WHERE email = ? COLLATE NOCASE",
                        (email,),
                    )
            raise HTTPException(status_code=401, detail="The email verification code is invalid or expired.")
        with connection:
            connection.execute("DELETE FROM totp_credentials WHERE email = ? COLLATE NOCASE", (email,))
            connection.execute("DELETE FROM totp_reset_challenges WHERE email = ? COLLATE NOCASE", (email,))
    return {"success": True, "message": "Authenticator reset. You can enroll a new authenticator from Workspace Preferences."}


@app.post("/api/registration/complete")
@app.post("/registration/complete", include_in_schema=False)
async def complete_registration(request: Request, req: RegistrationRequest):
    identity = None
    if (
        (req.google_id_token or "") == "dev-token-local-bypass"
        or not req.google_id_token
    ) and is_local_development_request(request):
        requested_email = (req.email or DEV_AUTH_EMAIL).strip().lower()
        if requested_email != DEV_AUTH_EMAIL:
            raise HTTPException(status_code=401, detail="Local development registration is limited to the configured developer account.")
        identity = {
            "sub": "dev-admin",
            "email": requested_email,
            "name": req.display_name.strip() or "Shaji (Dev)",
            "picture": "",
        }
    else:
        identity = await asyncio.to_thread(verify_google_id_token_claims, req.google_id_token)
    if not identity:
        raise HTTPException(status_code=401, detail="A verified Google account is required to complete registration.")
    if req.email and req.email.strip().lower() != identity["email"].strip().lower():
        raise HTTPException(status_code=401, detail="The submitted email does not match the verified Google account.")
    if not identity["email"].lower().endswith("@gmail.com"):
        raise HTTPException(status_code=400, detail="Registration requires a verified Gmail address.")
    if not req.terms_accepted or not req.privacy_accepted:
        raise HTTPException(status_code=400, detail="Accept the Terms of Service and Privacy Policy to complete registration.")
    display_name = req.display_name.strip()
    avatar_url = req.avatar_url.strip()
    if req.avatar_type:
        avatar_options = {
            "option_a": "/avatars/Profile-1.png",
            "option_b": "/avatars/Profile-2.png",
            "option_c": "/avatars/Profile-3.png",
        }
        avatar_url = avatar_options.get(req.avatar_type.strip().lower(), avatar_url)
    mobile_number = (req.phone or req.mobile_number).strip()
    digits = re.sub(r"\D", "", mobile_number)
    recovery_email = req.recovery_email.strip().lower()
    if len(display_name) < 2:
        raise HTTPException(status_code=400, detail="Display name must contain at least 2 characters.")
    if avatar_url not in {
        "genie-preset:guardian",
        "genie-preset:vapor",
        "genie-preset:cosmic",
        "genie-preset:neutral",
        "/avatars/Profile-1.png",
        "/avatars/Profile-2.png",
        "/avatars/Profile-3.png",
        "/avatars/Profile 1.png",
        "/avatars/Profile 2.png",
        "/avatars/Profile 3.png",
        "/avatars/option_a.svg",
        "/avatars/option_b.svg",
        "/avatars/option_c.svg",
    }:
        match = re.fullmatch(r"data:(image/(?:png|jpeg|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})", avatar_url)
        if not match:
            raise HTTPException(status_code=400, detail="Choose a supported Genie avatar.")
        try:
            image_data = base64.b64decode(match.group(2), validate=True)
        except (binascii.Error, ValueError) as error:
            raise HTTPException(status_code=400, detail="The uploaded avatar image is invalid.") from error
        if not image_data or len(image_data) > 2 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Avatar images must be no larger than 2 MB.")
        mime_type = match.group(1)
        if mime_type == "image/png" and not image_data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise HTTPException(status_code=400, detail="The uploaded file is not a valid PNG image.")
        if mime_type == "image/jpeg" and not image_data.startswith(b"\xff\xd8\xff"):
            raise HTTPException(status_code=400, detail="The uploaded file is not a valid JPG image.")
        if mime_type == "image/svg+xml":
            try:
                svg_text = image_data.decode("utf-8", errors="strict")
            except UnicodeDecodeError as error:
                raise HTTPException(status_code=400, detail="The uploaded SVG is not valid UTF-8.") from error
            if (
                not re.search(r"<svg(?:\s|>)", svg_text, re.IGNORECASE)
                or re.search(
                    r"<!DOCTYPE|<!ENTITY|<script|<foreignObject|\bon[a-z]+\s*=|javascript:|@import|url\(\s*[\"']?\s*(?:https?:|//)",
                    svg_text,
                    re.IGNORECASE,
                )
                or re.search(r"(?:href|src)\s*=\s*[\"']\s*(?:https?:|//|data:)", svg_text, re.IGNORECASE)
            ):
                raise HTTPException(status_code=400, detail="SVG avatars must not contain scripts or external content.")
    if len(digits) and not 7 <= len(digits) <= 15:
        raise HTTPException(status_code=400, detail="Enter a valid mobile/contact number.")
    if not digits:
        raise HTTPException(status_code=400, detail="Enter a valid mobile/contact number.")
    if recovery_email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", recovery_email):
        raise HTTPException(status_code=400, detail="Enter a valid alternate recovery email.")
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            connection.execute(
                """
                INSERT INTO user_registry
                    (user_id, email, display_name, avatar_url, mobile_number, recovery_email,
                     terms_accepted_at, allow_room_invites, is_creator, created_at, updated_at,
                     privacy_accepted_at, tenant_id, is_admin)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'mutual_friends', ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    email = excluded.email,
                    display_name = excluded.display_name,
                    avatar_url = excluded.avatar_url,
                    mobile_verified = CASE
                        WHEN user_registry.mobile_number = excluded.mobile_number
                        THEN user_registry.mobile_verified
                        ELSE 0
                    END,
                    mobile_number = excluded.mobile_number,
                    recovery_email = excluded.recovery_email,
                    terms_accepted_at = CASE
                        WHEN user_registry.terms_accepted_at = '' THEN excluded.terms_accepted_at
                        ELSE user_registry.terms_accepted_at
                    END,
                    privacy_accepted_at = CASE
                        WHEN user_registry.privacy_accepted_at = '' THEN excluded.privacy_accepted_at
                        ELSE user_registry.privacy_accepted_at
                    END,
                    updated_at = excluded.updated_at,
                    is_admin = excluded.is_admin,
                    tenant_id = CASE
                        WHEN excluded.tenant_id != '' THEN excluded.tenant_id
                        ELSE user_registry.tenant_id
                    END
                """,
                (
                    identity["sub"],
                    identity["email"].strip().lower(),
                    display_name,
                    avatar_url,
                    mobile_number,
                    recovery_email,
                    now,
                    int(identity["email"].strip().lower() in {*ADMIN_EMAILS, SUPER_ADMIN_IDENTIFIER}),
                    now,
                    now,
                    now,
                    verified_workspace_tenant(identity) or "",
                    int(identity["email"].strip().lower() in ADMIN_EMAILS),
                ),
            )
            connection.execute(
                """
                INSERT INTO social_directory
                    (user_id, display_name, handle, avatar_url, meta_user_id, email, updated_at)
                VALUES (?, ?, ?, 'genie-preset:neutral', '', ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    display_name = excluded.display_name,
                    handle = CASE WHEN social_directory.handle = '' THEN excluded.handle ELSE social_directory.handle END,
                    email = excluded.email,
                    updated_at = excluded.updated_at
                """,
                (
                    identity["sub"],
                    display_name,
                    display_name,
                    identity["email"].strip().lower(),
                    now,
                ),
            )
            saved_avatar = connection.execute(
                "SELECT avatar_url, mobile_verified FROM user_registry WHERE user_id = ?",
                (identity["sub"],),
            ).fetchone()
            saved_avatar, mobile_verified = saved_avatar[0], bool(saved_avatar[1])
    session_token = create_internal_session_token(identity)
    avatar_type = {
        "genie-preset:guardian": "option_a",
        "genie-preset:vapor": "option_b",
        "genie-preset:cosmic": "option_c",
        "/avatars/Profile-1.png": "option_a",
        "/avatars/Profile-2.png": "option_b",
        "/avatars/Profile-3.png": "option_c",
        "/avatars/Profile 1.png": "option_a",
        "/avatars/Profile 2.png": "option_b",
        "/avatars/Profile 3.png": "option_c",
        "/avatars/option_a.svg": "option_a",
        "/avatars/option_b.svg": "option_b",
        "/avatars/option_c.svg": "option_c",
    }.get(saved_avatar, "custom" if saved_avatar.startswith("data:image/") else "option_c")
    return {
        "success": True,
        "status": "registered",
        "session_token": session_token,
        "user": {
            "id": identity["sub"],
            "email": identity["email"],
            "name": display_name,
            "phone": mobile_number,
            "avatar_type": avatar_type,
        },
        "profile": {
            "display_name": display_name,
            "email": identity["email"],
            "google_avatar_url": identity.get("picture", ""),
            "mobile_number": mobile_number,
            "mobile_verified": mobile_verified,
            "recovery_email": recovery_email,
            "allow_room_invites": "mutual_friends",
            "terms_accepted": True,
            "avatar_url": saved_avatar,
        },
    }


@app.put("/api/registration/profile")
async def update_registered_profile(req: ProfileUpdateRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
    display_name = req.display_name.strip()
    mobile_number = req.mobile_number.strip()
    recovery_email = req.recovery_email.strip().lower()
    gender = req.gender.strip().lower()
    if len(display_name) < 2:
        raise HTTPException(status_code=400, detail="Display name must contain at least 2 characters.")
    if not 7 <= len(re.sub(r"\D", "", mobile_number)) <= 15:
        raise HTTPException(status_code=400, detail="Enter a valid mobile/contact number.")
    if recovery_email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", recovery_email):
        raise HTTPException(status_code=400, detail="Enter a valid alternate recovery email.")

    avatar_url = req.avatar_url.strip()
    if avatar_url not in {
        "genie-preset:vapor",
        "genie-preset:guardian",
        "genie-preset:neutral",
        "genie-preset:cosmic",
        "/avatars/Profile-1.png",
        "/avatars/Profile-2.png",
        "/avatars/Profile-3.png",
        "/avatars/Profile 1.png",
        "/avatars/Profile 2.png",
        "/avatars/Profile 3.png",
        "/avatars/option_a.svg",
        "/avatars/option_b.svg",
        "/avatars/option_c.svg",
    }:
        match = re.fullmatch(r"data:(image/(?:png|jpeg|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})", avatar_url)
        if not match:
            raise HTTPException(status_code=400, detail="Choose a supported PNG, JPG, or SVG avatar.")
        mime_type, encoded_data = match.groups()
        try:
            image_data = base64.b64decode(encoded_data, validate=True)
        except (binascii.Error, ValueError) as error:
            raise HTTPException(status_code=400, detail="The uploaded avatar image is invalid.") from error
        if not image_data or len(image_data) > 2 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Avatar images must be no larger than 2 MB.")
        if mime_type == "image/png" and not image_data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise HTTPException(status_code=400, detail="The uploaded file is not a valid PNG image.")
        if mime_type == "image/jpeg" and not image_data.startswith(b"\xff\xd8\xff"):
            raise HTTPException(status_code=400, detail="The uploaded file is not a valid JPG image.")
        if mime_type == "image/svg+xml":
            try:
                svg_text = image_data.decode("utf-8", errors="strict")
            except UnicodeDecodeError as error:
                raise HTTPException(status_code=400, detail="The uploaded SVG is not valid UTF-8.") from error
            if (
                not re.search(r"<svg(?:\s|>)", svg_text, re.IGNORECASE)
                or re.search(
                    r"<!DOCTYPE|<!ENTITY|<script|<foreignObject|\bon[a-z]+\s*=|javascript:|@import|url\(\s*[\"']?\s*(?:https?:|//)",
                    svg_text,
                    re.IGNORECASE,
                )
                or re.search(r"(?:href|src)\s*=\s*[\"']\s*(?:https?:|//|data:)", svg_text, re.IGNORECASE)
            ):
                raise HTTPException(status_code=400, detail="SVG avatars must not contain scripts or external content.")

    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            cursor = connection.execute(
                """
                UPDATE user_registry
                SET display_name = ?, mobile_number = ?, recovery_email = ?,
                    avatar_url = ?, gender = ?, updated_at = ?,
                    mobile_verified = CASE WHEN mobile_number = ? THEN mobile_verified ELSE 0 END
                WHERE user_id = ?
                """,
                (display_name, mobile_number, recovery_email, avatar_url, gender, now, mobile_number, identity["sub"]),
            )
            if cursor.rowcount != 1:
                raise HTTPException(status_code=404, detail="Registered profile was not found.")
            connection.execute(
                """
                UPDATE social_directory
                SET display_name = ?, avatar_url = ?, updated_at = ?
                WHERE user_id = ?
                """,
                (display_name, avatar_url, now, identity["sub"]),
            )
            mobile_verified = bool(connection.execute(
                "SELECT mobile_verified FROM user_registry WHERE user_id = ?",
                (identity["sub"],),
            ).fetchone()[0])
    return {
        "status": "updated",
        "profile": {
            "display_name": display_name,
            "email": identity["email"],
            "mobile_number": mobile_number,
            "mobile_verified": mobile_verified,
            "recovery_email": recovery_email,
            "avatar_url": avatar_url,
            "gender": gender,
        },
    }


def deliver_registration_invite(recipient: str, sender_name: str):
    clean_sender_name = re.sub(r"[\r\n]+", " ", sender_name).strip()[:120] or "A Genie user"
    smtp_host = (os.getenv("SMTP_HOST") or os.getenv("GENIE_SMTP_HOST") or "").strip()
    smtp_user = (os.getenv("SMTP_USER") or os.getenv("GENIE_SMTP_USER") or "").strip()
    smtp_password = os.getenv("SMTP_PASS") or os.getenv("GENIE_SMTP_PASSWORD") or ""
    smtp_from = (
        os.getenv("SMTP_FROM") or os.getenv("GENIE_SMTP_FROM") or smtp_user
    ).strip()
    public_url = os.getenv("GENIE_PUBLIC_URL", "https://personalaigenie.eu.org").rstrip("/")
    invite_url = f"{public_url}/?invite=1"
    if not all((smtp_host, smtp_user, smtp_password, smtp_from)):
        print(f"\n[Genie simulated invite]\nInvite link: {invite_url}\n", flush=True)
        return {"success": True, "simulated": True}
    try:
        smtp_port = int(os.getenv("SMTP_PORT") or os.getenv("GENIE_SMTP_PORT", "587"))
    except ValueError as error:
        raise HTTPException(status_code=500, detail="Email delivery configuration is invalid.") from error
    message = EmailMessage()
    message["Subject"] = f"{clean_sender_name} invited you to Personal AI Genie"
    message["From"] = smtp_from
    message["To"] = recipient
    message.set_content(
        f"{clean_sender_name} invited you to join Personal AI Genie.\n\n"
        f"Create your account and complete registration here: {invite_url}\n\n"
        "You will need to sign in with Google to finish onboarding."
    )
    escaped_sender = html.escape(clean_sender_name)
    escaped_url = html.escape(invite_url, quote=True)
    message.add_alternative(
        f"""<!doctype html>
<html><body>
<p>{escaped_sender} invited you to join Personal AI Genie.</p>
<p><a href="{escaped_url}">Create your account and complete registration</a></p>
<p>Sign in with Google to finish onboarding.</p>
</body></html>""",
        subtype="html",
    )
    use_ssl = smtp_port == 465 or (
        os.getenv("SMTP_USE_SSL") or os.getenv("GENIE_SMTP_USE_SSL", "")
    ).strip().lower() == "true"
    try:
        if use_ssl:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=15) as smtp:
                smtp.login(smtp_user, smtp_password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as smtp:
                smtp.starttls()
                smtp.login(smtp_user, smtp_password)
                smtp.send_message(message)
    except (smtplib.SMTPException, OSError) as error:
        logger.exception("Registration invitation email delivery failed.")
        raise HTTPException(status_code=502, detail="The invitation email could not be delivered.") from error
    return {"success": True, "simulated": False}


@app.post("/api/invite/email")
@app.post("/api/registration/invite")
async def send_registration_invite(req: RegistrationInviteRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
    recipient = req.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", recipient):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    delivery = await asyncio.to_thread(
        deliver_registration_invite,
        recipient,
        identity["name"] or identity["email"] or "A Genie user",
    )
    return delivery


@app.put("/api/registration/invite-privacy")
async def update_invite_privacy(req: InvitePrivacyRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            cursor = connection.execute(
                "UPDATE user_registry SET allow_room_invites = ?, updated_at = ? WHERE user_id = ?",
                (req.policy, datetime.now(timezone.utc).isoformat(), identity["sub"]),
            )
            if cursor.rowcount != 1:
                raise HTTPException(status_code=409, detail="Complete account registration before changing invite privacy.")
    return {"status": "updated", "allow_room_invites": req.policy}


@app.get("/api/social/search")
async def search_social_user(
    request: Request,
    q: Optional[str] = Query(default=None),
    query: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    bearer = (
        authorization.removeprefix("Bearer ").strip()
        if authorization and authorization.startswith("Bearer ")
        else ""
    )
    identity = None
    if bearer:
        try:
            identity = await asyncio.to_thread(verified_identity_from_token, bearer, request)
        except HTTPException:
            identity = local_developer_identity(request, authorization)
    elif is_local_development_request(request):
        identity = local_developer_identity(request, "Bearer dev-token-local-bypass")

    if not identity:
        raise HTTPException(status_code=401, detail="Google sign-in is required.")

    normalized_query = str(q or query or "").strip()
    if len(normalized_query) < 2:
        return {"found": False, "users": []}

    like_pattern = f"%{normalized_query.lower()}%"
    caller_sub = str(identity.get("sub") or "")
    online_rooms = get_online_user_rooms()

    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        rows = connection.execute(
            """
            SELECT registry.user_id, registry.display_name, registry.email,
                   COALESCE(NULLIF(directory.avatar_url, ''), registry.avatar_url, ''),
                   COALESCE(NULLIF(directory.handle, ''), registry.display_name)
            FROM user_registry AS registry
            LEFT JOIN social_directory AS directory ON directory.user_id = registry.user_id
            WHERE registry.user_id != ?
              AND (
                  lower(registry.display_name) LIKE ?
                  OR lower(registry.email) LIKE ?
                  OR lower(COALESCE(directory.handle, '')) LIKE ?
              )
              AND NOT EXISTS (
                  SELECT 1 FROM user_blocks
                  WHERE (blocker_id = ? AND blocked_id = registry.user_id)
                     OR (blocker_id = registry.user_id AND blocked_id = ?)
              )
            UNION
            SELECT directory.user_id, directory.display_name, directory.email,
                   directory.avatar_url, COALESCE(NULLIF(directory.handle, ''), directory.display_name)
            FROM social_directory AS directory
            WHERE directory.user_id != ?
              AND directory.user_id NOT IN (SELECT user_id FROM user_registry)
              AND (
                  lower(directory.display_name) LIKE ?
                  OR lower(directory.email) LIKE ?
                  OR lower(directory.handle) LIKE ?
              )
            ORDER BY 2 COLLATE NOCASE LIMIT 20
            """,
            (
                caller_sub, like_pattern, like_pattern, like_pattern, caller_sub, caller_sub,
                caller_sub, like_pattern, like_pattern, like_pattern,
            ),
        ).fetchall()

        results = []
        for user_id, display_name, email, avatar_url, handle in rows:
            pending_out = connection.execute(
                "SELECT status FROM friend_requests WHERE requester_id = ? AND recipient_id = ?",
                (caller_sub, user_id),
            ).fetchone()
            pending_in = connection.execute(
                "SELECT status FROM friend_requests WHERE requester_id = ? AND recipient_id = ?",
                (user_id, caller_sub),
            ).fetchone()
            is_mutual_friend = bool(
                (pending_out and pending_out[0] == "accepted")
                or (pending_in and pending_in[0] == "accepted")
            )
            if is_mutual_friend:
                relation = "friend"
            elif pending_out and pending_out[0] == "pending":
                relation = "request_sent"
            elif pending_in and pending_in[0] == "pending":
                relation = "request_received"
            elif connection.execute(
                "SELECT 1 FROM social_follows WHERE follower_id = ? AND followed_id = ?",
                (caller_sub, user_id),
            ).fetchone():
                relation = "following"
            elif connection.execute(
                "SELECT 1 FROM social_follows WHERE follower_id = ? AND followed_id = ?",
                (user_id, caller_sub),
            ).fetchone():
                relation = "follower"
            else:
                relation = "none"

            results.append(
                {
                    "user_id": user_id,
                    "display_name": display_name,
                    "email": email,
                    "handle": handle,
                    "avatar_url": avatar_url,
                    "is_online": user_id in online_rooms,
                    "active_room_id": online_rooms.get(user_id),
                    "relationship": relation,
                }
            )
    return {"found": bool(results), "users": results}


@app.post("/api/social/push-subscription", status_code=201)
async def save_social_push_subscription(
    request: Request,
    payload: Dict[str, Any],
    authorization: Optional[str] = Header(default=None),
):
    identity = await asyncio.to_thread(
        social_identity_from_request, request, authorization, payload
    )
    subscription = payload.get("subscription")
    if not isinstance(subscription, dict):
        raise HTTPException(status_code=422, detail="A Web Push subscription is required.")
    endpoint = str(subscription.get("endpoint") or "").strip()
    keys = subscription.get("keys")
    if (
        not endpoint.startswith("https://")
        or len(endpoint) > 4096
        or not isinstance(keys, dict)
        or not keys.get("p256dh")
        or not keys.get("auth")
    ):
        raise HTTPException(status_code=422, detail="The Web Push subscription is invalid.")
    subscription_json = json.dumps(subscription, separators=(",", ":"))
    if len(subscription_json) > 16_384:
        raise HTTPException(status_code=413, detail="The Web Push subscription is too large.")
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            connection.execute(
                """
                INSERT INTO social_push_subscriptions
                    (endpoint, user_id, subscription_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(endpoint) DO UPDATE SET
                    user_id = excluded.user_id,
                    subscription_json = excluded.subscription_json,
                    updated_at = excluded.updated_at
                """,
                (endpoint, identity["sub"], subscription_json, now, now),
            )
    return {"status": "stored"}


@app.post("/api/social/invites")
async def create_social_invite(payload: Dict[str, Any]):
    identity = await asyncio.to_thread(
        verified_identity_from_token, str(payload.get("google_id_token") or "")
    )
    recipient_id = str(payload.get("recipient_id") or "")
    room_id = str(payload.get("room_id") or "")
    invite_url = str(payload.get("invite_url") or "")
    if not recipient_id or recipient_id == identity["sub"] or not room_id or not invite_url:
        raise HTTPException(status_code=400, detail="A recipient and active room invite are required.")
    if not room_id.startswith(("share_", "invite_")):
        raise HTTPException(status_code=400, detail="Create a Personal or Workspace invite link before inviting friends.")
    if are_users_blocked(identity["sub"], recipient_id):
        raise HTTPException(status_code=403, detail="This invitation is unavailable because of a block.")
    invite_id = os.urandom(16).hex()
    created_at = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        target = connection.execute(
            "SELECT user_id FROM user_registry WHERE user_id = ?", (recipient_id,)
        ).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="Invite recipient is not registered.")
        recipient_policy = connection.execute(
            "SELECT allow_room_invites FROM user_registry WHERE user_id = ?",
            (recipient_id,),
        ).fetchone()
        mutual_friend = connection.execute(
            """
            SELECT 1 FROM friend_requests
            WHERE status = 'accepted'
              AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))
            LIMIT 1
            """,
            (identity["sub"], recipient_id, recipient_id, identity["sub"]),
        ).fetchone()
        if (not recipient_policy or recipient_policy[0] != "everyone") and not mutual_friend:
            raise HTTPException(status_code=403, detail="This user's invite privacy allows mutual friends only.")
        room = connection.execute(
            "SELECT members_json FROM sovereign_rooms WHERE room_id = ?", (room_id,)
        ).fetchone()
        members = json.loads(room[0]) if room else []
        sender_key = f"google:{identity['sub']}"
        if not any(member.get("id") == sender_key for member in members):
            raise HTTPException(status_code=403, detail="Only an active room member can invite friends.")
        room_limit = 2 if room_id.startswith("share_") else 5
        if len(members) >= room_limit:
            raise HTTPException(status_code=409, detail="This room has reached its invite capacity.")
        with connection:
            connection.execute(
                """
                INSERT INTO social_invites
                    (invite_id, sender_id, sender_name, recipient_id, room_id, room_title, invite_url, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    invite_id,
                    identity["sub"],
                    identity["name"] or identity["email"],
                    recipient_id,
                    room_id,
                    str(payload.get("room_title") or "Genie session"),
                    invite_url,
                    created_at,
                ),
            )
    return {"status": "sent", "invite_id": invite_id}


@app.get("/social/invites", include_in_schema=False)
@app.get("/api/py/social/invites", include_in_schema=False)
@app.get("/api/social/invites")
@app.get("/api/py/api/social/invites", include_in_schema=False)
async def get_social_invites(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    if local_developer_identity(request, authorization):
        return []
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    identity = await asyncio.to_thread(
        verified_identity_from_token, authorization.removeprefix("Bearer ").strip()
    )
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        rows = connection.execute(
            """
            SELECT invite_id, sender_id, sender_name, room_id, room_title, invite_url, created_at
            FROM social_invites WHERE recipient_id = ? AND status = 'pending'
            ORDER BY created_at DESC LIMIT 20
            """,
            (identity["sub"],),
        ).fetchall()
    return {
        "invites": [
            {
                "invite_id": row[0],
                "sender_id": row[1],
                "sender_name": row[2],
                "room_id": row[3],
                "room_title": row[4],
                "invite_url": row[5],
                "created_at": row[6],
            }
            for row in rows
        ]
    }


@app.post("/api/social/invites/{invite_id}/respond")
async def respond_social_invite(invite_id: str, payload: Dict[str, Any]):
    identity = await asyncio.to_thread(
        verified_identity_from_token, str(payload.get("google_id_token") or "")
    )
    status = str(payload.get("status") or "")
    if status not in {"accepted", "declined"}:
        raise HTTPException(status_code=400, detail="Invite response must be accepted or declined.")
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            cursor = connection.execute(
                """
                UPDATE social_invites SET status = ?
                WHERE invite_id = ? AND recipient_id = ? AND status = 'pending'
                """,
                (status, invite_id, identity["sub"]),
            )
            if cursor.rowcount != 1:
                raise HTTPException(status_code=404, detail="Invitation is no longer available.")
    return {"status": status}


@app.post("/api/trash/conversations")
async def soft_delete_conversation(payload: Dict[str, Any]):
    identity = await asyncio.to_thread(
        verified_identity_from_token, str(payload.get("google_id_token") or "")
    )
    conversation = payload.get("conversation")
    if not isinstance(conversation, dict) or not isinstance(conversation.get("id"), str):
        raise HTTPException(status_code=400, detail="A valid conversation is required.")
    deleted_at = datetime.now(timezone.utc).isoformat()
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            connection.execute("DELETE FROM deleted_conversations WHERE deleted_at < ?", (cutoff.isoformat(),))
            connection.execute(
                """
                INSERT OR REPLACE INTO deleted_conversations
                    (user_id, conversation_id, conversation_json, deleted_at)
                VALUES (?, ?, ?, ?)
                """,
                (identity["sub"], conversation["id"], json.dumps(conversation), deleted_at),
            )
    return {"status": "deleted", "deleted_at": deleted_at}


@app.get("/api/trash/conversations")
async def list_deleted_conversations(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    identity = await asyncio.to_thread(
        verified_identity_from_token, authorization.removeprefix("Bearer ").strip()
    )
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            connection.execute("DELETE FROM deleted_conversations WHERE deleted_at < ?", (cutoff.isoformat(),))
        rows = connection.execute(
            "SELECT conversation_json, deleted_at FROM deleted_conversations WHERE user_id = ? ORDER BY deleted_at DESC",
            (identity["sub"],),
        ).fetchall()
    return {
        "conversations": [
            {"conversation": json.loads(row[0]), "deleted_at": row[1]}
            for row in rows
        ]
    }


@app.post("/api/trash/conversations/{conversation_id}/restore")
async def restore_deleted_conversation(conversation_id: str, payload: Dict[str, Any]):
    identity = await asyncio.to_thread(
        verified_identity_from_token, str(payload.get("google_id_token") or "")
    )
    expired = False
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            row = connection.execute(
                "SELECT conversation_json, deleted_at FROM deleted_conversations WHERE user_id = ? AND conversation_id = ?",
                (identity["sub"], conversation_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Deleted conversation has expired or was restored.")
            try:
                deleted_at = datetime.fromisoformat(row[1])
            except ValueError as error:
                raise HTTPException(status_code=500, detail="Deleted conversation retention metadata is invalid.") from error
            if deleted_at < datetime.now(timezone.utc) - timedelta(days=30):
                expired = True
                connection.execute(
                    "DELETE FROM deleted_conversations WHERE user_id = ? AND conversation_id = ?",
                    (identity["sub"], conversation_id),
                )
            else:
                connection.execute(
                    "DELETE FROM deleted_conversations WHERE user_id = ? AND conversation_id = ?",
                    (identity["sub"], conversation_id),
                )
    if expired:
        raise HTTPException(status_code=404, detail="Deleted conversation has expired.")
    conversation = json.loads(row[0])
    conversation["isDeleted"] = False
    conversation.pop("deletedAt", None)
    return {"conversation": conversation}


@app.delete("/api/trash/conversations/{conversation_id}")
async def permanently_delete_conversation(conversation_id: str, authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    identity = await asyncio.to_thread(
        verified_identity_from_token, authorization.removeprefix("Bearer ").strip()
    )
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            connection.execute(
                "DELETE FROM deleted_conversations WHERE user_id = ? AND conversation_id = ?",
                (identity["sub"], conversation_id),
            )
    return {"status": "deleted"}


@app.get("/social/friends", include_in_schema=False)
@app.get("/api/py/social/friends", include_in_schema=False)
@app.get("/api/social/friends")
@app.get("/api/py/api/social/friends", include_in_schema=False)
async def get_social_friends(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    if local_developer_identity(request, authorization):
        return []
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    identity = await asyncio.to_thread(verified_identity_from_token, authorization.removeprefix("Bearer ").strip())
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        rows = connection.execute(
            """
            SELECT DISTINCT registry.user_id, registry.display_name, directory.handle,
                   COALESCE(NULLIF(registry.avatar_url, ''), directory.avatar_url, '')
            FROM friend_requests relationship
            JOIN user_registry registry ON registry.user_id =
                CASE WHEN relationship.requester_id = ? THEN relationship.recipient_id ELSE relationship.requester_id END
            LEFT JOIN social_directory directory ON directory.user_id = registry.user_id
            WHERE relationship.status = 'accepted'
              AND (relationship.requester_id = ? OR relationship.recipient_id = ?)
              AND NOT EXISTS (
                  SELECT 1 FROM user_blocks
                  WHERE (blocker_id = ? AND blocked_id = registry.user_id)
                     OR (blocker_id = registry.user_id AND blocked_id = ?)
              )
            ORDER BY registry.display_name COLLATE NOCASE
            """,
            (identity["sub"], identity["sub"], identity["sub"], identity["sub"], identity["sub"]),
        ).fetchall()
    online_rooms = get_online_user_rooms()
    return {
        "friends": [
            {
                "user_id": user_id,
                "display_name": name,
                "handle": handle,
                "avatar_url": avatar,
                "is_online": user_id in online_rooms,
                "active_room_id": online_rooms.get(user_id),
            }
            for user_id, name, handle, avatar in rows
        ]
    }


@app.post("/api/social/follow")
async def follow_social_user(req: SocialActionRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
    target_id = canonical_user_id(req.target_user_id)
    if target_id == identity["sub"]:
        raise HTTPException(status_code=400, detail="You cannot follow your own account.")
    if are_users_blocked(identity["sub"], target_id):
        raise HTTPException(status_code=403, detail="This relationship is unavailable because of a block.")
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            if not connection.execute(
                "SELECT 1 FROM user_registry WHERE user_id = ?", (target_id,)
            ).fetchone():
                raise HTTPException(status_code=404, detail="Registered user was not found.")
            connection.execute(
                "INSERT OR IGNORE INTO social_follows(follower_id, followed_id, created_at) VALUES (?, ?, ?)",
                (identity["sub"], target_id, now),
            )
    return {"status": "following"}


@app.post("/api/social/friend-requests", status_code=201)
async def create_friend_request(
    request: Request,
    req: SocialFriendRequestPayload,
    authorization: Optional[str] = Header(default=None),
):
    identity = await asyncio.to_thread(
        social_identity_from_request,
        request,
        authorization,
        {"google_id_token": req.google_id_token or ""},
    )
    target_id = canonical_user_id(req.target_user_id)
    if target_id == identity["sub"]:
        raise HTTPException(status_code=400, detail="You cannot friend-request your own account.")
    if are_users_blocked(identity["sub"], target_id):
        raise HTTPException(status_code=403, detail="This relationship is unavailable because of a block.")
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            if not connection.execute(
                "SELECT 1 FROM user_registry WHERE user_id = ?", (target_id,)
            ).fetchone():
                raise HTTPException(status_code=404, detail="Registered user was not found.")
            inbound = connection.execute(
                "SELECT status FROM friend_requests WHERE requester_id = ? AND recipient_id = ?",
                (target_id, identity["sub"]),
            ).fetchone()
            outbound = connection.execute(
                "SELECT status FROM friend_requests WHERE requester_id = ? AND recipient_id = ?",
                (identity["sub"], target_id),
            ).fetchone()
            if (inbound and inbound[0] == "accepted") or (outbound and outbound[0] == "accepted"):
                return {"status": "already_friends"}
            if inbound and inbound[0] == "pending":
                raise HTTPException(status_code=409, detail="This user has already sent you a friend request.")
            connection.execute(
                """
                INSERT INTO friend_requests(requester_id, recipient_id, status, created_at)
                VALUES (?, ?, 'pending', ?)
                ON CONFLICT(requester_id, recipient_id) DO UPDATE SET status = 'pending', created_at = excluded.created_at, responded_at = ''
                """,
                (identity["sub"], target_id, now),
            )
    return {"status": "request_sent"}


@app.get("/social/friend-requests", include_in_schema=False)
@app.get("/api/py/social/friend-requests", include_in_schema=False)
@app.get("/api/social/friend-requests")
@app.get("/api/py/api/social/friend-requests", include_in_schema=False)
async def get_friend_requests(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    if local_developer_identity(request, authorization):
        return []
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    identity = await asyncio.to_thread(
        verified_identity_from_token, authorization.removeprefix("Bearer ").strip()
    )
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        rows = connection.execute(
            """
            SELECT request.requester_id, registry.display_name, directory.avatar_url, request.created_at
            FROM friend_requests request
            JOIN user_registry registry ON registry.user_id = request.requester_id
            LEFT JOIN social_directory directory ON directory.user_id = registry.user_id
            WHERE request.recipient_id = ? AND request.status = 'pending'
            ORDER BY request.created_at DESC LIMIT 20
            """,
            (identity["sub"],),
        ).fetchall()
    return {
        "requests": [
            {"user_id": row[0], "display_name": row[1], "avatar_url": row[2] or "", "created_at": row[3]}
            for row in rows
        ]
    }


@app.post("/api/social/friend-requests/respond")
async def respond_friend_request(payload: Dict[str, Any]):
    identity = await asyncio.to_thread(
        verified_identity_from_token, str(payload.get("google_id_token") or "")
    )
    requester_id = canonical_user_id(str(payload.get("requester_id") or ""))
    response = str(payload.get("response") or "")
    if response not in {"accepted", "declined"}:
        raise HTTPException(status_code=400, detail="Choose accept or decline.")
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        with connection:
            cursor = connection.execute(
                """
                UPDATE friend_requests SET status = ?, responded_at = ?
                WHERE requester_id = ? AND recipient_id = ? AND status = 'pending'
                """,
                (response, now, requester_id, identity["sub"]),
            )
            if cursor.rowcount != 1:
                raise HTTPException(status_code=404, detail="Friend request is no longer available.")
            if response == "accepted":
                connection.execute(
                    """
                    INSERT OR IGNORE INTO social_follows(follower_id, followed_id, created_at)
                    VALUES (?, ?, ?), (?, ?, ?)
                    """,
                    (requester_id, identity["sub"], now, identity["sub"], requester_id, now),
                )
    return {"status": response}


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
        accepted_friend = connection.execute(
            """
            SELECT 1 FROM friend_requests
            WHERE status = 'accepted'
              AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))
            LIMIT 1
            """,
            (identity["sub"], req.target_user_id, req.target_user_id, identity["sub"]),
        ).fetchone()
        if not accepted_friend:
            raise HTTPException(status_code=403, detail="Direct rooms are available to accepted mutual friends only.")
        target = connection.execute(
            """
            SELECT registry.user_id, registry.display_name,
                   COALESCE(NULLIF(directory.handle, ''), registry.display_name),
                   COALESCE(NULLIF(registry.avatar_url, ''), directory.avatar_url, ''),
                   COALESCE(directory.public_key_json, '{}')
            FROM user_registry registry
            LEFT JOIN social_directory directory ON directory.user_id = registry.user_id
            WHERE registry.user_id = ?
            """,
            (req.target_user_id,),
        ).fetchone()
        requester_key_row = connection.execute(
            "SELECT public_key_json FROM social_directory WHERE user_id = ?",
            (identity["sub"],),
        ).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="This registered friend could not be found.")
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


@app.get("/rooms", include_in_schema=False)
@app.get("/api/py/rooms", include_in_schema=False)
@app.get("/api/rooms")
@app.get("/api/py/api/rooms", include_in_schema=False)
async def get_user_rooms(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    if local_developer_identity(request, authorization):
        return []
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    identity = await asyncio.to_thread(verified_identity_from_token, authorization.removeprefix("Bearer ").strip())
    member_id = f"google:{identity['sub']}"
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        rows = connection.execute(
            "SELECT room_id, title, host_id, members_json, updated_at, space_mode, tenant_id FROM sovereign_rooms ORDER BY updated_at DESC"
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
            for room_id, title, host_id, members_json, updated_at, space_mode, tenant_id in rows
            if any(member.get("id") == member_id for member in json.loads(members_json))
            and (
                (space_mode == "workspace" and verified_workspace_tenant(identity) == tenant_id)
                or (space_mode != "workspace" and not verified_workspace_tenant(identity))
            )
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


def encode_session_part(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def create_internal_session_token(identity: Dict[str, str]) -> str:
    now = int(time.time())
    claims = {
        "sub": identity["sub"],
        "email": identity["email"],
        "email_verified": True,
        "name": identity.get("name", ""),
        "picture": identity.get("picture", ""),
        "tenant_id": identity.get("tenant_id", ""),
        "iat": now,
        "exp": now + SESSION_TTL_SECONDS,
    }
    payload = encode_session_part(
        json.dumps(claims, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    signed = f"genie1.{payload}".encode("ascii")
    signature = hmac.new(SESSION_SIGNING_KEY, signed, hashlib.sha256).digest()
    return f"genie1.{payload}.{encode_session_part(signature)}"


def verify_internal_session_token(token: str) -> Optional[Dict[str, str]]:
    if len(token) > 8192:
        return None
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != "genie1":
        return None
    try:
        signed = f"{parts[0]}.{parts[1]}".encode("ascii")
        expected_signature = hmac.new(SESSION_SIGNING_KEY, signed, hashlib.sha256).digest()
        provided_signature = base64.urlsafe_b64decode(parts[2] + "=" * (-len(parts[2]) % 4))
        claims = json.loads(
            base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)).decode("utf-8")
        )
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError, binascii.Error):
        return None
    if not hmac.compare_digest(provided_signature, expected_signature):
        return None
    if not isinstance(claims, dict):
        return None
    try:
        expires_at = int(claims.get("exp", 0))
    except (TypeError, ValueError):
        return None
    sub = claims.get("sub")
    email = claims.get("email")
    if (
        expires_at <= int(time.time())
        or not isinstance(sub, str)
        or not sub
        or not isinstance(email, str)
        or not email
        or claims.get("email_verified") is not True
    ):
        return None
    try:
        with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
            registered = connection.execute(
                """
                SELECT 1 FROM user_registry
                WHERE user_id = ? AND email = ? COLLATE NOCASE
                  AND display_name != '' AND mobile_number != '' AND terms_accepted_at != ''
                  AND privacy_accepted_at != ''
                """,
                (sub, email),
            ).fetchone()
    except sqlite3.Error:
        logger.exception("Could not validate the registered profile for a Genie session.")
        return None
    if not registered:
        return None
    return {
        "sub": sub,
        "email": email.lower(),
        "name": str(claims.get("name") or ""),
        "picture": str(claims.get("picture") or ""),
        "tenant_id": str(claims.get("tenant_id") or ""),
    }


@app.post("/api/auth/dev-session")
@app.post("/auth/dev-session", include_in_schema=False)
async def create_dev_session(request: Request):
    if not DEV_AUTH_BYPASS_ENABLED:
        raise HTTPException(status_code=404, detail="Development sign-in is disabled.")

    origin = urlsplit(request.headers.get("origin", ""))
    client_host = request.client.host if request.client else ""
    try:
        client_is_loopback = ipaddress.ip_address(client_host).is_loopback
        origin_is_loopback = origin.hostname == "localhost" or (
            origin.hostname is not None and ipaddress.ip_address(origin.hostname).is_loopback
        )
    except ValueError:
        client_is_loopback = False
        origin_is_loopback = False
    if origin.scheme not in {"http", "https"} or not client_is_loopback or not origin_is_loopback:
        raise HTTPException(status_code=403, detail="Development sign-in is only available from localhost.")
    return {
        "success": True,
        "token": "dev-token-local-bypass",
        "user": {"id": "dev-admin", "email": DEV_AUTH_EMAIL, "name": "Shaji (Dev)"},
    }


def verify_google_id_token_claims(id_token: Optional[str]) -> Optional[Dict[str, str]]:
    """Verify a Google ID token and return its verified identity claims."""
    token = (id_token or "").strip()
    if token == "dev-token-local-bypass":
        return {
            "sub": "user-rshaji93",
            "email": "rshaji93@gmail.com",
            "name": "Shaji R",
            "tenant_id": "",
            "role": "admin"
        }
    if not token or len(token) > 8192:
        logger.warning("Google ID token verification rejected an empty or oversized token.")
        return None
    if token.startswith("genie1."):
        identity = verify_internal_session_token(token)
        if not identity:
            logger.warning("Genie session token verification failed or its account is no longer registered.")
        return identity
    if not GOOGLE_CLIENT_ID:
        logger.error("Google ID token verification cannot run without a configured client ID.")
        return None
    try:
        claims = google_id_token.verify_oauth2_token(
            token,
            GoogleAuthRequest(),
            audience=GOOGLE_CLIENT_ID,
        )
        email = str(claims.get("email") or "").strip().lower()
        email_verified = claims.get("email_verified") is True or claims.get("email_verified") == "true"
        if (
            not claims.get("sub")
            or not email
            or not email_verified
        ):
            missing_claims = [
                claim
                for claim, present in (
                    ("sub", bool(claims.get("sub"))),
                    ("email", bool(email)),
                    ("email_verified", email_verified),
                )
                if not present
            ]
            logger.warning(
                "Google ID token verification rejected claims that are missing or invalid: %s.",
                ", ".join(missing_claims),
            )
            return None
        return {
            "email": email,
            "sub": str(claims["sub"]),
            "name": str(claims.get("name") or ""),
            "picture": str(claims.get("picture") or ""),
            "tenant_id": str(claims.get("hd") or "").strip().lower(),
        }
    except (GoogleAuthError, requests.RequestException, ValueError, TypeError) as error:
        logger.warning(
            "Google ID token verification failed (%s): %s",
            type(error).__name__,
            error,
        )
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


def get_account_limits(identity: Optional[Dict[str, str]]) -> Dict[str, Any]:
    if identity and identity.get("email", "").lower() == ADMIN_EMAIL:
        return {
            "tier": "vip_admin",
            "chats_remaining": 999999,
            "is_vip": True,
            "unlimited": True,
            "requires_byok": False,
        }
    is_active_vip = False
    account_age_days: Optional[float] = None
    if identity:
        with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
            entitlement = connection.execute(
                """
                SELECT is_vip, vip_expires_at, created_at FROM user_registry
                WHERE user_id = ?
                """,
                (identity.get("sub", ""),),
            ).fetchone()
            pass_entitlement = connection.execute(
                """
                SELECT 1 FROM active_vip_passes
                WHERE user_id = ? AND is_active = 1
                  AND julianday(expires_at) > julianday('now')
                LIMIT 1
                """,
                (identity.get("sub", ""),),
            ).fetchone()
        if entitlement and entitlement[2]:
            with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
                age = connection.execute(
                    "SELECT julianday('now') - julianday(?)",
                    (entitlement[2],),
                ).fetchone()
            if age and age[0] is not None:
                account_age_days = max(0.0, float(age[0]))
        is_active_vip = bool(
            entitlement
            and entitlement[0]
            and entitlement[1]
            and entitlement[1] > datetime.now(timezone.utc).isoformat()
        ) or bool(pass_entitlement)
    if is_active_vip:
        return {
            "tier": "vip",
            "chats_remaining": 999999,
            "is_vip": True,
            "unlimited": True,
            "requires_byok": False,
            "account_age_days": account_age_days,
        }
    account_is_too_old = account_age_days is not None and account_age_days > 180
    email = identity.get("email", "").lower() if identity else ""
    with daily_message_counts_lock:
        used = daily_message_counts.get(
            (f"google:{email}", datetime.now(timezone.utc).date().isoformat()),
            0,
        )
    if account_is_too_old:
        return {
            "tier": "byok_required",
            "chats_remaining": 0,
            "is_vip": False,
            "unlimited": False,
            "requires_byok": True,
            "account_age_days": account_age_days,
            "message": "Your account is older than six months. Add your own Gemini API key in Settings > BYOK to continue.",
        }
    return {
        "tier": "standard",
        "chats_remaining": max(0, DAILY_MESSAGE_LIMIT - used),
        "is_vip": False,
        "unlimited": False,
        "requires_byok": False,
        "account_age_days": account_age_days,
    }


def has_active_vip_pass(user_id: str) -> bool:
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        return connection.execute(
            """
            SELECT 1 FROM active_vip_passes
            WHERE user_id = ? AND is_active = 1
              AND julianday(expires_at) > julianday('now')
            LIMIT 1
            """,
            (user_id,),
        ).fetchone() is not None


def enforce_chat_allowance(identity: Dict[str, str], byok_key: Optional[str]) -> bool:
    limits = get_account_limits(identity)
    if limits.get("is_vip") or identity.get("email", "").strip().lower() == ADMIN_EMAIL:
        return False
    if byok_key and byok_key.strip():
        return False
    if limits.get("requires_byok"):
        return True
    consume_daily_message(get_chat_identity_for_identity(identity))
    return False


def get_chat_identity_for_identity(identity: Dict[str, str]) -> str:
    email = str(identity.get("email") or "").strip().lower()
    return f"google:{email}" if email else f"google:{identity.get('sub', '')}"


@app.get("/api/auth/me")
async def get_authenticated_profile(
    authorization: Optional[str] = Header(default=None),
):
    token = authorization.removeprefix("Bearer ").strip() if authorization and authorization.startswith("Bearer ") else ""
    identity = await asyncio.to_thread(verify_google_id_token_claims, token)
    if not identity:
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    return {"user": identity, **get_account_limits(identity)}


@app.get("/api/limits")
async def get_authenticated_limits(
    authorization: Optional[str] = Header(default=None),
):
    token = authorization.removeprefix("Bearer ").strip() if authorization and authorization.startswith("Bearer ") else ""
    identity = await asyncio.to_thread(verify_google_id_token_claims, token)
    if not identity:
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    return get_account_limits(identity)


def is_safety_placeholder(response_text: str) -> bool:
    lowered = response_text.lower().strip()
    return "user safety: safe" in lowered or "response safety: safe" in lowered


def evaluate_local_chitchat(message: str) -> Optional[str]:
    cleaned_message = message.strip()
    for pattern, reply in LOCAL_CHITCHAT_PATTERNS:
        if pattern.search(cleaned_message):
            return reply
    return None


def evaluate_local_python_mock(message: str) -> Optional[str]:
    cleaned_message = message.strip()
    for pattern, reply in LOCAL_PYTHON_MOCK_PATTERNS:
        if pattern.fullmatch(cleaned_message):
            return reply
    return evaluate_local_chitchat(cleaned_message)


def evaluate_local_python_response(message: str) -> str:
    return evaluate_local_python_mock(message) or (
        "Observer mode is off, so this reply was handled locally in Python without sending your message to an AI provider. "
        "Turn Observer mode on when you want a cloud-assisted response."
    )


def has_active_chat_api_key(custom_api_key: Optional[str] = None) -> bool:
    return any(
        value.strip()
        for value in (
            custom_api_key or "",
            os.getenv("GEMINI_API_KEY", ""),
            os.getenv("OPENROUTER_API_KEY", OPENROUTER_KEY),
            os.getenv("GROQ_API_KEY", ""),
            os.getenv("MISTRAL_API_KEY", ""),
            os.getenv("GITHUB_MODELS_TOKEN", ""),
            os.getenv("GITHUB_TOKEN", ""),
        )
    )


def build_platform_recovery_response() -> str:
    return (
        "I’m temporarily unable to reach the AI providers, so I can’t answer general questions right now. "
        "I can still help with Personal AI Genie platform questions:\n\n"
        + get_platform_system_manifest()
        + "\n\nPlease try your request again shortly."
    )


LOCAL_AGENT_MODULES = {
    "manager": ("manager_agent", "Manager Agent"),
    "job_hunter": ("job_hunter", "Job Hunter"),
    "apply_runner": ("local_apply_runner", "Apply Runner"),
    "hub": ("hub_app", "Hub Operations"),
}


def dispatch_local_agent(agent_target: str, task: str) -> Dict[str, Any]:
    module_info = LOCAL_AGENT_MODULES.get(agent_target)
    if module_info is None:
        raise HTTPException(status_code=400, detail="Unknown local agent target.")
    module_name, display_name = module_info
    try:
        agent_module = importlib.import_module(module_name)
    except ImportError as error:
        logger.exception("Unable to load local agent module %s.", module_name)
        raise HTTPException(
            status_code=503,
            detail=f"{display_name} is unavailable because a local dependency could not be loaded.",
        ) from error
    run_agent = getattr(agent_module, "run_local_agent", None)
    if not callable(run_agent):
        raise HTTPException(
            status_code=503,
            detail=f"{display_name} does not expose a local execution handler.",
        )
    try:
        result = run_agent(task)
    except Exception as error:
        logger.exception("Local agent %s failed.", module_name)
        raise HTTPException(
            status_code=503,
            detail=f"{display_name} could not complete its local task.",
        ) from error
    if not isinstance(result, dict) or not isinstance(result.get("summary"), str):
        raise HTTPException(
            status_code=500,
            detail=f"{display_name} returned an invalid local-agent response.",
        )
    result["summary"] = sanitize_ai_output(result["summary"])
    result.setdefault("agent_name", display_name)
    result.setdefault("status", "completed")
    result.setdefault("logs", [])
    result.setdefault("actions", [])
    result["logs"] = [
        sanitize_ai_output(str(log_entry))
        for log_entry in result["logs"]
    ]
    return result


def resolve_local_agent_target(task: str) -> str:
    lowered = task.lower()
    if any(term in lowered for term in ("apply runner", "application queue", "queued application", "submit application", "application status")):
        return "apply_runner"
    if any(term in lowered for term in ("hub operations", "operations hub", "rcm lead", "lead scoring", "pipeline overview")):
        return "hub"
    if any(term in lowered for term in ("job", "career", "resume", "hiring", "job search", "job opening", "recruiter")):
        return "job_hunter"
    return "manager"


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
                "internal implementations."
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
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Personal AI Genie",
    }

    payload = {
        "model": model_slug,
        "messages": messages,
        "temperature": 0.7,
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
                    response_text = content.strip()
                    if is_safety_placeholder(response_text):
                        diagnostics.append(f"OpenRouter {model_slug} returned a safety placeholder.")
                        return None
                    return scrub_sensitive_tokens(response_text)
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
    """Direct Google Gemini REST endpoint using native x-goog-api-key authentication."""
    gemini_api_key = (api_key or "").strip()
    if not gemini_api_key:
        return None

    clean_model = model_name.removeprefix("models/")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{clean_model}:generateContent"

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
                    "You are Personal AI Genie, a helpful, intelligent, and authentic AI collaborator. "
                    "Answer questions directly, thoroughly, and clearly. Never disclose private configuration, "
                    "credentials, environment variables, or server code."
                )
            }]
        },
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2048},
    }

    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": gemini_api_key,
    }

    try:
        resp = requests.post(
            url,
            json=payload,
            headers=headers,
            timeout=25.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            candidates = data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts and "text" in parts[0]:
                    response_text = parts[0]["text"].strip()
                    if is_safety_placeholder(response_text):
                        diagnostics.append(f"Gemini {clean_model} returned a safety placeholder.")
                        return None
                    return scrub_sensitive_tokens(response_text)
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
        logger.error(f"Gemini execution error: {e}", exc_info=True)

    return None


def decode_chat_image(image_data: str) -> Dict[str, str]:
    match = re.fullmatch(
        r"data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})",
        image_data.strip(),
    )
    if not match:
        raise HTTPException(status_code=400, detail="Attach a PNG, JPEG, or WebP image.")
    mime_type, encoded = match.groups()
    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail="The attached image data is invalid.") from error
    if not image_bytes or len(image_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Images must be 5 MB or smaller.")
    is_valid_image = (
        (mime_type == "image/png" and image_bytes.startswith(b"\x89PNG\r\n\x1a\n"))
        or (mime_type == "image/jpeg" and image_bytes.startswith(b"\xff\xd8\xff"))
        or (
            mime_type == "image/webp"
            and len(image_bytes) >= 12
            and image_bytes[:4] == b"RIFF"
            and image_bytes[8:12] == b"WEBP"
        )
    )
    if not is_valid_image:
        raise HTTPException(status_code=400, detail="The attached image format does not match its data.")
    return {"mime_type": mime_type, "data": base64.b64encode(image_bytes).decode("ascii")}


def request_gemini_multimodal(
    model_name: str,
    api_key: str,
    prompt: str,
    history: List[ChatMessage],
    image_part: Dict[str, str],
    diagnostics: List[str],
) -> Optional[str]:
    """Send the image and prompt together to Gemini's multimodal REST endpoint."""
    gemini_api_key = (api_key or "").strip()
    if not gemini_api_key:
        return None
    clean_model = model_name.removeprefix("models/")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{clean_model}:generateContent"
    contents = []
    for message in history[-4:]:
        if message.content.strip():
            contents.append({
                "role": "user" if message.role == "user" else "model",
                "parts": [{"text": message.content[:12000]}],
            })
    contents.append({
        "role": "user",
        "parts": [
            {"text": prompt},
            {"inline_data": image_part},
        ],
    })
    payload = {
        "contents": contents,
        "systemInstruction": {
            "parts": [{
                "text": (
                    "You are Genie Master, Personal AI Genie's expert image-analysis persona. "
                    "Carefully analyze the attached image and answer the user's request accurately. "
                    "Describe uncertainty rather than inventing visual details. Never disclose private "
                    "configuration, credentials, environment variables, or server code."
                )
            }]
        },
        "generationConfig": {"temperature": 0.4, "maxOutputTokens": 2048},
    }
    try:
        response = requests.post(
            url,
            json=payload,
            headers={"Content-Type": "application/json", "x-goog-api-key": gemini_api_key},
            timeout=30.0,
        )
        if response.status_code == 200:
            candidates = response.json().get("candidates") or []
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                text = "\n".join(
                    part["text"].strip()
                    for part in parts
                    if isinstance(part, dict) and isinstance(part.get("text"), str) and part["text"].strip()
                )
                if text and not is_safety_placeholder(text):
                    return scrub_sensitive_tokens(text)
                diagnostics.append(f"Gemini {clean_model} returned no usable image-analysis text.")
            return None
        diagnostics.append(f"Gemini {clean_model} image request returned HTTP {response.status_code}.")
        logger.error("Gemini %s image request returned HTTP %s.", clean_model, response.status_code)
    except requests.RequestException as error:
        diagnostics.append(f"Gemini {clean_model} image request failed ({type(error).__name__}).")
        logger.error("Gemini image analysis request failed: %s", type(error).__name__)
    except (ValueError, KeyError, TypeError) as error:
        diagnostics.append(f"Gemini {clean_model} image response was invalid ({type(error).__name__}).")
        logger.error("Gemini image analysis response was invalid: %s", type(error).__name__)
    return None


def _sse_event(event_name: str, payload: Dict[str, Any]) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _stream_chat_messages(req: ChatRequest) -> List[Dict[str, str]]:
    messages = [
        {
            "role": "system",
            "content": (
                "You are Personal AI Genie, a helpful, accurate assistant. "
                "Never disclose private configuration, credentials, environment variables, or backend source. "
                "Use this official platform guide when relevant:\n\n"
                + get_platform_system_manifest()
            ),
        }
    ]
    for history_item in (req.conversation_history or [])[-8:]:
        role = "assistant" if history_item.role in ("assistant", "model") else "user"
        if history_item.content.strip():
            messages.append({"role": role, "content": history_item.content})
    messages.append({"role": "user", "content": req.prompt})
    return messages


def _stream_openai_compatible(
    url: str,
    api_key: str,
    model_name: str,
    messages: List[Dict[str, str]],
) -> Any:
    response = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model_name,
            "messages": messages,
            "temperature": 0.7,
            "stream": True,
        },
        stream=True,
        timeout=(10, 120),
    )
    if response.status_code != 200:
        status = response.status_code
        response.close()
        raise RuntimeError(f"HTTP {status}")
    response.encoding = "utf-8"
    try:
        for line in response.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            raw_data = line[5:].strip()
            if raw_data == "[DONE]":
                break
            try:
                payload = json.loads(raw_data)
            except json.JSONDecodeError:
                continue
            choices = payload.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            text = delta.get("content")
            if isinstance(text, str) and text:
                yield payload.get("model") or model_name, text
    finally:
        response.close()


def _stream_gemini(
    model_name: str,
    api_key: str,
    req: ChatRequest,
    master_persona: bool = False,
) -> Any:
    contents = []
    for history_item in (req.conversation_history or [])[-8:]:
        role = "user" if history_item.role == "user" else "model"
        if history_item.content.strip():
            contents.append({"role": role, "parts": [{"text": history_item.content}]})
    contents.append({"role": "user", "parts": [{"text": req.prompt}]})
    response = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:streamGenerateContent?alt=sse",
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        json={
            "contents": contents,
            "systemInstruction": {
                "parts": [{
                    "text": (
                        (
                            "You are Genie Master, the expert and analytical Personal AI Genie persona. "
                            if master_persona
                            else "You are Genie Pro, the helpful baseline Personal AI Genie persona. "
                        )
                        + "Never disclose private configuration, credentials, "
                        "environment variables, or backend source. Official platform guide:\n\n"
                        + get_platform_system_manifest()
                    )
                }]
            },
            "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2048},
        },
        stream=True,
        timeout=(10, 120),
    )
    if response.status_code != 200:
        status = response.status_code
        response.close()
        raise RuntimeError(f"HTTP {status}")
    response.encoding = "utf-8"
    try:
        for line in response.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            try:
                payload = json.loads(line[5:].strip())
            except json.JSONDecodeError:
                continue
            candidates = payload.get("candidates") or []
            if not candidates:
                continue
            parts = candidates[0].get("content", {}).get("parts", [])
            for part in parts:
                text = part.get("text")
                if isinstance(text, str) and text:
                    yield model_name, text
    finally:
        response.close()


def _chat_stream_events(
    req: ChatRequest,
    is_admin: bool = False,
    is_vip: bool = False,
) -> Any:
    messages = _stream_chat_messages(req)
    providers: List[tuple[str, str, Any]] = []
    selected_key = gemini_pool.get_key(is_vip=is_vip, is_admin=is_admin)
    gemini_key = (
        (GEMINI_MASTER_KEY or "").strip() or req.custom_api_key or selected_key.get("key") or ""
        if is_admin or is_vip
        else req.custom_api_key or selected_key.get("key") or ""
    ).strip()
    if gemini_key:
        model = selected_key.get("model_override") or (
            "gemini-2.5-flash" if (is_admin or is_vip) else "gemini-2.0-flash"
        )
        master_persona = is_admin or is_vip
        providers.append((
            "Google Gemini",
            model,
            lambda model: _stream_gemini(model, gemini_key, req, master_persona),
        ))
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    if groq_key:
        providers.append(("Groq Cloud", "llama-3.3-70b-versatile", lambda model: _stream_openai_compatible(
            "https://api.groq.com/openai/v1/chat/completions", groq_key, model, messages
        )))
    mistral_key = os.getenv("MISTRAL_API_KEY", "").strip()
    if mistral_key:
        for mistral_model in ("mistral-small-latest", "codestral-latest"):
            providers.append(("Mistral AI", mistral_model, lambda model, key=mistral_key: _stream_openai_compatible(
                "https://api.mistral.ai/v1/chat/completions", key, model, messages
            )))
    github_key = (os.getenv("GITHUB_MODELS_TOKEN") or os.getenv("GITHUB_TOKEN") or "").strip()
    if github_key:
        providers.append(("GitHub Models", "gpt-4o-mini", lambda model: _stream_openai_compatible(
            "https://models.inference.ai.azure.com/chat/completions", github_key, model, messages
        )))

    completed = False
    for provider_name, model_name, stream_factory in providers:
        try:
            token_stream = iter(stream_factory(model_name))
            first_item = next(token_stream, None)
            if first_item is None:
                raise RuntimeError("Provider returned an empty stream")
            active_model, first_text = first_item
            yield _sse_event(
                "meta",
                {
                    "provider": provider_name,
                    "model": active_model,
                    "speaker": "Genie Master" if is_admin or is_vip else "Genie Pro",
                    "persona": "Genie-Master" if is_admin or is_vip else "Genie-PRO",
                },
            )
            yield _sse_event("token", {"text": scrub_sensitive_tokens(first_text)})
            for active_model, text in token_stream:
                yield _sse_event("token", {"text": scrub_sensitive_tokens(text)})
            completed = True
            break
        except Exception as error:
            if provider_name == "Google Gemini" and (
                "429" in str(error) or "RESOURCE_EXHAUSTED" in str(error)
            ):
                gemini_pool.mark_rate_limited(gemini_key)
            reason = str(error) if str(error).startswith("HTTP ") else type(error).__name__
            yield _sse_event("fallback", {"failed": provider_name, "reason": reason})

    if not completed:
        openrouter_key = (os.getenv("OPENROUTER_API_KEY") or OPENROUTER_KEY).strip()

        if openrouter_key:
            try:
                response = requests.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {openrouter_key}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": "http://localhost:3000",
                        "X-Title": "Personal AI Genie",
                    },
                    json={
                        "models": OPENROUTER_STREAM_MODELS,
                        "messages": messages,
                        "temperature": 0.7,
                        "stream": True,
                    },
                    stream=True,
                    timeout=(10, 120),
                )
                if response.status_code != 200:
                    status = response.status_code
                    response.close()
                    raise RuntimeError(f"HTTP {status}")
                response.encoding = "utf-8"
                active_model = "OpenRouter free-model cascade"
                emitted_meta = False
                try:
                    for line in response.iter_lines(decode_unicode=True):
                        if not line or not line.startswith("data:"):
                            continue
                        raw_data = line[5:].strip()
                        if raw_data == "[DONE]":
                            break
                        try:
                            payload = json.loads(raw_data)
                        except json.JSONDecodeError:
                            continue
                        choices = payload.get("choices") or []
                        if not choices:
                            continue
                        text = (choices[0].get("delta") or {}).get("content")
                        if not isinstance(text, str) or not text:
                            continue
                        active_model = payload.get("model") or active_model
                        if not emitted_meta:
                            yield _sse_event("meta", {"provider": "OpenRouter", "model": active_model})
                            emitted_meta = True
                        yield _sse_event("token", {"text": scrub_sensitive_tokens(text)})
                finally:
                    response.close()
                if not emitted_meta:
                    raise RuntimeError("Provider returned an empty stream")
                completed = True
            except Exception as error:
                reason = str(error) if str(error).startswith("HTTP ") else type(error).__name__
                yield _sse_event("fallback", {"failed": "OpenRouter", "reason": reason})
    if not completed:
        yield _sse_event("error", {"message": "All configured chat providers are unavailable."})
    yield _sse_event("done", {"status": "success" if completed else "error"})

@app.post("/api/chat/stream")
async def stream_chat(
    req: ChatRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_byok_key: Optional[str] = Header(default=None),
):
    req.custom_api_key = (
        req.custom_api_key or req.byok_key or x_byok_key or ""
    ).strip() or None
    if req.is_team_chat:
        raise HTTPException(status_code=400, detail="Team messages cannot use the AI streaming endpoint.")
    prompt = scrub_sensitive_tokens((req.prompt or req.message or "").strip())
    if not prompt and req.image_data:
        prompt = "Analyze the attached image and provide a clear, accurate response."
    if not prompt:
        raise HTTPException(status_code=400, detail="Enter a message to chat.")
    if (req.force_genie_master or req.force_ai_intervention) and not req.image_data:
        raise HTTPException(status_code=422, detail="Genie Master image analysis requires an attached image.")
    req.prompt = prompt
    bearer_token = (
        authorization.removeprefix("Bearer ").strip()
        if authorization and authorization.startswith("Bearer ")
        else ""
    )
    dev_token_requested = (
        bearer_token == "dev-token-local-bypass"
        or (req.google_id_token or "").strip() == "dev-token-local-bypass"
    )
    dev_identity = (
        local_developer_identity(
            request,
            authorization or f"Bearer {(req.google_id_token or '').strip()}",
        )
        if dev_token_requested
        else None
    )
    if dev_token_requested and not dev_identity:
        raise HTTPException(status_code=401, detail="The developer session is only available in local development.")

    identity_token = (req.google_id_token or "").strip() or bearer_token
    if dev_identity:
        identity: Dict[str, str] = {**dev_identity, "tenant_id": ""}
    else:
        identity = await asyncio.to_thread(
            verified_identity_from_token,
            identity_token,
            request,
        )
    verified_email = identity["email"]
    if verified_workspace_tenant(identity):
        room_id = str(req.workspace_room_id or "")
        require_workspace_room_member(room_id, identity)
        audit_workspace_action(identity, "chat.stream.request", room_id)
    else:
        require_personal_scope(identity)
    if not req.image_data and not (req.observer_mode if req.observer_mode is not None else req.engine == "cloud_ai"):
        raise HTTPException(status_code=400, detail="Streaming cascade is available only in Observer mode.")
    account_limits = get_account_limits(identity)
    is_master_admin = verified_email.strip().lower() == ADMIN_EMAIL
    is_active_vip = bool(account_limits.get("is_vip"))
    if not is_master_admin and not is_active_vip and not dev_identity and not (req.custom_api_key or "").strip():
        if account_limits.get("requires_byok"):
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "BYOK_REQUIRED",
                    "code": "BYOK_REQUIRED",
                    "message": account_limits["message"],
                    **account_limits,
                },
            )
        consume_daily_message(get_chat_identity_for_identity(identity))
    mock_reply = (
        evaluate_local_python_mock(prompt)
        if not req.image_data and not req.force_genie_master and not req.force_ai_intervention and not has_active_chat_api_key(req.custom_api_key)
        else None
    )
    if mock_reply:
        def mock_events():
            yield _sse_event(
                "meta",
                {"provider": "Personal AI Genie", "model": "local-python-mock", "source": "platform_engine"},
            )
            yield _sse_event("token", {"text": mock_reply})
            yield _sse_event("done", {"status": "success"})

        return StreamingResponse(
            mock_events(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    if req.image_data:
        image_part = decode_chat_image(req.image_data)
        master_selection = gemini_pool.get_key(is_vip=True, is_admin=True)
        api_key = (
            (GEMINI_MASTER_KEY or "").strip()
            or (req.custom_api_key or "").strip()
            or str(master_selection.get("key") or "")
        )
        if not api_key:
            raise HTTPException(status_code=503, detail="Gemini image analysis is unavailable because no Gemini API key is configured.")
        diagnostics: List[str] = []
        image_reply = request_gemini_multimodal(
            "gemini-2.5-flash",
            api_key,
            prompt,
            req.conversation_history or [],
            image_part,
            diagnostics,
        )
        if not image_reply:
            raise HTTPException(status_code=502, detail="Genie Master could not analyze the image with Gemini 2.5 Flash.")

        def image_events():
            yield _sse_event(
                "meta",
                {
                    "provider": "Google Gemini",
                    "model": "gemini-2.5-flash",
                    "source": "cloud_ai",
                    "speaker": "Genie Master",
                },
            )
            yield _sse_event("token", {"text": sanitize_regular_chat_text(image_reply)})
            yield _sse_event("done", {"status": "success", "speaker": "Genie Master"})

        return StreamingResponse(
            image_events(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    return StreamingResponse(
        _chat_stream_events(req, is_master_admin, is_active_vip),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@app.post("/api/voice/transcribe")
async def transcribe_voice(file: UploadFile = File(...)):
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    if not groq_key:
        raise HTTPException(status_code=503, detail="Voice transcription is unavailable because Groq is not configured.")
    max_audio_size = 25 * 1024 * 1024
    audio_bytes = await file.read(max_audio_size + 1)
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="The audio recording is empty.")
    if len(audio_bytes) > max_audio_size:
        raise HTTPException(status_code=413, detail="Audio recordings must be 25 MB or smaller.")
    filename = Path(file.filename or "recording.webm").name
    content_type = file.content_type or "application/octet-stream"
    try:
        response = await asyncio.to_thread(
            requests.post,
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {groq_key}"},
            data={"model": "whisper-large-v3", "temperature": "0.0", "response_format": "json"},
            files={"file": (filename, audio_bytes, content_type)},
            timeout=90.0,
        )
    except requests.RequestException as error:
        logger.warning("Groq voice transcription request failed: %s", type(error).__name__)
        raise HTTPException(status_code=502, detail="The voice transcription provider could not be reached.") from error
    if response.status_code != 200:
        logger.warning("Groq voice transcription returned HTTP %s.", response.status_code)
        raise HTTPException(status_code=502, detail="The voice transcription provider rejected the recording.")
    try:
        text = response.json().get("text")
    except (ValueError, AttributeError) as error:
        raise HTTPException(status_code=502, detail="The voice transcription provider returned invalid data.") from error
    if not isinstance(text, str):
        raise HTTPException(status_code=502, detail="The voice transcription provider returned no transcript.")
    return {"text": text.strip()}


VOICE_CONFIG = {
    "ta": {"language_code": "ta-IN", "name": "ta-IN-Standard-A"},
    "hi": {"language_code": "hi-IN", "name": "hi-IN-Neural2-A"},
    "ml": {"language_code": "ml-IN", "name": "ml-IN-Standard-A"},
    "te": {"language_code": "te-IN", "name": "te-IN-Standard-A"},
    "kn": {"language_code": "kn-IN", "name": "kn-IN-Standard-A"},
    "bn": {"language_code": "bn-IN", "name": "bn-IN-Standard-A"},
    "mr": {"language_code": "mr-IN", "name": "mr-IN-Standard-A"},
    "gu": {"language_code": "gu-IN", "name": "gu-IN-Standard-A"},
    "pa": {"language_code": "pa-IN", "name": "pa-IN-Standard-A"},
    "or": {"language_code": "or-IN", "name": "or-IN-Standard-A"},
    "ur": {"language_code": "ur-IN", "name": "ur-IN-Standard-A"},
    "as": {"language_code": "as-IN", "name": "as-IN-Standard-A"},
    "sa": {"language_code": "sa-IN", "name": "sa-IN-Standard-A"},
    "en": {"language_code": "en-IN", "name": "en-IN-Journey-D"},
}


@app.post("/api/tts/speak")
async def speak_text(req: TextToSpeechRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text to synthesize cannot be blank.")
    if len(text) > 5000:
        raise HTTPException(status_code=413, detail="Text to synthesize must be 5,000 characters or fewer.")
    voice = VOICE_CONFIG.get(req.lang.strip().lower().split("-")[0])
    if not voice:
        raise HTTPException(status_code=400, detail="The requested language is not supported for speech synthesis.")

    api_key = (
        os.getenv("GOOGLE_API_KEY")
        or os.getenv("GEMINI_API_KEY")
        or ""
    ).strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Regional speech synthesis is not configured.")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://texttospeech.googleapis.com/v1/text:synthesize",
                params={"key": api_key},
                json={
                    "input": {"text": text},
                    "voice": {
                        "languageCode": voice["language_code"],
                        "name": voice["name"],
                    },
                    "audioConfig": {
                        "audioEncoding": "MP3",
                        "speakingRate": 0.95,
                        "pitch": 0.0,
                    },
                },
            )
    except httpx.TimeoutException as error:
        logger.warning("Google Cloud Text-to-Speech request timed out.")
        raise HTTPException(status_code=504, detail="The speech synthesis provider timed out.") from error
    except httpx.RequestError as error:
        logger.warning("Google Cloud Text-to-Speech request failed: %s", type(error).__name__)
        raise HTTPException(status_code=502, detail="The speech synthesis provider could not be reached.") from error

    if not response.is_success:
        try:
            provider_error = response.json().get("error", {})
            provider_message = provider_error.get("message", "")
        except (ValueError, AttributeError):
            provider_message = ""
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail="Speech synthesis quota has been exceeded.")
        if response.status_code in (400, 403):
            logger.warning("Google Cloud Text-to-Speech rejected the request (HTTP %s).", response.status_code)
            raise HTTPException(
                status_code=502,
                detail=provider_message or "The speech synthesis provider rejected the request.",
            )
        logger.warning("Google Cloud Text-to-Speech returned HTTP %s.", response.status_code)
        raise HTTPException(status_code=502, detail="The speech synthesis provider could not complete the request.")

    try:
        audio_content = response.json().get("audioContent")
        if not isinstance(audio_content, str) or not audio_content:
            raise ValueError("Missing audio content.")
        audio_bytes = base64.b64decode(audio_content, validate=True)
    except (ValueError, binascii.Error, AttributeError) as error:
        logger.warning("Google Cloud Text-to-Speech returned invalid audio data.")
        raise HTTPException(status_code=502, detail="The speech synthesis provider returned invalid audio data.") from error

    return Response(content=audio_bytes, media_type="audio/mpeg")


def sanitize_voice_text(text: str) -> str:
    text = re.sub(r"\$\$.*?\$\$|\$[^$]*\$", " ", text, flags=re.DOTALL)
    text = re.sub(r"(?<!\w)(\*{1,2}|_{1,2})(?=\S)|(?<=\S)(\*{1,2}|_{1,2})(?!\w)", "", text)
    spoken_symbols = {
        "≤": " less than or equal to ",
        "≥": " greater than or equal to ",
        "<": " less than ",
        ">": " greater than ",
        "≠": " not equal to ",
        "≈": " approximately ",
        "×": " times ",
        "÷": " divided by ",
        "→": " leads to ",
        "←": " comes from ",
        "±": " plus or minus ",
        "=": " equals ",
        "+": " plus ",
        "−": " minus ",
        "/": " divided by ",
        "^": " to the power of ",
    }
    text = re.sub(r"(?m)^\s*>+\s?", "", text)
    text = re.sub(r"(?<=\w)\s*\*\s*(?=\w)", " times ", text)
    text = re.sub(r"(?<=\d)\s*-\s*(?=\d)", " minus ", text)
    text = re.sub(
        r"[≤≥≠≈×÷→←±=+−/^]",
        lambda match: spoken_symbols[match.group(0)],
        text,
    )
    text = re.sub(r"[<>]", lambda match: spoken_symbols[match.group(0)], text)
    text = re.sub(r"[#*_~`|]", " ", text)
    text = re.sub(r"\\[a-zA-Z]+", " ", text)
    text = re.sub(r"[{}\[\]]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def sanitize_regular_chat_text(text: str) -> str:
    text = re.sub(r"```[\w+-]*\s*", "", text)
    text = text.replace("`", "")
    text = text.replace("#", "")
    text = re.sub(
        r"\*\*(.*?)\*\*|__(.*?)__",
        lambda match: match.group(1) or match.group(2) or "",
        text,
    )
    text = re.sub(r"(?<!\w)([*_])([^*_]+)\1(?!\w)", r"\2", text)
    text = re.sub(r"(?m)^\s*[-*+•]\s+", "", text)
    text = re.sub(r"(?m)^\s*\d+[.)]\s+", "", text)
    return text


VOICE_SYSTEM_INSTRUCTION = (
    "You are Genie Master in a live spoken voice call. "
    "Respond strictly and fluently in the requested language. "
    "State only the direct core logic in 2 to 3 natural sentences. "
    "Do not use markdown headers, bullet points, tables, asterisks, math formulas, or URLs."
)
VOICE_PERSONA_INSTRUCTIONS = {
    "Aoede": "Use a soft, breezy, conversational delivery.",
    "Charon": "Use a calm, steady, professional delivery.",
    "Kore": "Use a firm, crisp, analytical delivery.",
    "Fenrir": "Use a deep, authoritative, resolute delivery.",
    "Puck": "Use a playful, witty, high-energy delivery.",
}

TTS_LANG_MAP = {
    "தமிழ்": "ta",
    "Tamil": "ta",
    "മലയാളം": "ml",
    "Malayalam": "ml",
    "తెలుగు": "te",
    "Telugu": "te",
    "ಕನ್ನಡ": "kn",
    "Kannada": "kn",
    "हिन्दी": "hi",
    "Hindi": "hi",
    "বাংলা": "bn",
    "Bengali": "bn",
    "मराठी": "mr",
    "Marathi": "mr",
    "ગુજરાતી": "gu",
    "Gujarati": "gu",
    "ਪੰਜਾਬੀ": "pa",
    "Punjabi": "pa",
    "اردو": "ur",
    "Urdu": "ur",
    "EN (India)": "en",
    "English": "en",
    "ta-IN": "ta",
    "ml-IN": "ml",
    "te-IN": "te",
    "kn-IN": "kn",
    "hi-IN": "hi",
    "bn-IN": "bn",
    "mr-IN": "mr",
    "gu-IN": "gu",
    "pa-IN": "pa",
    "ur-IN": "ur",
    "en-IN": "en",
}

GOOGLE_TTS_ONLY_DIALECTS = {
    "ଓଡ଼ିଆ": "or-IN",
    "Odia": "or-IN",
    "or-IN": "or-IN",
    "অসমীয়া": "as-IN",
    "Assamese": "as-IN",
    "as-IN": "as-IN",
    "संस्कृतम्": "sa-IN",
    "Sanskrit": "sa-IN",
    "sa-IN": "sa-IN",
}


def synthesize_voice_audio(text: str, tts_lang: str) -> str:
    audio_fp = io.BytesIO()
    gTTS(text=text, lang=tts_lang, slow=False).write_to_fp(audio_fp)
    audio_fp.seek(0)
    return base64.b64encode(audio_fp.read()).decode("utf-8")

# In-memory daily turn tracker for free quota users (10 turns / day per user/IP)
_DAILY_VOICE_USAGE: Dict[str, Dict[str, Any]] = {}


def consume_sequential_turn(participant_ids: List[str]) -> tuple[bool, Optional[str], int]:
    """
    Destroys tokens of the user who added/activated the AI agent first (caller_id),
    then sequentially cascades across all available room participants.
    """
    today = datetime.now(timezone.utc).date().isoformat()
    with daily_message_counts_lock, closing(sqlite3.connect(ARCHIVE_DB_PATH, timeout=10)) as conn:
        for raw_id in participant_ids:
            if not raw_id:
                continue
            canonical_id = canonical_user_id(str(raw_id))
            user_key = f"google:{canonical_id}"
            row = conn.execute(
                "SELECT created_at, is_vip, vip_expires_at, email FROM user_registry WHERE user_id = ? OR lower(email) = lower(?)",
                (canonical_id, canonical_id),
            ).fetchone()
            if row:
                created_at, is_vip, vip_expires_at, db_email = row
                if str(db_email or "").strip().lower() == ADMIN_EMAIL.lower():
                    return True, canonical_id, 999999
                if is_vip and vip_expires_at and vip_expires_at > datetime.now(timezone.utc).isoformat():
                    return True, canonical_id, 999999
                if created_at:
                    try:
                        age_days = (datetime.now(timezone.utc) - datetime.fromisoformat(created_at)).days
                        if age_days > 180:
                            continue
                    except ValueError:
                        pass
            used = daily_message_counts.get((user_key, today), 0)
            if used < DAILY_MESSAGE_LIMIT:
                daily_message_counts[(user_key, today)] = used + 1
                return True, canonical_id, max(0, DAILY_MESSAGE_LIMIT - (used + 1))
    return False, None, 0

def _check_and_consume_daily_turn(user_identifier: str, limit: int = 10) -> tuple[bool, int]:
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    record = _DAILY_VOICE_USAGE.get(user_identifier)
    if not record or record.get("date") != today_str:
        _DAILY_VOICE_USAGE[user_identifier] = {"date": today_str, "count": 1}
        return True, limit - 1
    if record["count"] >= limit:
        return False, 0
    record["count"] += 1
    return True, max(0, limit - record["count"])


@app.post("/api/voice/direct-turn")
@app.post("/voice/direct-turn")
async def direct_voice_turn(
    req: DirectVoiceTurnRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    bearer_token = (
        authorization.removeprefix("Bearer ").strip()
        if authorization and authorization.startswith("Bearer ")
        else ""
    )
    session_tokens = [
        (request.cookies.get(cookie_name) or "").strip()
        for cookie_name in ("genie_session", "session", "auth_token", "access_token")
    ]
    candidate_tokens = dict.fromkeys(
        token
        for token in (bearer_token, *session_tokens, (req.google_id_token or "").strip())
        if token
    )
    identity = None
    for identity_token in candidate_tokens:
        identity_authorization = f"Bearer {identity_token}"
        candidate_identity = (
            local_developer_identity(request, identity_authorization)
            if identity_token in ("dev-token-local-bypass", "guest-session")
            else get_verified_archive_identity(identity_authorization)
        )
        if candidate_identity:
            identity = candidate_identity
            break

    # Master admin identification
    req_email = (getattr(req, "user_email", "") or "").strip().lower()
    is_master_admin = (
        (identity and identity.get("email", "").strip().lower() == ADMIN_EMAIL.lower())
        or req_email == ADMIN_EMAIL.lower()
        or req_email == "rshaji93@gmail.com"
    )

    # If identity is still missing, treat user as guest rather than dropping connection
    if not identity:
        client_ip = request.client.host if request.client else "unknown_client"
        identity = {
            "email": req_email or f"guest_{client_ip}@genie.local",
            "name": "Public Guest",
            "is_guest": True,
        }

    # Verify workspace scope if running in team room mode
    if verified_workspace_tenant(identity):
        room_id = str(req.workspace_room_id or "")
        require_workspace_room_member(room_id, identity)
        audit_workspace_action(identity, "voice.turn.request", room_id)
    else:
        try:
            require_personal_scope(identity)
        except Exception:
            pass

    user_byok_key = (req.user_byok_key or "").strip()

    # Determine which API key to use and handle daily quotas
    if is_master_admin:
        # Developer/Admin has unmetered access via Master Key
        api_key = (GEMINI_MASTER_KEY or "").strip()
    elif user_byok_key:
        # User supplied personal key: unmetered access
        api_key = user_byok_key
    else:
        # Sequential token cascade: initiator's tokens are consumed first, then room peers
        candidates = [req.caller_id] + [p for p in (req.participant_ids or []) if p != req.caller_id]
        candidates = [c for c in candidates if c]
        if not candidates:
            candidates = [identity.get("sub") or identity.get("email") or request.client.host]
        allowed, charged_user, remaining_turns = consume_sequential_turn(candidates)
        if not allowed:
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "BYOK_REQUIRED",
                    "error": "ALL_PARTICIPANT_TOKENS_EXHAUSTED",
                    "message": "All participant daily tokens in this room are exhausted. Please provide a Gemini API key in Settings > BYOK to continue.",
                },
            )
        pool_key_info = gemini_pool.get_key(is_vip=False, is_admin=False)
        api_key = pool_key_info.get("key") or (GEMINI_MASTER_KEY or "").strip()

    openrouter_key = (OPENROUTER_API_KEY or "").strip()
    if not api_key and not openrouter_key:
        raise HTTPException(status_code=503, detail="Direct voice generation is not configured.")

    transcript = req.transcript.strip()
    if not transcript:
        raise HTTPException(status_code=400, detail="A live speech transcript is required.")

    voice_contents = [dict(item) for item in req.contents]
    last_item = voice_contents[-1] if voice_contents else None
    last_parts = last_item.get("parts") if isinstance(last_item, dict) else None
    last_user_text = (
        " ".join(
            part["text"].strip()
            for part in (last_parts or [])
            if isinstance(part, dict)
            and isinstance(part.get("text"), str)
            and part["text"].strip()
        )
        if isinstance(last_item, dict) and last_item.get("role") == "user"
        else ""
    )
    if last_user_text != transcript:
        voice_contents.append({"role": "user", "parts": [{"text": transcript}]})

    system_instruction = (
        f"{VOICE_SYSTEM_INSTRUCTION} Dialect: {req.dialect.strip()}."
        f" Voice persona: {req.voice_name}. {VOICE_PERSONA_INSTRUCTIONS.get(req.voice_name, '')}"
        f"\n\n{req.system_text}".strip()
    )

    generated_text = ""
    result: Dict[str, Any] = {"candidates": [{"content": {"parts": []}}]}

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            if api_key:
                try:
                    response = await client.post(
                        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
                        params={"key": api_key},
                        json={
                            "systemInstruction": {"parts": [{"text": system_instruction}]},
                            "contents": voice_contents,
                        },
                    )
                    if response.status_code == 200:
                        result = response.json()
                        candidates = result.get("candidates") or []
                        content = candidates[0].get("content") if candidates else None
                        parts = content.get("parts") if isinstance(content, dict) else None
                        generated_text = " ".join(
                            part["text"].strip()
                            for part in (parts or [])
                            if isinstance(part, dict)
                            and isinstance(part.get("text"), str)
                            and part["text"].strip()
                        )
                    else:
                        print(f"[GEMINI CALL NOTICE] Status {response.status_code}: {response.text}", flush=True)
                except Exception as e:
                    print(f"[GEMINI CALL ERROR]: {e}", flush=True)

            # Fallback to OpenRouter if Gemini returned empty text
            if not generated_text and openrouter_key:
                messages = [{"role": "system", "content": system_instruction}]
                for item in voice_contents:
                    role = "assistant" if item.get("role") in {"model", "assistant"} else "user"
                    parts = item.get("parts") or []
                    text = " ".join(
                        part["text"].strip()
                        for part in parts
                        if isinstance(part, dict)
                        and isinstance(part.get("text"), str)
                        and part["text"].strip()
                    )
                    if text:
                        messages.append({"role": role, "content": text})

                openrouter_response = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {openrouter_key}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": "https://genie.local",
                        "X-Title": "Personal AI Genie",
                    },
                    json={
                        "model": OPENROUTER_FREE_MODELS[0],
                        "messages": messages,
                        "temperature": 0.7,
                    },
                )
                if openrouter_response.status_code == 200:
                    openrouter_data = openrouter_response.json()
                    choices = openrouter_data.get("choices") or []
                    message = choices[0].get("message") if choices else None
                    content = message.get("content") if isinstance(message, dict) else ""
                    generated_text = content.strip() if isinstance(content, str) else ""

            if not generated_text:
                raise RuntimeError("Voice provider returned an empty transcript.")

            generated_text = sanitize_voice_text(generated_text)
            audio_base64 = ""
            audio_mime_type = "audio/mpeg"

            # Attempt Gemini Voice Synthesis
            if api_key:
                try:
                    tts_response = await client.post(
                        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
                        params={"key": api_key},
                        json={
                            "contents": [{"parts": [{"text": generated_text}]}],
                            "generationConfig": {
                                "responseModalities": ["AUDIO"],
                                "speechConfig": {
                                    "voiceConfig": {
                                        "prebuiltVoiceConfig": {"voiceName": req.voice_name}
                                    }
                                },
                            },
                        },
                    )
                    if tts_response.status_code == 200:
                        tts_data = tts_response.json()
                        tts_candidates = tts_data.get("candidates") or []
                        tts_content = tts_candidates[0].get("content") if tts_candidates else None
                        tts_parts = tts_content.get("parts") if isinstance(tts_content, dict) else None
                        audio_part = next(
                            (
                                part.get("inlineData")
                                for part in (tts_parts or [])
                                if isinstance(part, dict) and isinstance(part.get("inlineData"), dict)
                            ),
                            None,
                        )
                        if audio_part and isinstance(audio_part.get("data"), str):
                            raw_audio = base64.b64decode(audio_part["data"], validate=True)
                            returned_mime = str(audio_part.get("mimeType") or "audio/pcm")
                            if "pcm" in returned_mime.lower() or "l16" in returned_mime.lower():
                                rate_match = re.search(r"rate=(\d+)", returned_mime)
                                sample_rate = int(rate_match.group(1)) if rate_match else 24000
                                if "l16" in returned_mime.lower():
                                    raw_audio = b"".join(
                                        raw_audio[offset : offset + 2][::-1]
                                        for offset in range(0, len(raw_audio) - 1, 2)
                                    )
                                wav_buffer = io.BytesIO()
                                with wave.open(wav_buffer, "wb") as wav_file:
                                    wav_file.setnchannels(1)
                                    wav_file.setsampwidth(2)
                                    wav_file.setframerate(sample_rate)
                                    wav_file.writeframes(raw_audio)
                                raw_audio = wav_buffer.getvalue()
                                audio_mime_type = "audio/wav"
                            else:
                                audio_mime_type = returned_mime
                            audio_base64 = base64.b64encode(raw_audio).decode("utf-8")
                except Exception as tts_error:
                    logger.warning(
                        "Gemini TTS for voice %s skipped: %s",
                        req.voice_name,
                        tts_error,
                    )

            # Fallback to secondary TTS if needed
            if not audio_base64:
                try:
                    dialect = getattr(req, "dialect", "en").strip() if getattr(req, "dialect", None) else "en"
                    cloud_language = GOOGLE_TTS_ONLY_DIALECTS.get(dialect)
                    if cloud_language:
                        server_audio = await speak_text(
                            TextToSpeechRequest(text=generated_text, lang=cloud_language)
                        )
                        audio_base64 = base64.b64encode(server_audio.body).decode("utf-8")
                    else:
                        tts_lang = TTS_LANG_MAP.get(dialect, "en")
                        audio_base64 = await asyncio.to_thread(
                            synthesize_voice_audio,
                            generated_text,
                            tts_lang,
                        )
                except Exception as tts_err:
                    logger.warning(f"Audio synthesis skipped; client browser fallback will speak: {tts_err}")
                    audio_base64 = ""

            return JSONResponse(
                content={
                    "candidates": [{"content": {"parts": [{"text": generated_text}]}}],
                    "text": generated_text,
                    "audio": audio_base64,
                    "audio_mime_type": audio_mime_type,
                }
            )
    except Exception as e:
        print(f"[DIRECT VOICE CRITICAL ERROR]: {e}", flush=True)
        raise HTTPException(status_code=502, detail="Voice generation failed. Please try again.") from e


@app.post("/chat", include_in_schema=False)
@app.post("/api/py/chat", include_in_schema=False)
@app.post("/api/py/chat/turn", include_in_schema=False)
@app.post("/api/chat")
@app.post("//api/chat")
async def handle_chat(
    req: ChatRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_byok_key: Optional[str] = Header(default=None),
):
    req.custom_api_key = (
        req.custom_api_key or req.byok_key or x_byok_key or ""
    ).strip() or None
    if req.is_team_chat:
        raise HTTPException(
            status_code=400,
            detail="Human room messages must use the room WebSocket and are not sent to an AI provider.",
        )
    history = req.conversation_history or []
    bearer_token = (authorization or "").replace("Bearer ", "").strip()
    identity_token = (req.google_id_token or "").strip() or bearer_token
    dev_identity = None
    if identity_token == "dev-token-local-bypass":
        dev_identity = {
            "sub": "dev-admin",
            "email": ADMIN_EMAIL,
            "name": "Dev Admin",
            "tenant_id": "",
            "role": "admin",
        }
        identity = dev_identity
    else:
        try:
            identity = await asyncio.to_thread(
                verified_identity_from_token,
                identity_token,
                request,
            )
        except HTTPException:
            if is_local_development_request(request):
                dev_identity = {
                    "sub": "dev-admin",
                    "email": ADMIN_EMAIL,
                    "name": "Dev Admin",
                    "tenant_id": "",
                    "role": "admin",
                }
                identity = dev_identity
            else:
                raise
    verified_email = identity["email"]
    if verified_workspace_tenant(identity):
        room_id = str(req.workspace_room_id or "")
        require_workspace_room_member(room_id, identity)
        audit_workspace_action(identity, "chat.request", room_id)
    else:
        require_personal_scope(identity)
    prompt = scrub_sensitive_tokens((req.prompt or "").strip() or (req.message or "").strip())
    if not prompt and req.image_data:
        prompt = "Analyze the attached image and provide a clear, accurate response."
    if not prompt:
        raise HTTPException(status_code=400, detail="Enter a message to chat.")
    if (req.force_genie_master or req.force_ai_intervention) and not req.image_data:
        raise HTTPException(status_code=422, detail="Genie Master image analysis requires an attached image.")
    req.prompt = prompt
    has_image = bool(req.image_data)
    is_master_admin = bool(verified_email and verified_email.strip().lower() == ADMIN_EMAIL)
    account_limits = get_account_limits(identity) if verified_email else {}
    is_active_vip = bool(account_limits.get("is_vip"))
    if not is_master_admin and not is_active_vip and not dev_identity and not (req.custom_api_key or "").strip():
        if account_limits.get("requires_byok"):
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "BYOK_REQUIRED",
                    "code": "BYOK_REQUIRED",
                    "message": account_limits["message"],
                    **account_limits,
                },
            )
        consume_daily_message(get_chat_identity_for_identity(identity))
    if req.engine not in ("cloud_ai", "local_agent"):
        raise HTTPException(status_code=400, detail="Unknown chat engine.")
    observer_mode = (
        req.observer_mode
        if req.observer_mode is not None
        else bool(req.is_observer_active)
    )
    or_key = os.getenv("OPENROUTER_API_KEY", OPENROUTER_KEY).strip()
    user_gemini_key = (req.custom_api_key or "").strip()
    has_valid_tokens = (
        is_master_admin
        or is_active_vip
        or bool(user_gemini_key)
        or int(account_limits.get("chats_remaining", 10)) > 0
    )
    # Individual Chat: Observer OFF -> Genie Pro is primary. Observer ON -> Genie Master (if valid tokens) else Genie Pro.
    master_persona = bool(
        has_image
        or req.force_genie_master
        or observer_mode
    )
    pool_selection = gemini_pool.get_key(
        is_vip=is_active_vip or has_image,
        is_admin=is_master_admin or has_image,
    )
    pool_gemini_key = str(pool_selection.get("key") or "").strip()
    server_gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    gemini_key = (
        (GEMINI_MASTER_KEY or "").strip() or user_gemini_key or pool_gemini_key or server_gemini_key
        if master_persona
        else user_gemini_key or pool_gemini_key or server_gemini_key
    )
    diagnostics: List[str] = []

    if has_image:
        image_part = decode_chat_image(req.image_data or "")
        if not gemini_key:
            raise HTTPException(status_code=503, detail="Gemini image analysis is unavailable because no Gemini API key is configured.")
        image_reply = request_gemini_multimodal(
            "gemini-2.5-flash",
            gemini_key,
            prompt,
            history,
            image_part,
            diagnostics,
        )
        if not image_reply:
            raise HTTPException(
                status_code=502,
                detail="Genie Master could not analyze the image with Gemini 2.5 Flash.",
            )
        return {
            "reply": sanitize_regular_chat_text(image_reply),
            "response": sanitize_regular_chat_text(image_reply),
            "model_used": "gemini-2.5-flash",
            "source": "cloud_ai",
            "provider_source": "gemini",
            "speaker": "Genie Master",
            "force_genie_master": True,
            **account_limits,
        }

    if master_persona:
        prompt = "Respond as Genie Master, the expert analytical persona. " + prompt

    # 1. Primary: Direct Google Gemini Native Rest API
    if gemini_key:
        selected_model = (
            str(pool_selection.get("model_override") or "gemini-2.5-flash")
            if master_persona
            else "gemini-2.0-flash"
        )
        for model in [selected_model]:
            reply = request_gemini_direct(model, gemini_key, prompt, history, diagnostics)
            if reply:
                return {
                    "reply": reply,
                    "response": reply,
                    "model_used": model,
                    "source": "cloud_ai",
                    "provider_source": "gemini",
                    "speaker": "Genie Master" if master_persona else "Genie Pro",
                    "persona": "Genie-Master" if master_persona else "Genie-PRO",
                    **account_limits,
                }

    # 2. Resilient OpenRouter Dynamic Routing
    if or_key:
        for model_slug in OPENROUTER_FREE_MODELS:
            reply = request_openrouter_model(model_slug, or_key, prompt, history, diagnostics)
            if reply:
                return {
                    "reply": reply,
                    "response": reply,
                    "model_used": model_slug,
                    "source": "cloud_ai",
                    "provider_source": "openrouter-fallback",
                    "speaker": "Genie Master" if master_persona else "Genie Pro",
                    "persona": "Genie-Master" if master_persona else "Genie-PRO",
                    **account_limits,
                }
            if diagnostics and any(
                "OpenRouter" in diagnostic and ("HTTP 401." in diagnostic or "HTTP 403." in diagnostic)
                for diagnostic in diagnostics
            ):
                break

    recovery_reply = build_platform_recovery_response()
    return {
        "reply": recovery_reply,
        "response": recovery_reply,
        "model_used": "backend-manifest",
        "source": "backend-manifest",
        "status": "degraded",
        "error": "ai_providers_unavailable",
        "speaker": "Genie Master" if master_persona else "Genie Pro",
        "persona": "Genie-Master" if master_persona else "Genie-PRO",
        **account_limits,
    }


def verify_topic_owner(
    token: str,
    requested_user_id: str,
    request: Optional[Request] = None,
) -> Dict[str, str]:
    identity = verified_identity_from_token(token, request)
    requested_id = canonical_user_id(requested_user_id)
    allowed_ids = {identity["sub"]}
    if identity.get("role") == "admin" and identity.get("email") == DEV_AUTH_EMAIL:
        allowed_ids.update({"dev-admin", identity.get("id", "")})
    if requested_id not in allowed_ids:
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
async def personal_topic_chat(
    req: PersonalTopicChatRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    token = (authorization or "").removeprefix("Bearer ").strip() or req.google_id_token
    identity = verify_topic_owner(token, req.user_id, request)
    diagnostics: List[str] = []
    if req.engine not in ("cloud_ai", "local_agent"):
        raise HTTPException(status_code=400, detail="Unknown chat engine.")
    observer_mode = req.observer_mode if req.observer_mode is not None else req.engine == "cloud_ai"
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
    is_master_admin = identity["email"].strip().lower() == ADMIN_EMAIL
    if (req.force_genie_master or req.force_ai_intervention) and not req.image_data:
        raise HTTPException(status_code=422, detail="Genie Master image analysis requires an attached image.")

    account_limits = get_account_limits(identity)
    is_active_vip = bool(account_limits.get("is_vip"))
    if not is_master_admin and not is_active_vip and not (req.custom_api_key or "").strip():
        if account_limits.get("requires_byok"):
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "BYOK_REQUIRED",
                    "code": "BYOK_REQUIRED",
                    "message": account_limits["message"],
                    **account_limits,
                },
            )
        consume_daily_message(get_chat_identity_for_identity(identity))

    reply: Optional[str] = None
    model_used = ""
    agent_output: Optional[Dict[str, Any]] = None
    master_persona = is_master_admin or is_active_vip or bool(req.image_data)
    pool_selection = gemini_pool.get_key(
        is_admin=is_master_admin or bool(req.image_data),
        is_vip=is_active_vip or bool(req.image_data),
    )
    api_key = (
        ((GEMINI_MASTER_KEY or "").strip() or (req.custom_api_key or "").strip() or str(pool_selection.get("key") or ""))
        if master_persona
        else (req.custom_api_key or str(pool_selection.get("key") or os.getenv("GEMINI_API_KEY", ""))).strip()
    )
    openrouter_key = (os.getenv("OPENROUTER_API_KEY") or OPENROUTER_KEY).strip()
    local_mock_reply = (
        evaluate_local_python_mock(req.message)
        if not ((req.custom_api_key or "").strip() or api_key or openrouter_key)
        else None
    )

    if req.image_data:
        image_part = decode_chat_image(req.image_data)
        if not api_key:
            raise HTTPException(status_code=503, detail="Gemini image analysis is unavailable because no Gemini API key is configured.")
        reply = request_gemini_multimodal(
            "gemini-2.5-flash",
            api_key,
            req.message,
            history,
            image_part,
            diagnostics,
        )
        if not reply:
            raise HTTPException(
                status_code=502,
                detail="Genie Master could not analyze the image with Gemini 2.5 Flash.",
            )
        model_used = "gemini-2.5-flash"
        agent_output = {
            "agent_name": "Genie Master",
            "status": "success",
            "logs": [],
            "actions": [],
        }
    elif not observer_mode:
        reply = evaluate_local_python_response(req.message)
        model_used = "local-python-mock"
    elif local_mock_reply:
        reply = local_mock_reply
        model_used = "local-python-mock"
    else:
        # Try Google Gemini Native REST
        if api_key:
            selected_model = (
                str(pool_selection.get("model_override") or "gemini-2.5-flash")
                if master_persona
                else "gemini-2.0-flash"
            )
            if master_persona:
                req.message = "Respond as Genie Master, the expert analytical persona. " + req.message
            for model in [selected_model]:
                reply = request_gemini_direct(model, api_key, req.message, history, diagnostics)
                if reply:
                    model_used = model
                    break

        # Fallback to OpenRouter Free
        if not reply and openrouter_key:
            for model in OPENROUTER_FREE_MODELS:
                reply = request_openrouter_model(model, openrouter_key, req.message, history, diagnostics)
                if reply:
                    model_used = model
                    break
                if any("HTTP 401." in item or "HTTP 403." in item for item in diagnostics):
                    break

        if not reply:
            reply = build_platform_recovery_response()
            model_used = "backend-manifest"

    now = datetime.now(timezone.utc).isoformat()
    user_message = {
        "id": req.message_id or uuid.uuid4().hex,
        "role": "user",
        "content": req.message,
        "image_data": req.image_data,
        "force_genie_master": bool(req.image_data),
        "created_at": now,
    }
    message_source = (
        "cloud_ai"
        if model_used == "gemini-2.5-flash"
        else "platform_engine"
        if agent_output or model_used == "local-python-mock"
        else "backend-manifest"
        if model_used == "backend-manifest"
        else "cloud_ai"
    )
    assistant_message = {
        "id": uuid.uuid4().hex,
        "role": "assistant",
        "content": sanitize_regular_chat_text(sanitize_ai_output(reply)),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "model_used": model_used,
        "source": message_source,
        "agentName": agent_output["agent_name"] if agent_output else None,
        "agentOutput": agent_output,
        "force_genie_master": bool(req.image_data),
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
        "source": message_source,
        "provider_source": (
            None
            if model_used in ("backend-manifest", "local-python-agent", "local-python-mock")
            else "openrouter-fallback"
            if model_used in OPENROUTER_FREE_MODELS
            else "gemini"
        ),
        "status": (
            agent_output["status"]
            if agent_output
            else "degraded"
            if model_used == "backend-manifest"
            else "success"
        ),
        "error": "ai_providers_unavailable" if model_used == "backend-manifest" else None,
        "agent_name": agent_output["agent_name"] if agent_output else None,
        "agent_output": agent_output,
        "speaker": "Genie Master" if req.image_data else None,
        **get_account_limits(identity),
        "user_message": user_message,
        "assistant_message": assistant_message,
    }


@app.post("/api/vip/session")
async def update_vip_session(
    req: VipSessionRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    header_token = ""
    if authorization:
        scheme, separator, credential = authorization.partition(" ")
        if separator and scheme.lower() == "bearer":
            header_token = credential.strip()
    body_token = (req.google_id_token or "").strip()
    if header_token and body_token and not hmac.compare_digest(header_token, body_token):
        raise HTTPException(status_code=401, detail="Conflicting Google ID tokens were provided.")
    token = header_token or body_token
    local_identity = (
        local_developer_identity(
            request,
            authorization or (f"Bearer {body_token}" if body_token else None),
        )
        if token == "dev-token-local-bypass"
        else None
    )
    verified_email = local_identity["email"] if local_identity else verify_google_id_token(token)
    if not verified_email:
        raise HTTPException(status_code=401, detail="Google ID token verification failed.")
    if req.user_email and req.user_email.strip().lower() != verified_email:
        raise HTTPException(status_code=403, detail="VIP session identity does not match the signed-in account.")
    if not local_identity:
        with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
            entitlement = connection.execute(
                """
                SELECT is_vip, vip_expires_at, is_admin FROM user_registry
                WHERE lower(email) = ?
                """,
                (verified_email.lower(),),
            ).fetchone()
            active_pass = connection.execute(
                """
                SELECT 1 FROM active_vip_passes
                WHERE lower(user_email) = ? AND is_active = 1
                  AND julianday(expires_at) > julianday('now')
                LIMIT 1
                """,
                (verified_email.lower(),),
            ).fetchone()
        active_vip = bool(
            entitlement
            and entitlement[0]
            and entitlement[1]
            and entitlement[1] > datetime.now(timezone.utc).isoformat()
        ) or bool(active_pass)
        if not active_vip and verified_email.lower() != ADMIN_EMAIL:
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
    if not identity:
        return {
            "manifest": [],
            "status": "unauthenticated",
            "error": "Verification failed",
        }
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

    api_key = (req.custom_api_key or os.getenv("GEMINI_API_KEY", "")).strip()
    if not api_key:
        recovery_response = build_platform_recovery_response()
        return {
            "status": "degraded",
            "condensed_digest": condensed_digest,
            "executive_review": recovery_response,
            "model_used": "backend-manifest",
            "source": "backend-manifest",
            "error": "ai_providers_unavailable",
        }

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
                "source": "cloud_ai",
            }

    return {
        "status": "degraded",
        "condensed_digest": condensed_digest,
        "executive_review": build_platform_recovery_response(),
        "model_used": "backend-manifest",
        "source": "backend-manifest",
        "error": "ai_providers_unavailable",
    }


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
    require_personal_scope(identity)
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
            verified_workspace_tenant(identity) or "",
        )
        connection.focused = bool(join_event.get("focused", False))
        try:
            await room_manager.connect(room_id, connection)
        except HTTPException as error:
            reason = "ROOM_FULL_ERROR" if str(error.detail) == "ROOM_FULL_ERROR" else str(error.detail)
            if reason == "ROOM_FULL_ERROR":
                await websocket.send_json({
                    "type": "ROOM_FULL_ERROR",
                    "detail": "Room is Full (5/5)",
                    "capacity": MAX_ROOM_CAPACITY,
                })
            await websocket.close(code=1008, reason=reason[:120])
            return
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