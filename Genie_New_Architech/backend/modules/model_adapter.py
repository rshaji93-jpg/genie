"""Opt-in adapter for locally installed, license-approved Safetensors models.

The adapter never downloads weights or executes model-provided Python code. Set
GENIE_LOCAL_MODEL_PATH to a local model directory and
GENIE_LOCAL_MODEL_LICENSE to the license identifier accepted by the operator.
"""

from __future__ import annotations

import asyncio
import importlib
import logging
import os
import threading
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger("genie.local_model")
APPROVED_LICENSE_IDS = {
    "gemma-terms",
    "llama-3.2-community",
}


class LocalModelUnavailable(RuntimeError):
    """The opted-in local model cannot be safely loaded or executed."""


class LocalSafetensorsAdapter:
    """Provider-neutral inference adapter for an operator-approved local model."""

    def __init__(self, model_path: Path, license_id: str) -> None:
        self.model_path = model_path
        self.license_id = license_id
        self._load_lock = threading.Lock()
        self._tokenizer: Any = None
        self._model: Any = None
        self._torch: Any = None

    def _load(self) -> None:
        if self._model is not None:
            return
        with self._load_lock:
            if self._model is not None:
                return
            try:
                model_path = self.model_path.expanduser().resolve(strict=True)
                if not model_path.is_dir():
                    raise LocalModelUnavailable("The configured local model path is not a directory.")
                if not any(model_path.glob("*.safetensors")):
                    raise LocalModelUnavailable(
                        "The local model must contain Safetensors weights; binary weight files are not accepted."
                    )
                torch = importlib.import_module("torch")
                transformers = importlib.import_module("transformers")
                importlib.import_module("safetensors")
                tokenizer = transformers.AutoTokenizer.from_pretrained(
                    str(model_path),
                    local_files_only=True,
                    trust_remote_code=False,
                )
                model = transformers.AutoModelForCausalLM.from_pretrained(
                    str(model_path),
                    local_files_only=True,
                    trust_remote_code=False,
                    use_safetensors=True,
                    torch_dtype="auto",
                )
                model.eval()
            except LocalModelUnavailable:
                raise
            except (ImportError, OSError, RuntimeError, ValueError, TypeError) as error:
                raise LocalModelUnavailable(
                    f"Could not load the operator-approved local model ({type(error).__name__})."
                ) from error
            self._tokenizer = tokenizer
            self._model = model
            self._torch = torch

    def _generate(self, messages: list[dict[str, str]], max_tokens: int) -> str:
        self._load()
        safe_messages = [
            {"role": item.get("role", "user"), "content": item.get("content", "")[:20_000]}
            for item in messages[-40:]
        ]
        if hasattr(self._tokenizer, "apply_chat_template"):
            prompt = self._tokenizer.apply_chat_template(
                safe_messages,
                tokenize=False,
                add_generation_prompt=True,
            )
        else:
            prompt = "\n".join(
                f"{item['role']}: {item['content']}" for item in safe_messages
            ) + "\nassistant:"
        inputs = self._tokenizer(prompt, return_tensors="pt")
        device = getattr(self._model, "device", None)
        if device is not None:
            inputs = inputs.to(device)
        with self._torch.inference_mode():
            output = self._model.generate(
                **inputs,
                max_new_tokens=max(1, min(max_tokens, 2048)),
                do_sample=False,
            )
        input_length = inputs["input_ids"].shape[-1]
        completion = self._tokenizer.decode(
            output[0][input_length:],
            skip_special_tokens=True,
        ).strip()
        if not completion:
            raise LocalModelUnavailable("The local model returned an empty completion.")
        return completion

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int = 4096,
    ) -> tuple[str, str]:
        answer = await asyncio.to_thread(self._generate, messages, max_tokens)
        return answer, f"local-safetensors:{self.license_id}"


_ADAPTER_LOCK = threading.Lock()
_ADAPTER: LocalSafetensorsAdapter | None = None
_ADAPTER_KEY: tuple[str, str] | None = None


def configured_local_model_adapter() -> LocalSafetensorsAdapter | None:
    """Return the configured local adapter, or None when local inference is off."""
    configured_path = os.getenv("GENIE_LOCAL_MODEL_PATH", "").strip()
    if not configured_path:
        return None
    license_id = os.getenv("GENIE_LOCAL_MODEL_LICENSE", "").strip()
    if not license_id:
        raise LocalModelUnavailable(
            "GENIE_LOCAL_MODEL_LICENSE must identify the license accepted by the operator."
        )
    if license_id.casefold() not in APPROVED_LICENSE_IDS:
        raise LocalModelUnavailable(
            "GENIE_LOCAL_MODEL_LICENSE must be llama-3.2-community or gemma-terms."
        )
    key = (configured_path, license_id)
    global _ADAPTER, _ADAPTER_KEY
    with _ADAPTER_LOCK:
        if _ADAPTER is None or _ADAPTER_KEY != key:
            _ADAPTER = LocalSafetensorsAdapter(Path(configured_path), license_id)
            _ADAPTER_KEY = key
        return _ADAPTER


async def complete_with_local_model(
    messages: list[dict[str, str]],
    *,
    max_tokens: int = 4096,
) -> tuple[str, str] | None:
    adapter = configured_local_model_adapter()
    if adapter is None:
        return None
    return await adapter.complete(messages, max_tokens=max_tokens)
