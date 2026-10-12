import re
import asyncio
import importlib
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import Header, HTTPException


SUPER_ADMIN_IDENTIFIER = os.getenv("SUPER_ADMIN_EMAIL", "admin@genie.local").strip().lower()


async def verify_super_admin(
    authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=404, detail="Not Found")
    token = authorization.removeprefix("Bearer ").strip()
    main_module_name = "backend.main" if __package__ else "main"
    main_module = importlib.import_module(main_module_name)
    try:
        identity = await asyncio.to_thread(main_module.verified_identity_from_token, token)
    except HTTPException as error:
        if error.status_code == 401:
            raise HTTPException(status_code=404, detail="Not Found") from error
        raise
    configured_identifier = os.getenv("SUPER_ADMIN_EMAIL", SUPER_ADMIN_IDENTIFIER).strip().lower()
    if identity.get("email", "").strip().lower() != configured_identifier:
        raise HTTPException(status_code=404, detail="Not Found")
    return identity

_CREDENTIAL_PATTERNS = (
    re.compile(r"AIza[0-9A-Za-z_-]{35}"),
    re.compile(r"sk-or-[0-9A-Za-z_-]{40,}"),
    re.compile(r"client_secret[^\s]*", re.IGNORECASE),
    re.compile(r"\b(?:postgresql|mysql|mongodb)://[^\s\"'<>]+", re.IGNORECASE),
)

_SENSITIVE_TOKEN_PATTERNS = (
    re.compile(r"AIza[0-9A-Za-z_-]{20,}"),
    re.compile(r"sk-or-(?:v1-)?[0-9A-Za-z_-]{16,}"),
    re.compile(r"\bsk-[0-9A-Za-z_-]{20,}"),
    re.compile(r"\bgh[pousr]_[0-9A-Za-z]{20,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    re.compile(
        r"\b(?:api[_-]?key|client[_-]?secret|secret|access[_-]?token|password)"
        r"\s*[:=]\s*[\"']?[A-Za-z0-9._~+/-]{12,}",
        re.IGNORECASE,
    ),
    re.compile(
        r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?"
        r"-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
        re.IGNORECASE,
    ),
)


def sanitize_ai_output(response_text: str) -> str:
    sanitized = response_text
    for pattern in _CREDENTIAL_PATTERNS:
        sanitized = pattern.sub("[PROTECTED_CREDENTIAL]", sanitized)
    return sanitized


def scrub_sensitive_tokens(text: str) -> str:
    scrubbed = text
    for pattern in _SENSITIVE_TOKEN_PATTERNS:
        scrubbed = pattern.sub("[PROTECTED_CREDENTIAL]", scrubbed)
    return scrubbed


def may_view_pre_join_history(
    *,
    is_origin_admin: bool,
    allow_history: bool,
) -> bool:
    return is_origin_admin or allow_history


def message_is_after_join(created_at: str, joined_at: str) -> bool:
    if not created_at or not joined_at:
        return False
    try:
        created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        joined = datetime.fromisoformat(joined_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if joined.tzinfo is None:
        joined = joined.replace(tzinfo=timezone.utc)
    return created >= joined


def may_export_room(
    *,
    space_mode: str,
    is_origin_admin: bool,
    is_member: bool,
    member_export_enabled: bool,
) -> bool:
    if not is_member:
        return False
    if is_origin_admin:
        return True
    return space_mode == "workspace" and member_export_enabled


def verified_workspace_tenant(identity: Dict[str, Any]) -> Optional[str]:
    tenant = identity.get("tenant_id") or identity.get("hd")
    if not isinstance(tenant, str):
        return None
    normalized = tenant.strip().lower().rstrip(".")
    if not normalized or "@" in normalized or "/" in normalized:
        return None
    return normalized


def require_personal_scope(identity: Dict[str, Any]) -> None:
    if verified_workspace_tenant(identity):
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="SCOPE_MISMATCH")


def require_workspace_scope(
    identity: Dict[str, Any],
    tenant_id: Optional[str],
) -> str:
    from fastapi import HTTPException

    verified_tenant = verified_workspace_tenant(identity)
    normalized_tenant = tenant_id.strip().lower().rstrip(".") if tenant_id else ""
    if not verified_tenant or not normalized_tenant or verified_tenant != normalized_tenant:
        raise HTTPException(status_code=403, detail="SCOPE_MISMATCH")
    return verified_tenant
