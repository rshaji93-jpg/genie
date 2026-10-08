import re


_CREDENTIAL_PATTERNS = (
    re.compile(r"AIza[0-9A-Za-z_-]{35}"),
    re.compile(r"sk-or-[0-9A-Za-z_-]{40,}"),
    re.compile(r"client_secret[^\s]*", re.IGNORECASE),
    re.compile(r"\b(?:postgresql|mysql|mongodb)://[^\s\"'<>]+", re.IGNORECASE),
)


def sanitize_ai_output(response_text: str) -> str:
    sanitized = response_text
    for pattern in _CREDENTIAL_PATTERNS:
        sanitized = pattern.sub("[PROTECTED_CREDENTIAL]", sanitized)
    return sanitized
