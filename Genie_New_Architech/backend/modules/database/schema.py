from __future__ import annotations

import sqlite3


def _columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {
        str(row["name"])
        for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
    }


def _add_columns(
    connection: sqlite3.Connection, table: str, declarations: dict[str, str]
) -> None:
    existing = _columns(connection, table)
    for name, declaration in declarations.items():
        if name not in existing:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {name} {declaration}")


def _remove_message_reaction_room_message_foreign_key(
    connection: sqlite3.Connection,
) -> None:
    if not _columns(connection, "message_reactions"):
        return
    if not connection.execute("PRAGMA foreign_key_list(message_reactions)").fetchall():
        return
    connection.execute(
        """
        CREATE TABLE message_reactions_rebuilt (
            message_id TEXT NOT NULL,
            owner_username TEXT NOT NULL,
            reactor_username TEXT NOT NULL,
            target_type TEXT NOT NULL CHECK(target_type IN ('user_message', 'ai_response')),
            reaction_emoji TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY(message_id, reactor_username, target_type)
        )
        """
    )
    connection.execute(
        """
        INSERT OR IGNORE INTO message_reactions_rebuilt(
            message_id, owner_username, reactor_username, target_type,
            reaction_emoji, created_at
        )
        SELECT message_id, owner_username, reactor_username, target_type,
               reaction_emoji, created_at
        FROM message_reactions
        """
    )
    connection.execute("DROP TABLE message_reactions")
    connection.execute("ALTER TABLE message_reactions_rebuilt RENAME TO message_reactions")


def initialize_archive_schema(connection: sqlite3.Connection) -> None:
    """Apply additive, isolated-archive migrations without importing legacy data."""
    _add_columns(
        connection,
        "rooms",
        {"voice_dialect": "TEXT NOT NULL DEFAULT 'en-IN'"},
    )
    _add_columns(
        connection,
        "users",
        {
            "username": "TEXT",
            "geo_region_hash": "TEXT",
            "friend_circle_mode": "TEXT NOT NULL DEFAULT 'mutuals_only'",
            "lookup_visibility": "TEXT NOT NULL DEFAULT 'mutual_contacts_only'",
            "allow_broader_discovery": "INTEGER NOT NULL DEFAULT 0",
            "default_dialect": "TEXT NOT NULL DEFAULT 'en-IN'",
            "presence_override": "TEXT NOT NULL DEFAULT 'online'",
            "telemetry_enabled": "INTEGER NOT NULL DEFAULT 0",
            "is_vip": "INTEGER NOT NULL DEFAULT 0",
            "registration_complete": "INTEGER NOT NULL DEFAULT 0",
            "display_name": "TEXT",
            "bio": "TEXT NOT NULL DEFAULT ''",
            "city_region": "TEXT",
            "custom_picture_data": "TEXT",
            "profile_visibility": "TEXT NOT NULL DEFAULT 'mutuals'",
            "presence_visibility": "TEXT NOT NULL DEFAULT 'mutuals'",
            "directory_visibility": "TEXT NOT NULL DEFAULT 'mutuals'",
            "preview_profile": "INTEGER NOT NULL DEFAULT 0",
        },
    )
    _add_columns(
        connection,
        "messages",
        {
            "user_created_at": "TEXT",
            "ai_responded_at": "TEXT",
            "updated_at": "TEXT",
            "is_edited": "INTEGER NOT NULL DEFAULT 0",
            "edited_by": "TEXT",
            "reply_to_ids": "TEXT NOT NULL DEFAULT '[]'",
            "ai_review_count": "INTEGER NOT NULL DEFAULT 0",
            "ai_reviewed_at": "TEXT",
            "ai_reviewed_by": "TEXT",
            "ai_resolution_msg_id": "TEXT",
        },
    )
    _add_columns(
        connection,
        "friend_requests",
        {
            "is_cross_geo": "INTEGER NOT NULL DEFAULT 0",
            "sender_attested_personal": "INTEGER NOT NULL DEFAULT 0",
            "sender_attested_at": "TEXT",
            "receiver_attested_personal": "INTEGER NOT NULL DEFAULT 0",
            "receiver_attested_at": "TEXT",
        },
    )
    _remove_message_reaction_room_message_foreign_key(connection)
    connection.executescript(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
            ON users(username) WHERE username IS NOT NULL;
        CREATE TABLE IF NOT EXISTS message_reactions (
                message_id TEXT NOT NULL,
            owner_username TEXT NOT NULL,
            reactor_username TEXT NOT NULL,
            target_type TEXT NOT NULL CHECK(target_type IN ('user_message', 'ai_response')),
            reaction_emoji TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY(message_id, reactor_username, target_type)
        );
        CREATE TABLE IF NOT EXISTS room_ai_responses (
            id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            owner_sub TEXT NOT NULL,
            ciphertext TEXT NOT NULL,
            visibility TEXT NOT NULL DEFAULT 'group' CHECK(visibility IN ('private', 'group')),
            created_at TEXT NOT NULL,
            ai_responded_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_room_ai_responses_room_time
            ON room_ai_responses(room_id, visibility, ai_responded_at);
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            recipient_username TEXT NOT NULL,
            message_id TEXT NOT NULL,
            notification_type TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL,
            read_at TEXT
        );
        CREATE TABLE IF NOT EXISTS general_query_cache (
            query_hash TEXT PRIMARY KEY,
            reply TEXT NOT NULL,
            expires_at REAL NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_recipient_time
            ON notifications(recipient_username, created_at DESC);
        CREATE TABLE IF NOT EXISTS message_read_receipts (
            message_id TEXT NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
            user_sub TEXT NOT NULL,
            read_at TEXT NOT NULL,
            PRIMARY KEY(message_id, user_sub)
        );
        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            owner_sub TEXT NOT NULL,
            chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
            room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
            ciphertext TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            user_sub TEXT NOT NULL,
            endpoint_hash TEXT NOT NULL,
            subscription_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(user_sub, endpoint_hash)
        );
        CREATE TABLE IF NOT EXISTS used_inline_reply_tokens (
            token_id TEXT PRIMARY KEY,
            consumed_at TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS room_invites (
            id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            invite_hash TEXT NOT NULL UNIQUE,
            passcode_hash TEXT NOT NULL,
            max_uses INTEGER NOT NULL CHECK(max_uses > 0),
            uses_count INTEGER NOT NULL DEFAULT 0 CHECK(uses_count >= 0),
            expires_at TEXT,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            revoked_at TEXT
        );
        CREATE TABLE IF NOT EXISTS sovereign_state (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            sovereign_claimed INTEGER NOT NULL DEFAULT 0,
            claimed_by TEXT,
            claimed_at TEXT,
            totp_secret_encrypted TEXT,
            totp_verified_at TEXT
        );
        INSERT OR IGNORE INTO sovereign_state(id, sovereign_claimed) VALUES (1, 0);
        CREATE TABLE IF NOT EXISTS vip_passes (
            id TEXT PRIMARY KEY,
            code_hash TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'revoked', 'claimed')),
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            claimed_by TEXT,
            claimed_at TEXT,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS anon_telemetry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            day TEXT NOT NULL,
            pseudonym TEXT NOT NULL,
            session_minutes INTEGER NOT NULL DEFAULT 0,
            prompt_count INTEGER NOT NULL DEFAULT 0,
            last_seen_at TEXT NOT NULL,
            UNIQUE(day, pseudonym)
        );
        CREATE INDEX IF NOT EXISTS idx_anon_telemetry_day ON anon_telemetry(day);
        """
    )
    _add_columns(connection, "room_invites", {"invitee_username": "TEXT"})
    _add_columns(
        connection,
        "room_messages",
        {
            "user_created_at": "TEXT",
            "ai_responded_at": "TEXT",
            "updated_at": "TEXT",
            "is_edited": "INTEGER NOT NULL DEFAULT 0",
            "edited_by": "TEXT",
            "reply_to_ids": "TEXT NOT NULL DEFAULT '[]'",
            "ai_review_count": "INTEGER NOT NULL DEFAULT 0",
            "ai_reviewed_at": "TEXT",
            "ai_reviewed_by": "TEXT",
            "ai_resolution_msg_id": "TEXT",
        },
    )
    connection.execute(
        "UPDATE messages SET user_created_at = created_at WHERE user_created_at IS NULL"
    )
    connection.execute(
        "UPDATE room_messages SET user_created_at = sent_at WHERE user_created_at IS NULL"
    )
    connection.execute(
        "UPDATE room_messages SET ai_responded_at = review_at "
        "WHERE ai_responded_at IS NULL AND review_at IS NOT NULL"
    )
