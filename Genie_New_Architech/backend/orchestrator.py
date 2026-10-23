from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time
from functools import lru_cache
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx

LOGGER = logging.getLogger("genie.master_brain")
REGISTRY_PATH = Path(__file__).resolve().parent / "ai_muscle" / "registry.json"
MAX_CALLS_NORMAL = 1
MAX_CALLS_MASTER = 4
MAX_WORKERS_AI_NEURONS = 9200

INLINE_REGISTRY: dict[str, Any] = {
    "body_agents": {
        "research": {"description": "Find context, constraints, and evidence."},
        "coding": {"description": "Design and review reliable software changes."},
        "knowledge": {"description": "Explain concepts clearly and accurately."},
        "social": {"description": "Support thoughtful communication."},
        "creative": {"description": "Generate original ideas and plans."},
    },
    "skills": {
        "memory_sieve_extract": {"description": "Extract an explicit decision, task, goal, or lesson."},
        "skill_capsule_builder": {"description": "Create a focused ten-minute practice activity."},
        "bilingual_library_qa": {"description": "Answer questions grounded in library sources."},
        "future_self_advisor": {"description": "Evaluate a choice from a future-self perspective."},
    },
}


@lru_cache(maxsize=64)
def _load_registry(path: str) -> dict[str, Any]:
    try:
        with Path(path).open("r", encoding="utf-8") as registry_file:
            value = json.load(registry_file)
        if isinstance(value, dict) and isinstance(value.get("skills"), dict):
            return value
        LOGGER.error("AI muscle registry has an invalid shape; using inline skills.")
    except (OSError, json.JSONDecodeError) as error:
        LOGGER.warning("AI muscle registry could not be loaded (%s); using inline skills.", type(error).__name__)
    return INLINE_REGISTRY


class SkillRegistry:
    def __init__(self, path: Path = REGISTRY_PATH) -> None:
        self.path = str(path.resolve())

    def skill(self, skill_id: str) -> dict[str, Any] | None:
        skills = _load_registry(self.path).get("skills", {})
        value = skills.get(skill_id)
        return value if isinstance(value, dict) else None

    def list_skills(self) -> dict[str, dict[str, Any]]:
        skills = _load_registry(self.path).get("skills", {})
        return {key: value for key, value in skills.items() if isinstance(value, dict)}

    def body_agents(self) -> dict[str, dict[str, Any]]:
        agents = _load_registry(self.path).get("body_agents", {})
        return {key: value for key, value in agents.items() if isinstance(value, dict)}


class MultiPoolRouter:
    """One logical completion routed through providers in ordered fallback pools."""

    def __init__(self, timeout_seconds: float = 8.0) -> None:
        self.timeout_seconds = timeout_seconds

    @staticmethod
    def _extract_openai_text(body: dict[str, Any]) -> str:
        choices = body.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ValueError("Provider response did not contain a completion.")
        message = choices[0].get("message", {})
        content = message.get("content") if isinstance(message, dict) else None
        if isinstance(content, list):
            content = "".join(
                str(part.get("text", "")) for part in content if isinstance(part, dict)
            )
        if not isinstance(content, str) or not content.strip():
            raise ValueError("Provider response contained an empty completion.")
        return content.strip()

    @staticmethod
    def _provider_specs() -> list[tuple[str, str, str, str, dict[str, str], int]]:
        specs: list[tuple[str, str, str, str, dict[str, str], int]] = []
        gemini_keys = [
            value.strip() for value in (
                os.getenv("GEMINI_API_KEYS", "") + "," + os.getenv("GEMINI_API_KEY", "")
            ).split(",") if value.strip()
        ]
        if gemini_keys:
            for model in ("gemini-2.5-flash", "gemini-2.0-flash"):
                for key in gemini_keys:
                    specs.append((
                        "pool1-gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
                        model, "POST", {"Authorization": f"Bearer {key}"}, 4096,
                    ))

        account = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
        cf_token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
        if account and cf_token:
            specs.append((
                "pool2-cloudflare",
                f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/@cf/meta/llama-3.1-8b-instruct",
                "@cf/meta/llama-3.1-8b-instruct", "CLOUDFLARE",
                {"Authorization": f"Bearer {cf_token}"}, MAX_WORKERS_AI_NEURONS,
            ))

        api_providers = (
            ("pool3-groq", "GROQ_API_KEY", "https://api.groq.com/openai/v1/chat/completions",
             os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")),
            ("pool4-mistral", "MISTRAL_API_KEY", "https://api.mistral.ai/v1/chat/completions",
             os.getenv("MISTRAL_MODEL", "mistral-small-latest")),
            ("pool5-cerebras", "CEREBRAS_API_KEY", "https://api.cerebras.ai/v1/chat/completions",
             os.getenv("CEREBRAS_MODEL", "llama-3.3-70b")),
            ("pool5-openrouter", "OPENROUTER_API_KEY", "https://openrouter.ai/api/v1/chat/completions",
             os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free")),
        )
        for pool, env_name, endpoint, model in api_providers:
            key = os.getenv(env_name, "").strip()
            if key:
                specs.append((pool, endpoint, model, "POST", {"Authorization": f"Bearer {key}"}, 4096))

        specs.append((
            "pool6-pollinations", "https://text.pollinations.ai/openai", "openai",
            "POST", {}, 4096,
        ))
        return specs

    async def _post(
        self,
        endpoint: str,
        model: str,
        messages: list[dict[str, str]],
        headers: dict[str, str],
        token_limit: int,
    ) -> str:
        safe_messages = [
            {
                "role": message.get("role", "user"),
                "content": str(message.get("content", ""))[:20_000],
            }
            for message in messages[-40:]
        ]
        payload: dict[str, Any] = {
            "model": model,
            "messages": safe_messages,
            "max_tokens": min(MAX_WORKERS_AI_NEURONS, max(1, token_limit)),
            "stream": False,
        }
        if endpoint.endswith("/openai"):
            payload["private"] = True
        async with httpx.AsyncClient(timeout=self.timeout_seconds, follow_redirects=False) as client:
            response = await client.post(
                endpoint,
                headers={"Content-Type": "application/json", **headers},
                json=payload,
            )
            response.raise_for_status()
            body = response.json()
        if endpoint.startswith("https://api.cloudflare.com/"):
            result = body.get("result", {})
            text = result.get("response") if isinstance(result, dict) else None
            if isinstance(text, str) and text.strip():
                return text.strip()
            raise ValueError("Cloudflare Workers AI returned an empty completion.")
        return self._extract_openai_text(body)

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int = 4096,
    ) -> tuple[str, str]:
        errors: list[str] = []
        for pool, endpoint, model, _, headers, pool_cap in self._provider_specs():
            try:
                answer = await self._post(endpoint, model, messages, headers, min(max_tokens, pool_cap))
                return answer, pool
            except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
                errors.append(f"{pool}:{type(error).__name__}")
                LOGGER.warning("AI provider route failed (%s: %s)", pool, type(error).__name__)
        raise RuntimeError("Provider waterfall exhausted: " + ", ".join(errors or ["no providers"]))


class VerifierSubAgent:
    @staticmethod
    def verify(text: str) -> dict[str, Any]:
        normalized = text.strip()
        if not normalized:
            return {"verified": False, "notes": ["The response was empty."]}
        unsupported = bool(re.search(r"\b(?:guaranteed|100% certain|always succeeds)\b", normalized, re.I))
        return {
            "verified": not unsupported,
            "notes": ["Avoid unsupported certainty claims."] if unsupported else [],
        }


class TwoPhaseMemorySieve:
    CATEGORIES = ("Decision", "Task", "Goal", "Lesson")

    def __init__(self, signing_key: str | bytes = "") -> None:
        self.signing_key = signing_key.encode("utf-8") if isinstance(signing_key, str) else signing_key

    def propose(self, text: str, user_sub: str) -> dict[str, Any] | None:
        content = text.strip()
        if not content or not re.search(
            r"\b(?:remember|decision|decided|task|todo|goal|lesson|learned|future self)\b",
            content,
            re.I,
        ):
            return None
        category = "Decision"
        if re.search(r"\b(?:task|todo|next step)\b", content, re.I):
            category = "Task"
        elif re.search(r"\bgoal\b", content, re.I):
            category = "Goal"
        elif re.search(r"\b(?:lesson|learned)\b", content, re.I):
            category = "Lesson"
        candidate_id = secrets.token_urlsafe(18)
        expires = int(time.time()) + 900
        payload = {
            "typ": "memory_approval",
            "sub": user_sub,
            "id": candidate_id,
            "category": category,
            "content": content[:4000],
            "exp": expires,
        }
        encoded = base64.urlsafe_b64encode(
            json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        ).decode("ascii").rstrip("=")
        signature = hmac.new(self.signing_key, encoded.encode("ascii"), hashlib.sha256).hexdigest()
        return {
            "id": candidate_id,
            "category": category,
            "content": content[:4000],
            "status": "pending_approval",
            "pending_action_token": f"{encoded}.{signature}",
            "expires_at": expires,
        }

    def verify_token(self, token: str, user_sub: str) -> dict[str, Any]:
        try:
            encoded, signature = token.split(".", 1)
            expected = hmac.new(self.signing_key, encoded.encode("ascii"), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, signature):
                raise ValueError("signature mismatch")
            payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        except (ValueError, UnicodeError, json.JSONDecodeError) as error:
            raise ValueError("Invalid memory approval token.") from error
        if (
            payload.get("typ") != "memory_approval"
            or payload.get("sub") != user_sub
            or not isinstance(payload.get("exp"), int)
            or payload["exp"] <= int(time.time())
            or payload.get("category") not in self.CATEGORIES
        ):
            raise ValueError("Memory approval token is invalid or expired.")
        return payload


class MasterBrain:
    def __init__(
        self,
        router: MultiPoolRouter | None = None,
        skills: SkillRegistry | None = None,
        memory_sieve: TwoPhaseMemorySieve | None = None,
    ) -> None:
        self.router = router or MultiPoolRouter()
        self.skills = skills or SkillRegistry()
        self.verifier = VerifierSubAgent()
        self.memory_sieve = memory_sieve or TwoPhaseMemorySieve(
            os.getenv("GENIE_MEMORY_SIGNING_KEY") or os.getenv("SESSION_SIGNING_KEY", "")
        )

    @staticmethod
    def deterministic_reply(messages: list[dict[str, str]]) -> str | None:
        prompt = next(
            (message.get("content", "").strip() for message in reversed(messages) if message.get("role") == "user"),
            "",
        )
        if re.fullmatch(r"(?:hi|hello|hey|good morning|good afternoon|good evening)[!. ]*", prompt, re.I):
            return "Hello! What would you like to work on?"
        if re.fullmatch(r"(?:help|commands|what can you do)[?.! ]*", prompt, re.I):
            return "I can answer questions, help plan tasks, explain ideas, and support your projects."
        return None

    async def run(
        self,
        messages: list[dict[str, str]],
        *,
        user_sub: str,
        model_tier: str = "genie-pro",
        future_self: bool = False,
        room_mode: bool = False,
        max_tokens: int = 4096,
    ) -> dict[str, Any]:
        local = self.deterministic_reply(messages)
        if local is not None:
            return {
                "reply": local,
                "source": "pool0-deterministic",
                "sub_agents": [],
                "verified": True,
                "proposed_memory": None,
            }

        master = model_tier == "genie-master" or future_self
        agents = (
            ["Lead Orchestrator", "Planner Sub-Agent", "Research Sub-Agent",
             "Execution Sub-Agent", "Critic Sub-Agent", "Synthesis Sub-Agent"]
            if master else
            ["Execution Agent"] if model_tier == "genie-lite" else
            ["Coordinator Agent", "Context & Memory Agent", "Execution Agent"]
        )
        latest = next(
            (message.get("content", "") for message in reversed(messages) if message.get("role") == "user"),
            "",
        )
        prior_context = [
            {
                "role": message.get("role", "user"),
                "content": (
                    f"{message['sender']}: {message.get('content', '')}"
                    if message.get("sender") and message.get("role") == "user"
                    else str(message.get("content", ""))
                ),
            }
            for message in messages[-40:]
        ]
        now_ist = datetime.now(ZoneInfo("Asia/Kolkata")).strftime(
            "%A, %d %B %Y, %I:%M %p IST"
        )
        system_context = (
            f"Current date and time: {now_ist}. "
            + (
                "This is a shared-room request. Protect each participant's private context."
                if room_mode else "This is a personal chat request."
            )
        )
        pool = ""
        if not master:
            prompt = [
                {
                    "role": "system",
                    "content": (
                        f"You are Personal AI Genie. {system_context} Give a grounded, helpful answer. "
                        "Respect privacy and room mode. Do not claim to have run tools you did not run."
                    ),
                },
                *prior_context,
            ]
            reply, pool = await self.router.complete(prompt, max_tokens=max_tokens)
        else:
            phases = (
                ("Planner Sub-Agent", "Break the goal into a concise plan. Return actionable constraints."),
                ("Research Sub-Agent", "Analyze the provided history, constraints, and relevant domain context."),
                ("Execution Sub-Agent", "Produce the requested solution, following the plan and evidence."),
                ("Critic Sub-Agent", "Check the draft for correctness, gaps, and unsupported claims; return the corrected final answer."),
            )
            phase_context = prior_context
            reply = ""
            for name, instruction in phases[:MAX_CALLS_MASTER]:
                if name == "Critic Sub-Agent":
                    instruction += " Do not introduce claims that are not supported by the conversation."
                phase_prompt = [
                    {"role": "system", "content": f"{system_context}\n{instruction}"},
                    *phase_context,
                ]
                reply, pool = await self.router.complete(phase_prompt, max_tokens=max_tokens)
                phase_context = [
                    *phase_context,
                    {"role": "assistant", "content": f"{name} output:\n{reply}"},
                ]
        verification = self.verifier.verify(reply)
        if master and not verification["verified"]:
            LOGGER.info("Critic verifier flagged high-certainty phrasing in the answer.")
        return {
            "reply": reply,
            "source": pool,
            "sub_agents": agents,
            "verified": verification["verified"],
            "verification_notes": verification["notes"],
            "proposed_memory": self.memory_sieve.propose(latest, user_sub),
            "max_calls": MAX_CALLS_MASTER if master else MAX_CALLS_NORMAL,
        }


skill_registry = SkillRegistry()
multi_pool_router = MultiPoolRouter()
master_brain = MasterBrain(router=multi_pool_router, skills=skill_registry)
