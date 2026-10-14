import os
import time
from typing import List, Dict, Optional

class GeminiKeyManager:
    def __init__(self):
        free_raw = os.getenv("GEMINI_FREE_KEYS", "")
        self.free_keys: List[str] = [k.strip() for k in free_raw.split(",") if k.strip()]
        self.master_key: str = (os.getenv("GEMINI_MASTER_KEY") or "").strip()
        self.openrouter_key: str = (os.getenv("OPENROUTER_API_KEY") or "").strip()
        self.cooldowns: Dict[str, float] = {}
        self._current_index: int = 0

    def get_key(self, is_vip: bool = False, is_admin: bool = False) -> Dict[str, Optional[str]]:
        """
        Returns a dict: {"provider": "gemini" | "openrouter", "key": str, "model_override": Optional[str]}
        Protects master_key strictly for Admin and active VIP sessions.
        """
        now = time.time()
        available_free = [k for k in self.free_keys if self.cooldowns.get(k, 0) <= now]

        # 1. Keep the master credential exclusive to elevated personas.
        if (is_admin or is_vip) and self.master_key:
            return {"provider": "gemini", "key": self.master_key, "model_override": "gemini-2.5-flash"}

        # 2. Rotate through standard free Gemini pool
        if available_free:
            self._current_index = (self._current_index + 1) % len(available_free)
            return {"provider": "gemini", "key": available_free[self._current_index], "model_override": None}

        # 3. For guest/standard users when all free keys are on cooldown:
        # Fall back to OpenRouter Free Bridge (0 token billing cost)
        if self.openrouter_key:
            return {"provider": "openrouter", "key": self.openrouter_key, "model_override": "meta-llama/llama-3.2-3b-instruct:free"}

        # 4. If OpenRouter is not set, pick the key whose cooldown expires earliest
        if self.free_keys:
            earliest_key = min(self.free_keys, key=lambda k: self.cooldowns.get(k, 0))
            return {"provider": "gemini", "key": earliest_key, "model_override": None}

        raise RuntimeError("No operational LLM API keys available.")

    def mark_rate_limited(self, key: str, cooldown_seconds: int = 60) -> None:
        """Applies temporary cooldown to rate-limited key."""
        if key != self.master_key:
            self.cooldowns[key] = time.time() + cooldown_seconds

gemini_pool = GeminiKeyManager()