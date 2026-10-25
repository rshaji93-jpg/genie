from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import sqlite3
import uuid
import xml.etree.ElementTree as ElementTree
from contextlib import closing
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

LOGGER = logging.getLogger("genie.circle_feeds")
_ALLOWED_CONTENT_TYPES = ("application/rss+xml", "application/atom+xml", "application/xml", "text/xml")


class FeedSyncRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=5)
    room_id: str | None = Field(default=None, max_length=100)
    visibility: str = Field(default="private", max_length=120)


def initialize_feed_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS circle_feeds (
            id TEXT PRIMARY KEY,
            owner_sub TEXT NOT NULL,
            visibility TEXT NOT NULL,
            room_id TEXT,
            source_title TEXT NOT NULL DEFAULT '',
            source_url TEXT NOT NULL,
            owner_name TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            ttl_expires_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_circle_feeds_identity
            ON circle_feeds(owner_sub, source_url, visibility);
        CREATE INDEX IF NOT EXISTS idx_circle_feeds_scope
            ON circle_feeds(visibility, room_id, ttl_expires_at);
        CREATE TABLE IF NOT EXISTS circle_feed_items (
            id TEXT PRIMARY KEY,
            feed_id TEXT NOT NULL REFERENCES circle_feeds(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            source_url TEXT NOT NULL,
            published_at TEXT NOT NULL,
            fetched_at TEXT NOT NULL,
            UNIQUE(feed_id, source_url)
        );
        CREATE INDEX IF NOT EXISTS idx_circle_feed_items_feed
            ON circle_feed_items(feed_id, published_at DESC);
        """
    )


def create_circle_feeds_router(
    database: Callable[[], sqlite3.Connection],
    identity_dependency: Callable[..., Any],
    room_member: Callable[[str, dict[str, str]], None],
) -> APIRouter:
    router = APIRouter()

    async def _validate_public_url(url: str) -> str:
        parsed = urlsplit(url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or len(url) > 2048
        ):
            raise HTTPException(status_code=422, detail="Feed URLs must be public HTTP(S) URLs.")
        host = parsed.hostname.rstrip(".").casefold()
        if host in {"localhost", "localhost.localdomain"}:
            raise HTTPException(status_code=422, detail="Local feed URLs are not allowed.")
        try:
            records = await asyncio.to_thread(
                socket.getaddrinfo, host, parsed.port or (443 if parsed.scheme == "https" else 80)
            )
        except OSError as error:
            raise HTTPException(status_code=422, detail="Feed host could not be resolved.") from error
        addresses = {record[4][0] for record in records}
        if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
            raise HTTPException(status_code=422, detail="Feed URLs must resolve to public addresses.")
        return url

    async def _fetch_headlines(url: str) -> tuple[str, list[tuple[str, str, str]]]:
        try:
            async with httpx.AsyncClient(timeout=2.5, follow_redirects=False) as client:
                response = await client.get(url, headers={"Accept": ", ".join(_ALLOWED_CONTENT_TYPES)})
                response.raise_for_status()
        except httpx.HTTPError as error:
            LOGGER.info("Feed fetch failed for a configured public URL (%s).", type(error).__name__)
            raise HTTPException(status_code=502, detail="The feed could not be fetched.") from error
        content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().casefold()
        if content_type and content_type not in _ALLOWED_CONTENT_TYPES:
            raise HTTPException(status_code=422, detail="The URL did not return an RSS or Atom feed.")
        try:
            root = ElementTree.fromstring(response.content[:1_000_000])
        except ElementTree.ParseError as error:
            raise HTTPException(status_code=422, detail="The response is not valid RSS or Atom XML.") from error
        channel = root.find("./channel")
        source_title = (
            (channel.findtext("title") or "").strip()
            if channel is not None
            else (root.findtext("{http://www.w3.org/2005/Atom}title") or "").strip()
        )
        entries: list[tuple[str, str, str]] = []
        for entry in list(root.findall("./channel/item"))[:30]:
            title = (entry.findtext("title") or "").strip()
            link = (entry.findtext("link") or "").strip()
            published = (entry.findtext("pubDate") or "").strip() or datetime.now(timezone.utc).isoformat()
            if title and link.startswith(("https://", "http://")):
                entries.append((title[:500], link[:2048], published[:100]))
        atom_namespace = "{http://www.w3.org/2005/Atom}"
        if not entries:
            for entry in root.findall(f"{atom_namespace}entry")[:30]:
                title = (entry.findtext(f"{atom_namespace}title") or "").strip()
                link_element = entry.find(f"{atom_namespace}link")
                link = link_element.get("href", "") if link_element is not None else ""
                published = (
                    entry.findtext(f"{atom_namespace}published")
                    or entry.findtext(f"{atom_namespace}updated")
                    or datetime.now(timezone.utc).isoformat()
                )
                if title and link.startswith(("https://", "http://")):
                    entries.append((title[:500], link[:2048], published[:100]))
        return source_title[:200] or url, entries

    @router.post("/feeds/sync")
    async def sync_feeds(
        request: FeedSyncRequest,
        identity: dict[str, str] = Depends(identity_dependency),
    ) -> dict[str, Any]:
        if request.visibility == "private":
            room_id = None
        elif request.visibility.startswith("circle:"):
            room_id = request.visibility.removeprefix("circle:").strip()
            if not room_id or (request.room_id and request.room_id != room_id):
                raise HTTPException(status_code=422, detail="Circle visibility must name one room.")
            room_member(room_id, identity)
            with closing(database()) as connection:
                room = connection.execute(
                    "SELECT group_slot FROM rooms WHERE id = ?", (room_id,)
                ).fetchone()
            if not room or room["group_slot"] is None:
                raise HTTPException(status_code=403, detail="Circle feeds are only available in group rooms.")
            request.visibility = f"circle:{room_id}"
        else:
            raise HTTPException(status_code=422, detail="Visibility must be private or circle:<group_id>.")

        urls = [await _validate_public_url(url.strip()) for url in request.urls]
        results = await asyncio.gather(*(_fetch_headlines(url) for url in urls))
        now = datetime.now(timezone.utc)
        expires = (now + timedelta(days=7)).isoformat()
        synced = 0
        with closing(database()) as connection:
            initialize_feed_schema(connection)
            for url, (source_title, items) in zip(urls, results):
                feed_id = connection.execute(
                    """
                    SELECT id FROM circle_feeds
                    WHERE owner_sub = ? AND source_url = ? AND visibility = ?
                    """,
                    (identity["sub"], url, request.visibility),
                ).fetchone()
                current_feed_id = feed_id["id"] if feed_id else str(uuid.uuid4())
                connection.execute(
                    """
                    INSERT INTO circle_feeds(
                        id, owner_sub, visibility, room_id, source_title, source_url,
                        owner_name, created_at, ttl_expires_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(owner_sub, source_url, visibility) DO UPDATE SET
                        source_title = excluded.source_title,
                        owner_name = excluded.owner_name,
                        ttl_expires_at = excluded.ttl_expires_at
                    """,
                    (
                        current_feed_id,
                        identity["sub"],
                        request.visibility,
                        room_id,
                        source_title,
                        url,
                        identity.get("name", "User")[:120],
                        now.isoformat(),
                        expires,
                    ),
                )
                connection.execute("DELETE FROM circle_feed_items WHERE feed_id = ?", (current_feed_id,))
                connection.executemany(
                    """
                    INSERT OR IGNORE INTO circle_feed_items(
                        id, feed_id, title, source_url, published_at, fetched_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (str(uuid.uuid4()), current_feed_id, title, link, published, now.isoformat())
                        for title, link, published in items
                    ],
                )
                synced += len(items)
            connection.commit()
        return {"ok": True, "synced_headlines": synced, "feeds": len(urls), "ttl_expires_at": expires}

    @router.get("/feeds/circle")
    async def circle_feed_items(
        room_id: str = Query(min_length=1, max_length=100),
        identity: dict[str, str] = Depends(identity_dependency),
    ) -> dict[str, Any]:
        room_member(room_id, identity)
        with closing(database()) as connection:
            initialize_feed_schema(connection)
            rows = connection.execute(
                """
                SELECT i.title, i.source_url, i.published_at, f.source_title,
                       f.owner_name, f.created_at, f.ttl_expires_at
                FROM circle_feed_items i
                JOIN circle_feeds f ON f.id = i.feed_id
                JOIN room_members rm ON rm.room_id = f.room_id
                WHERE f.visibility = ? AND rm.user_sub = ?
                    AND f.ttl_expires_at > ?
                ORDER BY i.published_at DESC LIMIT 100
                """,
                (f"circle:{room_id}", identity["sub"], datetime.now(timezone.utc).isoformat()),
            ).fetchall()
        return {"ok": True, "items": [dict(row) for row in rows]}

    return router
