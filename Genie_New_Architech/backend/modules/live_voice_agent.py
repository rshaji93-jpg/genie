from __future__ import annotations

import re
from typing import Any

VOICES: tuple[dict[str, str], ...] = (
    {"id": "aria", "label": "Aria", "voice": "en-US-AriaNeural", "description": "Warm expressive female"},
    {"id": "andrew", "label": "Andrew", "voice": "en-US-AndrewNeural", "description": "Calm grounded male"},
    {"id": "neerja", "label": "Neerja", "voice": "en-IN-NeerjaNeural", "description": "Natural Indian English female"},
    {"id": "prabhat", "label": "Prabhat", "voice": "en-IN-PrabhatNeural", "description": "Professional Indian English male"},
    {"id": "sonia", "label": "Sonia", "voice": "en-GB-SoniaNeural", "description": "Articulate British female"},
)
DEFAULT_VOICE_ID = "aria"
_SPECIALS = re.compile(r"[#*_`~|<>\\{}\[\]]")
_SPACE = re.compile(r"\s+")


def spoken_turn(text: str, max_sentences: int = 3) -> str:
    prose = _SPECIALS.sub("", text)
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", _SPACE.sub(" ", prose).strip()) if part.strip()]
    return " ".join(sentences[:max(1, min(max_sentences, 3))])


async def edge_tts_audio(text: str, voice_id: str = DEFAULT_VOICE_ID) -> bytes:
    """Create one MP3 response with edge-tts; absence of the optional dependency is explicit."""
    try:
        import edge_tts
    except ImportError as error:
        raise RuntimeError("edge-tts is not installed; use browser speech synthesis fallback.") from error
    selected = next((voice for voice in VOICES if voice["id"] == voice_id), VOICES[0])
    communicator = edge_tts.Communicate(spoken_turn(text), selected["voice"])
    chunks: list[bytes] = []
    async for chunk in communicator.stream():
        if chunk.get("type") == "audio":
            chunks.append(chunk["data"])
    return b"".join(chunks)


def voice_catalog() -> list[dict[str, Any]]:
    return [
        {**voice, "default": voice["id"] == DEFAULT_VOICE_ID, "fallback": "Web Speech API"}
        for voice in VOICES
    ]


def create_voice_router(identity_dependency):
    from fastapi import APIRouter, Depends, HTTPException
    from fastapi.responses import Response
    from pydantic import BaseModel, ConfigDict, Field

    class SpeechRequest(BaseModel):
        model_config = ConfigDict(extra="forbid")
        text: str = Field(min_length=1, max_length=3000)
        voice_id: str = Field(default=DEFAULT_VOICE_ID, max_length=40)

    router = APIRouter()

    @router.get("/api/live-voice/voices")
    async def list_voices(identity: dict[str, str] = Depends(identity_dependency)):
        del identity
        return {"voices": voice_catalog()}

    @router.post("/api/live-voice/speech")
    async def synthesize_speech(
        request: SpeechRequest,
        identity: dict[str, str] = Depends(identity_dependency),
    ):
        del identity
        if request.voice_id not in {voice["id"] for voice in VOICES}:
            raise HTTPException(status_code=422, detail="Select one of the supported Genie voices.")
        try:
            audio = await edge_tts_audio(request.text, request.voice_id)
        except RuntimeError as error:
            raise HTTPException(
                status_code=503,
                detail="Neural voice synthesis is unavailable; use the browser speech fallback.",
            ) from error
        return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})

    return router
