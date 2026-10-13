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

const GEMINI_MODELS = ["gemini-3.6-flash"] as const;

export function getBackendBaseUrl(): string {
  const configuredUrl =
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "https://genie-backend-481849166496.asia-south1.run.app";

  return configuredUrl.trim().replace(/\/+$/, "");
}

export function getBackendApiUrl(path: string): string {
  const baseUrl = getBackendBaseUrl().replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const pathPrefix = /\/api\/py$/.test(baseUrl) ? "/api/py" : /\/api$/.test(baseUrl) ? "/api" : "";
  const endpoint = pathPrefix
    ? normalizedPath.replace(/^(?:\/api\/)+/, "/")
    : normalizedPath.replace(/^(\/api\/){2,}/, "/api/");
  return `${baseUrl}${endpoint}`;
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
  response?: string;
  model_used?: string;
  error?: string;
  detail?: string;
}

async function responseError(response: Response): Promise<string> {
  let detail = "";
  try {
    const data = (await response.json()) as {
      detail?: string;
      error?: string | { message?: string };
    };
    detail = data.detail || (typeof data.error === "string" ? data.error : data.error?.message) || "";
  } catch {
    detail = "";
  }
  return detail || `HTTP ${response.status} ${response.statusText}`.trim();
}

async function callGeminiWithBrowserKey(
  prompt: string,
  history: Message[],
  language: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ text: string; model: string }> {
  const modelsResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { signal },
  );
  if (!modelsResponse.ok) {
    throw new Error(`Gemini key request failed: ${await responseError(modelsResponse)}`);
  }
  const modelsData = (await modelsResponse.json()) as {
    models?: { name?: string; supportedGenerationMethods?: string[] }[];
  };
  const availableModels = (modelsData.models || [])
    .filter((model) => model.name && model.supportedGenerationMethods?.includes("generateContent"))
    .map((model) => model.name!.replace(/^models\//, ""));
  const model = availableModels.find((name) => name.includes("flash")) || availableModels[0];
  if (!model) throw new Error("The Gemini API key has no models available for text generation.");

  const contents = [
    ...history.slice(-6).map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
    { role: "user", parts: [{ text: prompt }] },
  ];
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: `Respond in the language requested by the user. Selected interface language: ${language || "English"}.` }],
        },
        contents,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Gemini generation failed: ${await responseError(response)}`);
  }
  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("Gemini returned an empty response.");
  return { text, model };
}

export async function callActiveGeminiCascade(
  userPrompt: string,
  history: Message[],
  selectedLangLabel: string,
  providedKey?: string,
  googleIdToken?: string,
  signal?: AbortSignal
): Promise<{ text: string; model: string }> {
  const conversationHistory = (history || []).slice(-6).map((msg) => ({
    role: msg.role === "assistant" ? "assistant" : "user",
    content: msg.content,
    senderName: msg.senderName,
    senderEmail: msg.senderEmail,
  }));
  let storedBrowserKey = "";
  if (typeof window !== "undefined") {
    try {
      storedBrowserKey = window.localStorage.getItem("genie_user_byok_key") || "";
    } catch (error) {
      console.warn("Saved Gemini key could not be read from this browser:", error);
    }
  }
  const cleanProvidedKey =
    providedKey?.trim() ||
    storedBrowserKey.trim() ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY?.trim() ||
    undefined;
  if (cleanProvidedKey) {
    return callGeminiWithBrowserKey(
      userPrompt,
      history || [],
      selectedLangLabel,
      cleanProvidedKey,
      signal,
    );
  }
  const backendUrl = getBackendApiUrl("/api/chat");
  let backendFailure: string;

  try {
    const response = await fetch(backendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        prompt: userPrompt,
        conversation_history: conversationHistory,
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
      const reply = data.reply || data.response;
      if (reply?.trim()) {
        return { text: reply.trim(), model: data.model_used || "genie-backend" };
      }
      backendFailure = "Backend returned an empty chat response.";
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    backendFailure =
      error instanceof Error ? error.message : "Unknown network error while contacting chat backend.";
  }

  try {
    const fallbackResponse = await fetch("/api/genie", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        prompt: userPrompt,
        history: conversationHistory,
        languageLabel: selectedLangLabel || "English",
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
    if (signal?.aborted) throw fallbackError;
    const fallbackFailure =
      fallbackError instanceof Error ? fallbackError.message : "Unknown fallback API error.";
    throw new Error(`Chat backend failed (${backendFailure}); ${fallbackFailure}`);
  }
}
