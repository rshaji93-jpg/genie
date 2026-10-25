from __future__ import annotations

import logging
import sqlite3
import threading
import time
from pathlib import Path

LOGGER = logging.getLogger("genie.keep_alive")
_START_LOCK = threading.Lock()
_THREAD: threading.Thread | None = None


def _warm_muscle_index() -> None:
    try:
        try:
            from .muscle_engine import get_muscle_engine
        except ImportError:
            from modules.muscle_engine import get_muscle_engine
        engine = get_muscle_engine()
        with engine.connect() as connection:
            connection.execute("SELECT count(*) FROM muscle_core").fetchone()
    except (OSError, sqlite3.Error, ImportError):
        LOGGER.exception("Could not warm the local Muscle index.")


def _sync_archive(source_path: Path, target_path: Path) -> None:
    if not source_path.exists():
        return
    source: sqlite3.Connection | None = None
    target: sqlite3.Connection | None = None
    try:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        source = sqlite3.connect(source_path, timeout=0.5)
        target = sqlite3.connect(target_path, timeout=0.5)
        source.backup(target, pages=256, sleep=0.01)
    except (OSError, sqlite3.Error):
        LOGGER.exception("Could not sync the local SQLite archive to persistent storage.")
    finally:
        if target is not None:
            target.close()
        if source is not None:
            source.close()


def _run(source_path: Path, target_path: Path | None, interval_seconds: int) -> None:
    while True:
        _warm_muscle_index()
        if target_path is not None:
            _sync_archive(source_path, target_path)
        time.sleep(interval_seconds)


def start_keep_alive(
    source_path: str | Path,
    target_path: str | Path | None = None,
    interval_seconds: int = 60,
) -> None:
    global _THREAD
    if interval_seconds < 1:
        raise ValueError("interval_seconds must be positive.")
    with _START_LOCK:
        if _THREAD and _THREAD.is_alive():
            return
        thread = threading.Thread(
            target=_run,
            args=(
                Path(source_path),
                Path(target_path) if target_path is not None else None,
                interval_seconds,
            ),
            name="genie-keep-alive",
            daemon=True,
        )
        thread.start()
        _THREAD = thread
