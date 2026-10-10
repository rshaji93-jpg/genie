import os
import time
from typing import List, Dict

class GeminiKeyManager:
    def __init__(self):
        free_raw = os.getenv("GEMINI_FREE_KEYS", "")
        self.free_keys: List[str] = [k.strip() for k in free_raw.split(",") if k.strip()]
        self.master_key: str = (os.getenv("GEMINI_MASTER_KEY") or "").strip()
        self.cooldowns: Dict[str, float] = {}
        self._current_index: int = 0

    def get_key(self) -> str:
        """
        Rotates through free keys. If all are in 429 cooldown, returns the paid master key.
        """
        now = time.time()
        available_free = [k for k in self.free_keys if self.cooldowns.get(k, 0) <= now]

        if available_free:
            self._current_index = (self._current_index + 1) % len(available_free)
            return available_free[self._current_index]

        if self.master_key:
            return self.master_key

        if self.free_keys:
            return min(self.free_keys, key=lambda k: self.cooldowns.get(k, 0))

        raise RuntimeError("No Gemini API keys found in environment.")

    def mark_rate_limited(self, key: str, cooldown_seconds: int = 60) -> None:
        """Puts an exhausted free key on cooldown for 60 seconds."""
        if key != self.master_key:
            self.cooldowns[key] = time.time() + cooldown_seconds

gemini_pool = GeminiKeyManager()