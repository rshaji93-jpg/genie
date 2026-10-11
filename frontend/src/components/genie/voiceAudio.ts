import { getBackendApiUrl } from "../../app/engine";

export type VoicePreset = "Aoede" | "Charon";

export const INDIAN_DIALECT_MAP: Record<string, string> = {
  "தமிழ்": "ta-IN",
  Tamil: "ta-IN",
  "മലയാളം": "ml-IN",
  Malayalam: "ml-IN",
  "తెలుగు": "te-IN",
  Telugu: "te-IN",
  "ಕನ್ನಡ": "kn-IN",
  Kannada: "kn-IN",
  "हिन्दी": "hi-IN",
  Hindi: "hi-IN",
  "বাংলা": "bn-IN",
  Bengali: "bn-IN",
  "मराठी": "mr-IN",
  Marathi: "mr-IN",
  "ગુજરાતી": "gu-IN",
  Gujarati: "gu-IN",
  "ਪੰਜਾਬੀ": "pa-IN",
  Punjabi: "pa-IN",
  "ଓଡ଼ିଆ": "or-IN",
  Odia: "or-IN",
  "اردو": "ur-IN",
  Urdu: "ur-IN",
  "অসমীয়া": "as-IN",
  Assamese: "as-IN",
  "संस्कृतम्": "sa-IN",
  Sanskrit: "sa-IN",
  "EN (India)": "en-IN",
  English: "en-IN",
  "en-IN": "en-IN",
  "ta-IN": "ta-IN",
  "ml-IN": "ml-IN",
  "te-IN": "te-IN",
  "kn-IN": "kn-IN",
  "hi-IN": "hi-IN",
  "bn-IN": "bn-IN",
  "mr-IN": "mr-IN",
  "gu-IN": "gu-IN",
  "pa-IN": "pa-IN",
  "or-IN": "or-IN",
  "ur-IN": "ur-IN",
  "as-IN": "as-IN",
  "sa-IN": "sa-IN",
};

let activeAudio: HTMLAudioElement | null = null;
let activeAudioUrl: string | null = null;
let activeRequest: AbortController | null = null;

const LOCALE_BY_SCRIPT: { pattern: RegExp; locale: string }[] = [
  { pattern: /[\u0B80-\u0BFF]/g, locale: "ta-IN" },
  { pattern: /[\u0900-\u097F]/g, locale: "hi-IN" },
  { pattern: /[\u0D00-\u0D7F]/g, locale: "ml-IN" },
  { pattern: /[\u0C00-\u0C7F]/g, locale: "te-IN" },
  { pattern: /[\u0C80-\u0CFF]/g, locale: "kn-IN" },
  { pattern: /[\u0980-\u09FF]/g, locale: "bn-IN" },
];

const LOCALE_BY_LANGUAGE: Record<string, string> = {
  en: "en-IN",
  ta: "ta-IN",
  hi: "hi-IN",
  ml: "ml-IN",
  te: "te-IN",
  kn: "kn-IN",
  bn: "bn-IN",
};

export function getSpeechLocale(text: string, fallbackLocale: string): string {
  let detectedLocale = "";
  let highestCount = 0;
  for (const { pattern, locale } of LOCALE_BY_SCRIPT) {
    const count = text.match(pattern)?.length || 0;
    if (count > highestCount) {
      detectedLocale = locale;
      highestCount = count;
    }
  }
  if (detectedLocale) return detectedLocale;

  return INDIAN_DIALECT_MAP[fallbackLocale] ||
    LOCALE_BY_LANGUAGE[fallbackLocale.split("-")[0].toLowerCase()] ||
    "en-IN";
}

export function stopActiveRegionalAudio() {
  activeRequest?.abort();
  activeRequest = null;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = "";
    activeAudio = null;
  }
  if (activeAudioUrl) {
    URL.revokeObjectURL(activeAudioUrl);
    activeAudioUrl = null;
  }
}

export async function playRegionalAudio(
  text: string,
  langKey = "ta",
  onPlaybackChange?: (playing: boolean) => void,
): Promise<HTMLAudioElement | null> {
  stopActiveRegionalAudio();
  const request = new AbortController();
  activeRequest = request;
  try {
    const response = await fetch(getBackendApiUrl("/api/tts/speak"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang: langKey || "ta" }),
      signal: request.signal,
    });
    if (!response.ok) {
      throw new Error(`Server-side speech synthesis failed (HTTP ${response.status}).`);
    }

    const audioBlob = await response.blob();
    if (!audioBlob.size) {
      throw new Error("Server-side speech synthesis returned empty audio.");
    }
    if (activeRequest !== request) return null;

    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    activeAudioUrl = audioUrl;
    activeAudio = audio;
    const releaseAudio = () => {
      onPlaybackChange?.(false);
      URL.revokeObjectURL(audioUrl);
      if (activeAudio !== audio) return;
      activeAudioUrl = null;
      activeAudio = null;
      activeRequest = null;
    };
    audio.addEventListener("play", () => onPlaybackChange?.(true), { once: true });
    audio.addEventListener(
      "ended",
      releaseAudio,
      { once: true },
    );
    audio.addEventListener(
      "error",
      releaseAudio,
      { once: true },
    );
    await audio.play();
    return audio;
  } catch (error) {
    if (activeRequest !== request) return null;
    if (error instanceof Error && error.name === "AbortError") return null;
    stopActiveRegionalAudio();
    throw error;
  }
}
