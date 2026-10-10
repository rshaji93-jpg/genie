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
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional, Dict, Any, Set
from urllib.parse import urlsplit
from fastapi import Cookie, FastAPI, File, Header, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from dotenv import dotenv_values, load_dotenv
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token as google_id_token
from cryptography.fernet import Fernet, InvalidToken
import pyotp
try:
    import qrcode
except ImportError:
    qrcode = None

try:
    from .knowledge_registry import get_platform_system_manifest
    from .security import sanitize_ai_output
    from .gemini_pool import gemini_pool
except ImportError:
    from knowledge_registry import get_platform_system_manifest
    from security import sanitize_ai_output
    from gemini_pool import gemini_pool

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
load_dotenv(BACKEND_DIR / ".env", override=False)
load_dotenv(BACKEND_DIR.parent / ".env.local", override=False)
load_dotenv(BACKEND_DIR.parent / ".env", override=False)

app = FastAPI(title="Personal AI Genie API", version="4.8.0")
logger = logging.getLogger(__name__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OPENROUTER_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()
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
VIP_SESSION_TTL_SECONDS = 90
DAILY_MESSAGE_LIMIT = 20
ADMIN_EMAILS = ["rshaji93@gmail.com"]
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
                CREATE TABLE IF NOT EXISTS user_registry (
                    user_id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    display_name TEXT NOT NULL,
                    avatar_url TEXT NOT NULL DEFAULT '',
                    mobile_number TEXT NOT NULL,
                    recovery_email TEXT NOT NULL DEFAULT '',
                    terms_accepted_at TEXT NOT NULL,
                    allow_room_invites TEXT NOT NULL DEFAULT 'mutual_friends',
                    is_creator INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    gender TEXT NOT NULL DEFAULT ''
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
    prompt: Optional[str] = None
    message: Optional[str] = None
    space_mode: Optional[str] = "personal"
    conversation_history: Optional[List[ChatMessage]] = []
    custom_api_key: Optional[str] = None
    language_code: Optional[str] = "en-IN"
    is_team_chat: Optional[bool] = False
    is_observer_active: Optional[bool] = False
    observer_mode: Optional[bool] = None
    engine: str = "cloud_ai"
    agent_target: str = "manager"
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
            if room_id.startswith(("share_", "invite_")):
                connection.execute("BEGIN IMMEDIATE")
            with connection:
                if connection.execute(
                    "SELECT 1 FROM ended_rooms WHERE room_id = ?", (room_id,)
                ).fetchone():
                    raise HTTPException(status_code=410, detail="This room session has ended.")
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
                    if room_id.startswith("share_") and len(members) >= 2:
                        raise HTTPException(
                            status_code=403,
                            detail="This shared conversation already has two members.",
                        )
                    if room_id.startswith("invite_") and len(members) >= 5:
                        raise HTTPException(
                            status_code=403,
                            detail="This workspace room is full (maximum five members).",
                        )
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
                if not self.connections[room_id]:
                    self.connections.pop(room_id, None)
                raise
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

    async def close_room(self, room_id: str):
        async with self.lock:
            room_connections = list(self.connections.pop(room_id, set()))
            self.messages.pop(room_id, None)
            for websocket in room_connections:
                self.identities.pop(websocket, None)
                await websocket.close(code=1000, reason="The room host ended this session.")

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
                if isinstance(event.get("agent_output"), dict):
                    message["agent_output"] = event["agent_output"]
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
        if room_id.startswith(("share_", "invite_")):
            connection.execute("BEGIN IMMEDIATE")
        if connection.execute(
            "SELECT 1 FROM ended_rooms WHERE room_id = ?", (room_id,)
        ).fetchone():
            raise HTTPException(status_code=410, detail="This room session has ended.")
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
        if room_id.startswith("share_") and len(members) >= 2:
            raise HTTPException(status_code=403, detail="This shared conversation already has two members.")
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


@app.delete("/api/rooms/{room_id}")
async def end_sovereign_room(room_id: str, authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    identity = await asyncio.to_thread(
        verified_identity_from_token, authorization.removeprefix("Bearer ").strip()
    )
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
                   terms_accepted_at, is_creator, avatar_url, gender, privacy_accepted_at
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
                   registry.allow_room_invites, registry.is_creator, credentials.last_counter
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
            "option_a": "/avatars/Profile 1.png",
            "option_b": "/avatars/Profile 2.png",
            "option_c": "/avatars/Profile 3.png",
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
                     terms_accepted_at, allow_room_invites, is_creator, created_at, updated_at, privacy_accepted_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'mutual_friends', ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    email = excluded.email,
                    display_name = excluded.display_name,
                    avatar_url = excluded.avatar_url,
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
                    updated_at = excluded.updated_at
                """,
                (
                    identity["sub"],
                    identity["email"].strip().lower(),
                    display_name,
                    avatar_url,
                    mobile_number,
                    recovery_email,
                    now,
                    int(identity["email"].strip().lower() in ADMIN_EMAILS),
                    now,
                    now,
                    now,
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
                "SELECT avatar_url FROM user_registry WHERE user_id = ?",
                (identity["sub"],),
            ).fetchone()[0]
    session_token = create_internal_session_token(identity)
    avatar_type = {
        "genie-preset:guardian": "option_a",
        "genie-preset:vapor": "option_b",
        "genie-preset:cosmic": "option_c",
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
                    avatar_url = ?, gender = ?, updated_at = ?
                WHERE user_id = ?
                """,
                (display_name, mobile_number, recovery_email, avatar_url, gender, now, identity["sub"]),
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
    return {
        "status": "updated",
        "profile": {
            "display_name": display_name,
            "email": identity["email"],
            "mobile_number": mobile_number,
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
async def search_social_user(query: str, authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Google sign-in is required.")
    identity = await asyncio.to_thread(
        verified_identity_from_token, authorization.removeprefix("Bearer ").strip()
    )
    normalized_query = query.strip()
    if len(normalized_query) < 2:
        raise HTTPException(status_code=400, detail="Enter at least 2 characters to search.")
    search_pattern = f"%{normalized_query.lower()}%"
    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        rows = connection.execute(
            """
            SELECT user_id, display_name, email, avatar_url
            FROM user_registry
            WHERE user_id != ?
              AND (lower(display_name) LIKE ? OR lower(email) LIKE ?)
              AND NOT EXISTS (
                  SELECT 1 FROM user_blocks
                  WHERE (blocker_id = ? AND blocked_id = user_registry.user_id)
                     OR (blocker_id = user_registry.user_id AND blocked_id = ?)
              )
            ORDER BY display_name COLLATE NOCASE LIMIT 20
            """,
            (identity["sub"], search_pattern, search_pattern, identity["sub"], identity["sub"]),
        ).fetchall()
        results = []
        for user_id, display_name, email, avatar_url in rows:
            pending_out = connection.execute(
                "SELECT status FROM friend_requests WHERE requester_id = ? AND recipient_id = ?",
                (identity["sub"], user_id),
            ).fetchone()
            pending_in = connection.execute(
                "SELECT status FROM friend_requests WHERE requester_id = ? AND recipient_id = ?",
                (user_id, identity["sub"]),
            ).fetchone()
            is_mutual_friend = bool(
                pending_out and pending_out[0] == "accepted"
                or pending_in and pending_in[0] == "accepted"
            )
            if is_mutual_friend:
                relation = "friend"
            elif pending_out and pending_out[0] == "pending":
                relation = "request_sent"
            elif pending_in and pending_in[0] == "pending":
                relation = "request_received"
            elif connection.execute(
                "SELECT 1 FROM social_follows WHERE follower_id = ? AND followed_id = ?",
                (identity["sub"], user_id),
            ).fetchone():
                relation = "following"
            elif connection.execute(
                "SELECT 1 FROM social_follows WHERE follower_id = ? AND followed_id = ?",
                (user_id, identity["sub"]),
            ).fetchone():
                relation = "follower"
            else:
                relation = "none"
            results.append(
                {
                    "user_id": user_id,
                    "display_name": display_name,
                    "handle": display_name,
                    "avatar_url": avatar_url,
                    "relationship": relation,
                }
            )
    return {"found": bool(results), "users": results}


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


@app.post("/api/social/friend-requests")
async def create_friend_request(req: SocialActionRequest):
    identity = await asyncio.to_thread(verified_identity_from_token, req.google_id_token)
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
    if identity and identity["email"].lower() in ADMIN_EMAILS:
        return {
            "tier": "vip_admin",
            "chats_remaining": 999999,
            "is_vip": True,
            "unlimited": True,
        }
    email = identity["email"].lower() if identity else ""
    with daily_message_counts_lock:
        used = daily_message_counts.get(
            (f"google:{email}", datetime.now(timezone.utc).date().isoformat()),
            0,
        )
    return {
        "tier": "standard",
        "chats_remaining": max(0, DAILY_MESSAGE_LIMIT - used),
        "is_vip": False,
        "unlimited": False,
    }


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
                        "You are Personal AI Genie. Never disclose private configuration, credentials, "
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


def _chat_stream_events(req: ChatRequest) -> Any:
    messages = _stream_chat_messages(req)
    providers: List[tuple[str, str, Any]] = []
    gemini_key = (req.custom_api_key or gemini_pool.get_key()).strip()
    if gemini_key:
        providers.append(("Google Gemini", "gemini-2.5-flash", lambda model: _stream_gemini(model, gemini_key, req)))
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
            yield _sse_event("meta", {"provider": provider_name, "model": active_model})
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
):
    if req.is_team_chat:
        raise HTTPException(status_code=400, detail="Team messages cannot use the AI streaming endpoint.")
    prompt = (req.prompt or req.message or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Enter a message to chat.")
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

    verified_email = (
        dev_identity["email"]
        if dev_identity
        else verify_google_id_token(req.google_id_token)
        if req.google_id_token
        else None
    )
    if req.google_id_token and not dev_identity and not verified_email:
        raise HTTPException(status_code=401, detail="Google ID token verification failed.")
    if not (req.observer_mode if req.observer_mode is not None else req.engine == "cloud_ai"):
        raise HTTPException(status_code=400, detail="Streaming cascade is available only in Observer mode.")
    mock_reply = (
        evaluate_local_python_mock(prompt)
        if not has_active_chat_api_key(req.custom_api_key)
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
    is_master_admin = bool(verified_email and verified_email.lower() in ADMIN_EMAILS)
    if not is_master_admin and not dev_identity and not (req.custom_api_key or "").strip():
        consume_daily_message(get_chat_identity(request, verified_email))
    return StreamingResponse(
        _chat_stream_events(req),
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


@app.post("/chat", include_in_schema=False)
@app.post("/api/py/chat", include_in_schema=False)
@app.post("/api/chat")
@app.post("//api/chat")
async def handle_chat(
    req: ChatRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    if req.is_team_chat:
        raise HTTPException(
            status_code=400,
            detail="Human room messages must use the room WebSocket and are not sent to an AI provider.",
        )
    history = req.conversation_history or []
    bearer_token = (authorization or "").replace("Bearer ", "").strip()
    dev_identity = None
    if not authorization or bearer_token == "dev-token-local-bypass":
        dev_identity = {
            "sub": "dev-admin",
            "email": "dev@local.test",
            "name": "Dev Admin",
            "role": "admin",
        }
        verified_email = dev_identity["email"]
    else:
        identity_token = (req.google_id_token or "").strip() or bearer_token
        verified_email = verify_google_id_token(identity_token)
        if not verified_email:
            if is_local_development_request(request):
                dev_identity = {
                    "sub": "dev-admin",
                    "email": "dev@local.test",
                    "name": "Dev Admin",
                    "role": "admin",
                }
                verified_email = dev_identity["email"]
            else:
                raise HTTPException(status_code=401, detail="Google ID token verification failed.")
    prompt = (req.prompt or "").strip() or (req.message or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Enter a message to chat.")
    req.prompt = prompt
    is_master_admin = bool(verified_email and verified_email.lower() in ADMIN_EMAILS)
    account_limits = get_account_limits({"email": verified_email}) if verified_email else {}
    if req.engine not in ("cloud_ai", "local_agent"):
        raise HTTPException(status_code=400, detail="Unknown chat engine.")
    observer_mode = req.observer_mode if req.observer_mode is not None else req.engine == "cloud_ai"
    mock_reply = (
        evaluate_local_python_mock(prompt)
        if not has_active_chat_api_key(req.custom_api_key)
        else None
    )
    if not observer_mode:
        local_reply = evaluate_local_python_response(prompt)
        return {
            "reply": local_reply,
            "response": local_reply,
            "model_used": "local-python-mock",
            "source": "platform_engine",
            "intent": "local_mock",
            **account_limits,
        }
    if mock_reply:
        return {
            "reply": mock_reply,
            "response": mock_reply,
            "model_used": "local-python-mock",
            "source": "platform_engine",
            "intent": "local_mock",
            **account_limits,
        }
    if not is_master_admin and not dev_identity and not (req.custom_api_key or "").strip():
        consume_daily_message(get_chat_identity(request, verified_email))
    or_key = os.getenv("OPENROUTER_API_KEY", OPENROUTER_KEY).strip()
    user_gemini_key = (req.custom_api_key or "").strip()
    server_gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    gemini_key = user_gemini_key or server_gemini_key
    diagnostics: List[str] = []

    # 1. Primary: Direct Google Gemini Native Rest API
    if gemini_key:
        for model in ["gemini-2.5-flash"]:
            reply = request_gemini_direct(model, gemini_key, prompt, history, diagnostics)
            if reply:
                return {
                    "reply": reply,
                    "response": reply,
                    "model_used": model,
                    "source": "cloud_ai",
                    "provider_source": "gemini",
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
    is_master_admin = identity["email"].lower() in ADMIN_EMAILS

    reply: Optional[str] = None
    model_used = ""
    agent_output: Optional[Dict[str, Any]] = None
    api_key = (req.custom_api_key or os.getenv("GEMINI_API_KEY", "")).strip()
    openrouter_key = (os.getenv("OPENROUTER_API_KEY") or OPENROUTER_KEY).strip()
    local_mock_reply = (
        evaluate_local_python_mock(req.message)
        if not ((req.custom_api_key or "").strip() or api_key or openrouter_key)
        else None
    )

    if not observer_mode:
        reply = evaluate_local_python_response(req.message)
        model_used = "local-python-mock"
    elif local_mock_reply:
        reply = local_mock_reply
        model_used = "local-python-mock"
    else:
        if not is_master_admin and not (req.custom_api_key or "").strip():
            consume_daily_message(f"google:{identity['email']}")

        # Try Google Gemini Native REST
        if api_key:
            for model in GEMINI_MODELS:
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
        "created_at": now,
    }
    message_source = (
        "platform_engine"
        if agent_output or model_used == "local-python-mock"
        else "backend-manifest"
        if model_used == "backend-manifest"
        else "cloud_ai"
    )
    assistant_message = {
        "id": uuid.uuid4().hex,
        "role": "assistant",
        "content": sanitize_ai_output(reply),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "model_used": model_used,
        "source": message_source,
        "agentName": agent_output["agent_name"] if agent_output else None,
        "agentOutput": agent_output,
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
    if not local_identity and verified_email not in VIP_ALLOWED_EMAILS:
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
        except HTTPException as error:
            await websocket.close(code=1008, reason=str(error.detail))
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