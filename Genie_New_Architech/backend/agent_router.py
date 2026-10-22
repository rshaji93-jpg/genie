from __future__ import annotations

import asyncio
import itertools
import logging
import os
import re
import httpx
from pathlib import Path
from typing import Any
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().with_name(".env"), override=False)

LOGGER = logging.getLogger("genie.agent_router")

RESPONSE_STYLE_INSTRUCTION = (
    "You are Genie, an intelligent AI assistant. Respond in the language and dialect "
    "used by the user. For standard conversation, write natural, fluent human prose "
    "without Markdown, bullets, headings, hashes, or asterisks. Never write 'User:' "
    "or simulate future turns of the conversation. Preserve formal notation and "
    "equations only when the user asks about mathematics, coding, or science."
)

FAST_GREETINGS = {
    "hi", "hello", "hey", "hola", "namaste", "vanakkam",
    "good morning", "good afternoon", "good evening", "yo", "sup"
}


class AgentRouter:
    """Production Open-Source & Multi-Pillar Gateway ('The Brains'):
    - Tier 0: Zero-cost deterministic greeting handler
    - Tier 1 (Optional Local/Self-Hosted Muscle): Ollama / vLLM (with stop-token protection)
    - Tier 2 (Cloud Open-Source Waterfall - 8 Pillars):
      1. Mistral -> 2. Groq -> 3. GitHub Models -> 4. Cloudflare Workers AI ->
      5. OpenRouter -> 6. NVIDIA NIM -> 7. SiliconFlow -> 8. xAI
    - Tier 3 (Emergency Admin Backup): Native Gemini (Dormant 'off' by default)
    """

    def __init__(self) -> None:
        self.last_provider: str = "uninitialized"
        self.gemini_emergency_mode: str = (
            os.getenv("ADMIN_GEMINI_EMERGENCY_MODE", "off").strip().casefold()
        )
        self.enable_local_ollama: bool = (
            os.getenv("ENABLE_LOCAL_OLLAMA", "true").strip().casefold() in {"1", "true", "yes", "on"}
        )
        self._free_key_cycle = None

    @staticmethod
    def _clean_key(env_name: str) -> str:
        return os.getenv(env_name, "").strip().strip("\"'")

    def set_gemini_emergency_mode(self, mode: str) -> dict[str, str]:
        normalized = mode.strip().casefold()
        if normalized not in {"off", "free_pool", "payg"}:
            raise ValueError("Mode must be 'off', 'free_pool', or 'payg'.")
        self.gemini_emergency_mode = normalized
        LOGGER.warning(
            "Admin Telemetry: Gemini Emergency Mode set to '%s'",
            self.gemini_emergency_mode,
        )
        return {"gemini_emergency_mode": self.gemini_emergency_mode}

    def get_telemetry(self) -> dict[str, Any]:
        self_hosted_url = (
            self._clean_key("SELF_HOSTED_LLM_URL")
            or self._clean_key("OLLAMA_BASE_URL")
            or "http://127.0.0.1:11434/v1"
        )
        return {
            "last_provider": self.last_provider,
            "local_ollama_enabled": self.enable_local_ollama,
            "tier1_self_hosted_muscle": self_hosted_url,
            "gemini_emergency_mode": self.gemini_emergency_mode,
            "external_pillars": [
                "mistral:open-mistral-nemo",
                "groq:openai/gpt-oss-120b",
                "github-models:openai/gpt-4o-mini",
                "cloudflare-workers-ai:@cf/meta/llama-3.2-3b-instruct",
                "openrouter:free",
                "nvidia-nim:meta/llama-3.2-90b-vision-instruct",
                "siliconflow:Qwen/Qwen3-8B",
                "xai:grok-2-latest",
            ],
        }

    @staticmethod
    def _latest_user_text(messages: list[dict[str, Any]]) -> str:
        for message in reversed(messages):
            if str(message.get("role", "user")).casefold() == "user":
                return str(message.get("content") or "").strip()
        return ""

    @staticmethod
    def _build_chat_messages(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
        system_instructions = [RESPONSE_STYLE_INSTRUCTION]
        chat_msgs: list[dict[str, str]] = []
        for message in messages[-40:]:
            role = str(message.get("role", "user")).casefold()
            content = str(message.get("content") or "").strip()
            if not content:
                continue
            if role == "system":
                system_instructions.append(content[:20_000])
                continue
            mapped_role = "assistant" if role in {"assistant", "model"} else "user"
            chat_msgs.append({"role": mapped_role, "content": content[:20_000]})
        return [
            {"role": "system", "content": "\n\n".join(system_instructions)},
            *chat_msgs,
        ]

    @staticmethod
    def _clean_reply_text(text: str) -> str:
        # Strip any hallucinated "User:" turn from small 1B/3B models
        cleaned = re.split(r"\n+\s*(?:User|Human)\s*:", text, maxsplit=1)[0]
        cleaned = re.sub(r"^\s*Genie\s*:\s*", "", cleaned).strip()
        return cleaned

    @classmethod
    def _extract_reply(cls, data: Any) -> str:
        if not isinstance(data, dict):
            return ""
        choices = data.get("choices") or []
        if not choices:
            return ""
        message = choices[0].get("message") or {}
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return cls._clean_reply_text(content)
        return ""

    async def _run_tier1_self_hosted(
        self, payload_messages: list[dict[str, str]], failures: list[str]
    ) -> str | None:
        if not self.enable_local_ollama:
            return None

        base_url = (
            self._clean_key("SELF_HOSTED_LLM_URL")
            or self._clean_key("OLLAMA_BASE_URL")
            or "http://127.0.0.1:11434/v1"
        ).rstrip("/")
        api_key = self._clean_key("SELF_HOSTED_LLM_KEY") or "ollama"
        configured_model = self._clean_key("SELF_HOSTED_LLM_MODEL")
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        try:
            timeout = httpx.Timeout(35.0, connect=1.5)
            async with httpx.AsyncClient(timeout=timeout) as local_client:
                model_to_use = configured_model
                if not model_to_use:
                    models_resp = await local_client.get(f"{base_url}/models", headers=headers)
                    if models_resp.status_code == 200:
                        data = models_resp.json().get("data") or []
                        chat_models = [
                            m["id"]
                            for m in data
                            if isinstance(m, dict)
                            and m.get("id")
                            and "embed" not in m["id"].lower()
                        ]
                        if chat_models:
                            model_to_use = chat_models[0]

                if not model_to_use:
                    failures.append("tier1-self-hosted:no_models_pulled")
                    return None

                r = await local_client.post(
                    f"{base_url}/chat/completions",
                    headers=headers,
                    json={
                        "model": model_to_use,
                        "messages": payload_messages,
                        "stop": ["\nUser:", "\nHuman:", "User:"],
                    },
                )
                if r.status_code == 200:
                    reply = self._extract_reply(r.json())
                    if reply:
                        self.last_provider = f"tier1-self-hosted:{model_to_use}"
                        LOGGER.info("Primary Tier 1 Self-Hosted Muscle served response (%s)", self.last_provider)
                        return reply
                failures.append(f"tier1-self-hosted({model_to_use}):HTTP{r.status_code}")
        except Exception as exc:
            failures.append(f"tier1-self-hosted:{type(exc).__name__}")
        return None

    async def _run_emergency_gemini(
        self, client: httpx.AsyncClient, payload_messages: list[dict[str, str]]
    ) -> str | None:
        mode = self.gemini_emergency_mode
        if mode not in {"free_pool", "payg"}:
            return None

        if mode == "payg":
            master_key = self._clean_key("GEMINI_MASTER_KEY")
            keys = [master_key] if master_key and not master_key.startswith("AQ.") else []
        else:
            raw_free = self._clean_key("GEMINI_FREE_KEYS")
            free_list = [
                k.strip()
                for k in raw_free.split(",")
                if k.strip() and not k.strip().startswith("AQ.")
            ]
            if free_list:
                if self._free_key_cycle is None:
                    self._free_key_cycle = itertools.cycle(free_list)
                keys = [next(self._free_key_cycle) for _ in range(len(free_list))]
            else:
                keys = []

        transcript = "\n\n".join(f"{m['role']}: {m['content']}" for m in payload_messages)
        model = self._clean_key("GENIE_PRO_MODEL") or "gemini-2.5-flash"
        for key in keys:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
                r = await client.post(
                    url,
                    json={"contents": [{"parts": [{"text": transcript}]}]},
                )
                if r.status_code == 200:
                    candidates = r.json().get("candidates") or []
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts") or []
                        text = "".join(p.get("text", "") for p in parts).strip()
                        if text:
                            self.last_provider = f"gemini-emergency:{mode}:{model}"
                            return self._clean_reply_text(text)
            except Exception as exc:
                LOGGER.warning("Emergency Gemini (%s) attempt failed: %s", mode, exc)
        return None

    async def run(self, messages: list[dict[str, Any]]) -> str:
        latest_text = self._latest_user_text(messages)
        normalized = re.sub(r"[^\w\s]", "", latest_text.casefold()).strip()

        if normalized in FAST_GREETINGS:
            self.last_provider = "tier0:fast-greeting"
            return "Hello! I am Genie, your personal AI assistant. What are we building or solving today?"

        payload_messages = self._build_chat_messages(messages)
        if len(payload_messages) <= 1:
            raise RuntimeError("The chat request contains no conversational messages.")

        failures: list[str] = []

        # Primary Tier 1: Self-Hosted Open-Source Muscle (Ollama / vLLM)
        self_hosted_reply = await self._run_tier1_self_hosted(payload_messages, failures)
        if self_hosted_reply:
            return self_hosted_reply

        async with httpx.AsyncClient(timeout=40.0) as client:
            # Pillar 1: Mistral (open-mistral-nemo)
            mistral_key = self._clean_key("MISTRAL_API_KEY")
            if mistral_key:
                for model in ("open-mistral-nemo", "ministral-8b-latest", "mistral-small-latest"):
                    try:
                        r = await client.post(
                            "https://api.mistral.ai/v1/chat/completions",
                            headers={
                                "Authorization": f"Bearer {mistral_key}",
                                "Content-Type": "application/json",
                            },
                            json={"model": model, "messages": payload_messages},
                        )
                        if r.status_code == 200:
                            reply = self._extract_reply(r.json())
                            if reply:
                                self.last_provider = f"mistral:{model}"
                                return reply
                        failures.append(f"mistral({model}):HTTP{r.status_code}")
                    except Exception as exc:
                        failures.append(f"mistral({model}):{type(exc).__name__}")

            # Pillar 2: Groq
            groq_key = self._clean_key("GROQ_API_KEY")
            if groq_key:
                for model in ("openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "allam-2-7b"):
                    try:
                        r = await client.post(
                            "https://api.groq.com/openai/v1/chat/completions",
                            headers={
                                "Authorization": f"Bearer {groq_key}",
                                "Content-Type": "application/json",
                            },
                            json={"model": model, "messages": payload_messages},
                        )
                        if r.status_code == 200:
                            reply = self._extract_reply(r.json())
                            if reply:
                                self.last_provider = f"groq:{model}"
                                return reply
                        failures.append(f"groq({model}):HTTP{r.status_code}")
                    except Exception as exc:
                        failures.append(f"groq({model}):{type(exc).__name__}")

            # Pillar 3: GitHub Models
            gh_key = self._clean_key("GITHUB_MODELS_TOKEN") or self._clean_key("GITHUB_TOKEN")
            if gh_key:
                for model in ("openai/gpt-4o-mini", "gpt-4o-mini", "openai/gpt-4o"):
                    try:
                        r = await client.post(
                            "https://models.github.ai/inference/chat/completions",
                            headers={
                                "Authorization": f"Bearer {gh_key}",
                                "Accept": "application/vnd.github+json",
                                "X-GitHub-Api-Version": "2022-11-28",
                                "Content-Type": "application/json",
                            },
                            json={"model": model, "messages": payload_messages},
                        )
                        if r.status_code == 200:
                            reply = self._extract_reply(r.json())
                            if reply:
                                self.last_provider = f"github-models:{model}"
                                return reply
                        failures.append(f"github-models({model}):HTTP{r.status_code}")
                    except Exception as exc:
                        failures.append(f"github-models({model}):{type(exc).__name__}")

            # Pillar 4: Cloudflare Workers AI (Server-Side OpenAI-Compatible Endpoint, 10k Free Neurons/Day)
            cf_token = self._clean_key("CLOUDFLARE_API_TOKEN")
            cf_account = self._clean_key("CLOUDFLARE_ACCOUNT_ID")
            if cf_token and cf_account:
                cf_model = self._clean_key("CLOUDFLARE_AI_MODEL") or "@cf/meta/llama-3.2-3b-instruct"
                try:
                    r = await client.post(
                        f"https://api.cloudflare.com/client/v4/accounts/{cf_account}/ai/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {cf_token}",
                            "Content-Type": "application/json",
                        },
                        json={"model": cf_model, "messages": payload_messages},
                    )
                    if r.status_code == 200:
                        reply = self._extract_reply(r.json())
                        if reply:
                            self.last_provider = f"cloudflare-workers-ai:{cf_model}"
                            return reply
                    failures.append(f"cloudflare-ai:HTTP{r.status_code}")
                except Exception as exc:
                    failures.append(f"cloudflare-ai:{type(exc).__name__}")

            # Pillar 5: OpenRouter
            or_key = self._clean_key("OPENROUTER_API_KEY")
            if or_key:
                try:
                    r = await client.post(
                        "https://openrouter.ai/api/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {or_key}",
                            "Content-Type": "application/json",
                        },
                        json={"model": "openrouter/free", "messages": payload_messages},
                    )
                    if r.status_code == 200:
                        reply = self._extract_reply(r.json())
                        if reply:
                            self.last_provider = "openrouter:free"
                            return reply
                    failures.append(f"openrouter:HTTP{r.status_code}")
                except Exception as exc:
                    failures.append(f"openrouter:{type(exc).__name__}")

            # Pillar 6: NVIDIA NIM
            nv_key = self._clean_key("NVIDIA_NIM_API_KEY")
            if nv_key:
                for model in (
                    "meta/llama-3.2-90b-vision-instruct",
                    "meta/llama-3.2-11b-vision-instruct",
                    "mistralai/mistral-large",
                ):
                    try:
                        r = await client.post(
                            "https://integrate.api.nvidia.com/v1/chat/completions",
                            headers={
                                "Authorization": f"Bearer {nv_key}",
                                "Content-Type": "application/json",
                            },
                            json={"model": model, "messages": payload_messages},
                        )
                        if r.status_code == 200:
                            reply = self._extract_reply(r.json())
                            if reply:
                                self.last_provider = f"nvidia-nim:{model}"
                                return reply
                        failures.append(f"nvidia-nim({model}):HTTP{r.status_code}")
                    except Exception as exc:
                        failures.append(f"nvidia-nim({model}):{type(exc).__name__}")

            # Pillar 7: SiliconFlow
            sf_key = self._clean_key("SILICONFLOW_API_KEY")
            if sf_key:
                for sf_url in (
                    "https://api.siliconflow.com/v1/chat/completions",
                    "https://api.siliconflow.cn/v1/chat/completions",
                ):
                    for sf_model in ("Qwen/Qwen3-8B", "Qwen/Qwen2.5-7B-Instruct"):
                        try:
                            r = await client.post(
                                sf_url,
                                headers={
                                    "Authorization": f"Bearer {sf_key}",
                                    "Content-Type": "application/json",
                                },
                                json={"model": sf_model, "messages": payload_messages},
                            )
                            if r.status_code == 200:
                                reply = self._extract_reply(r.json())
                                if reply:
                                    self.last_provider = f"siliconflow:{sf_model}"
                                    return reply
                            failures.append(f"siliconflow({sf_model}):HTTP{r.status_code}")
                            if r.status_code == 401:
                                break
                        except Exception as exc:
                            failures.append(f"siliconflow({sf_model}):{type(exc).__name__}")

            # Pillar 8: xAI / Grok
            xai_key = self._clean_key("XAI_API_KEY")
            if xai_key:
                for xai_model in ("grok-2-latest", "grok-3-mini"):
                    try:
                        r = await client.post(
                            "https://api.x.ai/v1/chat/completions",
                            headers={
                                "Authorization": f"Bearer {xai_key}",
                                "Content-Type": "application/json",
                            },
                            json={"model": xai_model, "messages": payload_messages},
                        )
                        if r.status_code == 200:
                            reply = self._extract_reply(r.json())
                            if reply:
                                self.last_provider = f"xai:{xai_model}"
                                return reply
                        failures.append(f"xai({xai_model}):HTTP{r.status_code}")
                        if r.status_code in (400, 401):
                            break
                    except Exception as exc:
                        failures.append(f"xai({xai_model}):{type(exc).__name__}")

            # Tier 3: Emergency Admin Backup (Native Gemini)
            if self.gemini_emergency_mode in {"free_pool", "payg"}:
                emergency_reply = await self._run_emergency_gemini(client, payload_messages)
                if emergency_reply:
                    return emergency_reply
                failures.append(f"gemini-emergency({self.gemini_emergency_mode}):failed")

        self.last_provider = "failed"
        raise RuntimeError(
            "All configured providers failed (" + ", ".join(failures or ["no_keys"]) + ")."
        )

    async def run_with_meta(self, messages: list[dict[str, Any]]) -> dict[str, str]:
        reply = await self.run(messages)
        return {
            "reply": reply,
            "provider": self.last_provider,
            "gemini_emergency_mode": self.gemini_emergency_mode,
        }

    def chat(self, messages: list[dict[str, Any]]) -> str:
        return asyncio.run(self.run(messages))


agent_router = AgentRouter()
