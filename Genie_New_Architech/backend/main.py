from __future__ import annotations

import importlib
import logging
import re
import sys
import threading
import types
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger("genie.bootstrap")
_CORS_ORIGIN_PATTERN = re.compile(
    r"https://.*\.pages\.dev|https://.*|http://localhost:\d+"
)
_IMPLEMENTATION_NAME = (
    f"{__package__}.application" if __package__ else "application"
)
_IMPLEMENTATION_LOCK = threading.Lock()
_IMPLEMENTATION: types.ModuleType | None = None
_IMPLEMENTATION_ERROR: BaseException | None = None
_BOOTSTRAP_NAMES = {
    "LOGGER",
    "_CORS_ORIGIN_PATTERN",
    "_IMPLEMENTATION_NAME",
    "_IMPLEMENTATION_LOCK",
    "_IMPLEMENTATION",
    "_IMPLEMENTATION_ERROR",
    "_BOOTSTRAP_NAMES",
    "_load_application",
    "_load_application_in_background",
    "_LazyASGIApplication",
    "_ApplicationModule",
    "app",
}


def _load_application() -> types.ModuleType:
    global _IMPLEMENTATION, _IMPLEMENTATION_ERROR
    with _IMPLEMENTATION_LOCK:
        if _IMPLEMENTATION is not None:
            return _IMPLEMENTATION
        if _IMPLEMENTATION_ERROR is not None:
            raise RuntimeError("Backend application failed to load.") from _IMPLEMENTATION_ERROR
        try:
            from dotenv import load_dotenv

            load_dotenv(Path(__file__).parent / ".env", override=False)
            module = importlib.import_module(_IMPLEMENTATION_NAME)
            _IMPLEMENTATION = module
            return module
        except Exception as error:
            _IMPLEMENTATION_ERROR = error
            LOGGER.exception("Backend application could not be loaded.")
            raise


def _load_application_in_background() -> None:
    try:
        _load_application()._start_runtime_initialization()
    except Exception:
        LOGGER.exception("Background backend application loading failed.")


class _LazyASGIApplication:
    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    threading.Thread(
                        target=_load_application_in_background,
                        name="genie-app-loader",
                        daemon=True,
                    ).start()
                    await send({"type": "lifespan.startup.complete"})
                elif message["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
            return

        if scope["type"] == "http" and scope.get("method") == "OPTIONS":
            request_headers = {
                key.decode("latin-1").lower(): value.decode("latin-1")
                for key, value in scope.get("headers", [])
            }
            origin = request_headers.get("origin", "")
            headers = [
                (b"access-control-allow-credentials", b"true"),
                (
                    b"access-control-allow-headers",
                    request_headers.get(
                        "access-control-request-headers", "*"
                    ).encode("latin-1"),
                ),
                (
                    b"access-control-allow-methods",
                    request_headers.get(
                        "access-control-request-method", "*"
                    ).encode("latin-1"),
                ),
                (
                    b"vary",
                    b"Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
                ),
                (b"content-length", b"0"),
            ]
            if _CORS_ORIGIN_PATTERN.fullmatch(origin):
                headers.append(
                    (b"access-control-allow-origin", origin.encode("latin-1"))
                )
            await send({"type": "http.response.start", "status": 200, "headers": headers})
            await send({"type": "http.response.body", "body": b""})
            return

        if scope["type"] == "http" and scope.get("path") in {
            "/health",
            "/healthz",
            "/api/health",
        } and _IMPLEMENTATION is None:
            body = b'{"status":"starting","service":"genie-new-architecture"}'
            await send({
                "type": "http.response.start",
                "status": 200,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                    (b"cache-control", b"no-store"),
                ],
            })
            await send({"type": "http.response.body", "body": body})
            return

        module = _IMPLEMENTATION
        if module is None:
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1013})
                return
            body = b'{"detail":"Backend is starting. Retry shortly."}'
            await send({
                "type": "http.response.start",
                "status": 503,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                    (b"retry-after", b"1"),
                ],
            })
            await send({"type": "http.response.body", "body": body})
            return

        await module.app(scope, receive, send)

    def __getattr__(self, name: str) -> Any:
        return getattr(_load_application().app, name)


app = _LazyASGIApplication()


def __getattr__(name: str) -> Any:
    return getattr(_load_application(), name)


class _ApplicationModule(types.ModuleType):
    def __setattr__(self, name: str, value: Any) -> None:
        module = _IMPLEMENTATION
        if module is not None and name not in _BOOTSTRAP_NAMES:
            setattr(module, name, value)
        super().__setattr__(name, value)

    def __delattr__(self, name: str) -> None:
        module = _IMPLEMENTATION
        if module is not None and name in module.__dict__:
            delattr(module, name)
        if name in self.__dict__:
            super().__delattr__(name)


sys.modules[__name__].__class__ = _ApplicationModule
