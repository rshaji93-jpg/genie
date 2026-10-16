from __future__ import annotations

import hashlib
from functools import lru_cache

from gtts import gTTS


@lru_cache(maxsize=128)
def _cached_speech(cache_key: str, text: str, language: str) -> bytes:
    del cache_key
    import io

    output = io.BytesIO()
    gTTS(text=text, lang=language).write_to_fp(output)
    return output.getvalue()


def speech_mp3(text: str, language: str = "en") -> bytes:
    if not text.strip() or len(text) > 12_000:
        raise ValueError("Speech text must contain 1 to 12,000 characters.")
    digest = hashlib.sha256(f"{text}\0{language}".encode("utf-8")).hexdigest()
    return _cached_speech(digest, text, language)
