import { NextResponse } from "next/server";

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatRequestBody {
  action?: string;
  prompt?: string;
  history?: ChatMessage[];
  languageLabel?: string;
  customApiKey?: string;
  code?: string;
}

const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
];
const OPENROUTER_MODELS = [
  "google/gemini-2.0-flash-001",
  "meta-llama/llama-3.3-70b-instruct",
];

function decodeBase32(secret: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleanSecret = secret.replace(/[\s=]/g, "").toUpperCase();
  let bits = "";

  for (const character of cleanSecret) {
    const value = alphabet.indexOf(character);
    if (value === -1) throw new Error("Invalid authenticator secret configuration.");
    bits += value.toString(2).padStart(5, "0");
  }

  const bytes = new Uint8Array(new ArrayBuffer(Math.floor(bits.length / 8)));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  return bytes;
}

async function verifyTotpCode(code: string, secret: string): Promise<boolean> {
  const cleanCode = code.replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(cleanCode)) return false;

  const keyBytes = decodeBase32(secret);
  const keyBuffer = new ArrayBuffer(keyBytes.length);
  new Uint8Array(keyBuffer).set(keyBytes);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const currentStep = Math.floor(Date.now() / 30_000);

  for (const step of [currentStep, currentStep - 1, currentStep + 1]) {
    const counter = new ArrayBuffer(8);
    new DataView(counter).setUint32(4, step, false);
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);
    if ((binary % 1_000_000).toString().padStart(6, "0") === cleanCode) return true;
  }
  return false;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return typeof message.role === "string" && typeof message.content === "string";
}

export async function POST(request: Request) {
  let body: ChatRequestBody;
  try {
    const parsedBody: unknown = await request.json();
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }
    body = parsedBody as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (body.action === "verify_totp") {
    const secret = process.env.GENIE_MASTER_TOTP_SECRET;
    if (!secret) {
      console.error("TOTP verification is unavailable: GENIE_MASTER_TOTP_SECRET is not configured.");
      return NextResponse.json(
        { error: "Authenticator verification is not configured on the server." },
        { status: 503 }
      );
    }

    try {
      const code = typeof body.code === "string" ? body.code : "";
      const valid = await verifyTotpCode(code, secret);
      return NextResponse.json({ valid });
    } catch {
      console.error("TOTP verification failed due to invalid server configuration.");
      return NextResponse.json(
        { error: "Authenticator verification could not be completed." },
        { status: 500 }
      );
    }
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "A non-empty prompt is required." }, { status: 400 });
  }

  const history = Array.isArray(body.history) ? body.history.filter(isChatMessage).slice(-6) : [];
  const language =
    typeof body.languageLabel === "string" ? body.languageLabel.trim() || "English" : "English";
  const systemInstruction =
    `You are Personal AI Genie, a helpful, intelligent collaborator. Respond clearly and thoroughly in ${language}.`;
  const geminiKey =
    (typeof body.customApiKey === "string" ? body.customApiKey.trim() : "") ||
    process.env.GEMINI_API_KEY?.trim() ||
    "";
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() || "";
  const failures: string[] = [];
  const requests: Promise<{ text: string; model: string }>[] = [];

  const callGemini = async (model: string): Promise<{ text: string; model: string }> => {
    let response: Response;
    const sanitizedKey = geminiKey.trim();
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model.replace(/^models\//, "")}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": sanitizedKey,
          },
          signal: request.signal,
          body: JSON.stringify({
            contents: [
              ...history.map((message) => ({
                role: message.role === "assistant" || message.role === "model" ? "model" : "user",
                parts: [{ text: message.content }],
              })),
              { role: "user", parts: [{ text: prompt }] },
            ],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: { temperature: 0.7, maxOutputTokens: 1500 },
          }),
        }
      );
    } catch (error) {
      if (request.signal.aborted) throw error;
      throw new Error(`Gemini ${model} request failed due to a network error.`);
    }
    if (!response.ok) {
      let upstreamError = "";
      try {
        const errorBody = (await response.json()) as {
          error?: { message?: string; status?: string };
        };
        const details = [errorBody.error?.status, errorBody.error?.message].filter(Boolean);
        if (details.length) upstreamError = `: ${details.join(" - ")}`;
      } catch {
        upstreamError = "";
      }
      throw new Error(
        `Gemini ${model} returned HTTP ${response.status}${upstreamError}.`
      );
    }

    const responseBody = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = responseBody.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error(`Gemini ${model} returned an empty response.`);
    return { text, model };
  };

  const callOpenRouter = async (model: string): Promise<{ text: string; model: string }> => {
    let response: Response;
    try {
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openRouterKey}`,
          "HTTP-Referer": "https://personal-ai-genie.vercel.app",
          "X-Title": "Personal AI Genie",
        },
        signal: request.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemInstruction },
            ...history.map((message) => ({
              role: message.role === "assistant" || message.role === "model" ? "assistant" : "user",
              content: message.content,
            })),
            { role: "user", content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 1500,
        }),
      });
    } catch (error) {
      if (request.signal.aborted) throw error;
      throw new Error(`OpenRouter ${model} request failed due to a network error.`);
    }
    if (!response.ok) throw new Error(`OpenRouter ${model} returned HTTP ${response.status}.`);

    const responseBody = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = responseBody.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error(`OpenRouter ${model} returned an empty response.`);
    return { text, model: `OpenRouter (${model.split("/").pop()})` };
  };

  if (geminiKey) {
    for (const model of GEMINI_MODELS) {
      requests.push(
        callGemini(model).catch((error: unknown) => {
          failures.push(error instanceof Error ? error.message : `Gemini ${model} failed.`);
          throw error;
        })
      );
    }
  }
  if (openRouterKey) {
    requests.push(
      (async () => {
        for (const model of OPENROUTER_MODELS) {
          try {
            return await callOpenRouter(model);
          } catch (error) {
            const diagnostic =
              error instanceof Error ? error.message : `OpenRouter ${model} failed.`;
            failures.push(diagnostic);
            if (/HTTP 40[13]\b/.test(diagnostic)) break;
          }
        }
        throw new Error("OpenRouter models were unavailable.");
      })()
    );
  }

  if (requests.length === 0) {
    return NextResponse.json(
      {
        error:
          "No chat providers are configured. Add GEMINI_API_KEY or OPENROUTER_API_KEY on the server, or provide a BYOK key.",
      },
      { status: 503 }
    );
  }

  try {
    const result = await Promise.any(requests);
    return NextResponse.json({ success: true, reply: result.text, model_used: result.model });
  } catch {
    const diagnostic = failures.join(" ");
    console.error("All configured chat providers failed.", diagnostic);
    return NextResponse.json(
      { error: diagnostic || "All configured chat providers failed." },
      { status: 503 }
    );
  }
}
