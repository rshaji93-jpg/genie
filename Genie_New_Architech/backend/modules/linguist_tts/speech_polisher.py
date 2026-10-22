from __future__ import annotations

from ..zero_secret_vault.scrubber import scrub_sensitive_text


def prepare_transcript_for_provider(text: str, is_secret: bool = False) -> str:
    if is_secret:
        raise ValueError("Secret-mode transcripts cannot be sent to an AI provider.")
    return scrub_sensitive_text(text)
