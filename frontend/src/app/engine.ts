export interface Message {
  role: "user" | "assistant";
  content: string;
  senderName?: string;
  senderEmail?: string;
  replyTo?: { author: string; content: string };
  triggeredByRainbow?: boolean;
  isIntervention?: boolean;
  modelUsed?: string;
  extractedCode?: {
    title: string;
    language: string;
    code: string;
  };
}

const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash"] as const;

export function getBackendBaseUrl(): string {
  const configuredUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL;

  if (configuredUrl?.trim()) return configuredUrl.trim().replace(/\/+$/, "");

  if (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")
  ) {
    return "http://localhost:8000";
  }

  return "https://personal-ai-genie.onrender.com";
}

export function checkWakeWordTrigger(text: string): boolean {
  const lower = text.toLowerCase();
  const triggers = [
    "@genie", "genie", "jini", "jeeni",
    "ஜீனி", "ஜீனியே", "கரெக்டா",
    "जीनी", "हे जीनी", "बताओ जीनी", "suno genie",
    "జీనీ", "చెప్పు జీనీ",
    "ജീനി", "പറയൂ ജീനി",
    "ಜೀನಿ", "ಹೇಳು ಜೀನಿ",
    "জিনি", "বলো জিনি",
  ];
  return triggers.some((trigger) => lower.includes(trigger.toLowerCase()) || text.includes(trigger));
}

interface BackendChatResponse {
  reply?: string;
  model_used?: string;
  error?: string;
  detail?: string;
}

async function responseError(response: Response): Promise<string> {
  let detail = "";
  try {
    const data = (await response.json()) as BackendChatResponse;
    detail = data.detail || data.error || "";
  } catch {
    detail = "";
  }
  return detail || `HTTP ${response.status} ${response.statusText}`.trim();
}

export async function callActiveGeminiCascade(
  userPrompt: string,
  history: Message[],
  selectedLangLabel: string,
  providedKey?: string,
  googleIdToken?: string
): Promise<{ text: string; model: string }> {
  const conversationHistory = (history || []).slice(-6).map((msg) => ({
    role: msg.role === "assistant" ? "assistant" : "user",
    content: msg.content,
    senderName: msg.senderName,
    senderEmail: msg.senderEmail,
  }));
  const cleanProvidedKey = providedKey?.trim() || undefined;
  const backendUrl = `${getBackendBaseUrl()}/api/chat`;
  let backendFailure: string;

  try {
    const response = await fetch(backendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        prompt: userPrompt,
        conversation_history: conversationHistory,
        custom_api_key: cleanProvidedKey,
        google_id_token: googleIdToken,
        models_cascade: GEMINI_MODELS,
        space_mode: "personal",
        language_code: "en-IN",
      }),
    });

    if (!response.ok) {
      backendFailure = await responseError(response);
    } else {
      const data = (await response.json()) as BackendChatResponse;
      if (data.reply?.trim()) {
        return { text: data.reply.trim(), model: data.model_used || "genie-backend" };
      }
      backendFailure = "Backend returned an empty chat response.";
    }
  } catch (error) {
    backendFailure =
      error instanceof Error ? error.message : "Unknown network error while contacting chat backend.";
  }

  try {
    const fallbackResponse = await fetch("/api/genie", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        prompt: userPrompt,
        history: conversationHistory,
        languageLabel: selectedLangLabel || "English",
        customApiKey: cleanProvidedKey,
      }),
    });

    if (!fallbackResponse.ok) {
      const fallbackFailure = await responseError(fallbackResponse);
      throw new Error(`Fallback API failed: ${fallbackFailure}`);
    }

    const fallbackData = (await fallbackResponse.json()) as BackendChatResponse;
    if (fallbackData.reply?.trim()) {
      return {
        text: fallbackData.reply.trim(),
        model: fallbackData.model_used || "genie-server-fallback",
      };
    }
    throw new Error("Fallback API returned an empty chat response.");
  } catch (fallbackError) {
    const fallbackFailure =
      fallbackError instanceof Error ? fallbackError.message : "Unknown fallback API error.";
    throw new Error(`Chat backend failed (${backendFailure}); ${fallbackFailure}`);
  }
}
