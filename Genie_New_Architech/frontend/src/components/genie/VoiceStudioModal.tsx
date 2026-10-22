"use client";

import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";

export type GenieVoiceId = "genie-assistant" | "genie-master";

type DictationRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<(ArrayLike<{ transcript: string }> & { isFinal?: boolean })>; resultIndex?: number }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
};
type DictationRecognitionConstructor = new () => DictationRecognition;

interface VoiceStudioModalProps {
  open: boolean;
  credential: string;
  selectedVoiceId: GenieVoiceId;
  onClose: () => void;
  onSelect: (voiceId: GenieVoiceId) => void;
  onTranscription?: (text: string) => void;
}

const VOICES: Array<{
  id: GenieVoiceId;
  label: string;
  model: string;
  lang: string;
  pitch: number;
  rate: number;
  sample: string;
}> = [
  {
    id: "genie-assistant",
    label: "Genie Assistant",
    model: "genie-assistant",
    lang: "en-IN",
    pitch: 1.08,
    rate: 1,
    sample: "Hello, I am your Genie Assistant. I can help with everyday questions, explain ideas clearly, and make your next step easier with a calm, thoughtful voice.",
  },
  {
    id: "genie-master",
    label: "Genie Master",
    model: "genie-master",
    lang: "en-IN",
    pitch: 1.12,
    rate: 0.96,
    sample: "Hello, I am Genie Master. I bring careful reasoning to complex questions, code, and documents, then share a clear and considerate explanation you can act on.",
  },
];

export default function VoiceStudioModal({
  open,
  credential,
  selectedVoiceId,
  onClose,
  onSelect,
  onTranscription,
}: VoiceStudioModalProps) {
  const [previewing, setPreviewing] = useState<GenieVoiceId | null>(null);
  const [dictationActive, setDictationActive] = useState(false);
  const [dictationText, setDictationText] = useState("");
  const [dictationSeconds, setDictationSeconds] = useState(90);
  const [dictationError, setDictationError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const dictationRef = useRef<DictationRecognition | null>(null);
  const dictationActiveRef = useRef(false);
  const accumulatedTranscriptRef = useRef("");
  const dictationTimerRef = useRef<number | undefined>(undefined);
  const dictationIntervalRef = useRef<number | undefined>(undefined);
  const dictationDeadlineRef = useRef(0);

  function stopPreview() {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    window.speechSynthesis?.cancel();
    setPreviewing(null);
  }

  useEffect(() => () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    dictationActiveRef.current = false;
    if (dictationTimerRef.current !== undefined) window.clearTimeout(dictationTimerRef.current);
    if (dictationIntervalRef.current !== undefined) window.clearInterval(dictationIntervalRef.current);
    dictationRef.current?.stop();
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    if (!open && dictationActiveRef.current) {
      dictationActiveRef.current = false;
      if (dictationTimerRef.current !== undefined) window.clearTimeout(dictationTimerRef.current);
      if (dictationIntervalRef.current !== undefined) window.clearInterval(dictationIntervalRef.current);
      dictationRef.current?.stop();
      dictationRef.current = null;
      setDictationActive(false);
      setDictationSeconds(0);
    }
  }, [open]);

  function finishDictation() {
    dictationActiveRef.current = false;
    if (dictationTimerRef.current !== undefined) window.clearTimeout(dictationTimerRef.current);
    if (dictationIntervalRef.current !== undefined) window.clearInterval(dictationIntervalRef.current);
    dictationTimerRef.current = undefined;
    dictationIntervalRef.current = undefined;
    dictationRef.current?.stop();
    dictationRef.current = null;
    setDictationActive(false);
    setDictationSeconds(0);
  }

  function startDictation() {
    const candidate = window as typeof window & {
      SpeechRecognition?: DictationRecognitionConstructor;
      webkitSpeechRecognition?: DictationRecognitionConstructor;
    };
    const Speech = candidate.SpeechRecognition || candidate.webkitSpeechRecognition;
    if (!Speech) {
      setDictationError("Speech recognition is unavailable in this browser.");
      return;
    }
    setDictationError("");
    accumulatedTranscriptRef.current = dictationText.trim();
    const recognition = new Speech();
    dictationRef.current = recognition;
    dictationActiveRef.current = true;
    dictationDeadlineRef.current = Date.now() + 90_000;
    setDictationSeconds(90);
    setDictationActive(true);
    recognition.lang = "en-IN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex ?? 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        const spoken = result[0]?.transcript || "";
        if (result.isFinal) {
          accumulatedTranscriptRef.current = `${accumulatedTranscriptRef.current} ${spoken}`.trim();
        } else {
          interim += `${spoken} `;
        }
      }
      const value = [accumulatedTranscriptRef.current, interim.trim()].filter(Boolean).join(" ");
      setDictationText(value);
      onTranscription?.(value);
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (dictationActiveRef.current) {
        setDictationError("Speech recognition stopped. Your captured text is preserved.");
        finishDictation();
      }
    };
    recognition.onend = () => {
      if (!dictationActiveRef.current || Date.now() >= dictationDeadlineRef.current) {
        finishDictation();
        return;
      }
      window.setTimeout(() => {
        if (!dictationActiveRef.current || Date.now() >= dictationDeadlineRef.current) return;
        try {
          recognition.start();
        } catch {
          finishDictation();
          setDictationError("Speech recognition could not resume. Your captured text is preserved.");
        }
      }, 40);
    };
    try {
      recognition.start();
    } catch {
      dictationActiveRef.current = false;
      setDictationActive(false);
      setDictationError("Speech recognition could not start. Check microphone permissions.");
      return;
    }
    dictationTimerRef.current = window.setTimeout(finishDictation, 90_000);
    dictationIntervalRef.current = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((dictationDeadlineRef.current - Date.now()) / 1000));
      setDictationSeconds(remaining);
      if (remaining === 0) finishDictation();
    }, 1000);
  }

  async function playPreview(voice: (typeof VOICES)[number]) {
    if (previewing === voice.id) {
      stopPreview();
      return;
    }
    stopPreview();
    setPreviewing(voice.id);
    try {
      const response = await apiRequest("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        },
        body: JSON.stringify({ text: voice.sample, dialect: voice.lang, model: voice.model }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Native voice preview is unavailable.");
      const result = await response.json() as { audio_base64?: string; mime_type?: string };
      if (!result.audio_base64) throw new Error("Native voice preview returned no audio.");
      const audio = new Audio(`data:${result.mime_type || "audio/wav"};base64,${result.audio_base64}`);
      audioRef.current = audio;
      audio.onended = () => setPreviewing(null);
      await audio.play();
    } catch {
      if (!("speechSynthesis" in window)) {
        setPreviewing(null);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(voice.sample);
      utterance.lang = voice.lang;
      utterance.pitch = voice.pitch;
      utterance.rate = voice.rate;
      utterance.onend = () => setPreviewing(null);
      utterance.onerror = () => setPreviewing(null);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }
    timerRef.current = window.setTimeout(stopPreview, 10_000);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) { stopPreview(); onClose(); } }}
      role="presentation"
    >
      <section
        aria-labelledby="genie-voice-studio-title"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-cyan-900/20 bg-[#FAF9F5] p-5 shadow-2xl"
        role="dialog"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <span className="eyebrow">VOICE STUDIO</span>
            <h2 className="mt-1 text-xl font-semibold" id="genie-voice-studio-title">Choose your Genie voice</h2>
            <p className="mt-1 text-sm text-stone-600">Two polite feminine voices with native Gemini speech and browser fallback.</p>
          </div>
          <button className="utility-trigger" onClick={() => { stopPreview(); onClose(); }} type="button">Close</button>
        </div>
        <div className="grid gap-2">
          {VOICES.map((voice) => (
            <div
              className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${selectedVoiceId === voice.id ? "border-cyan-500 bg-cyan-50" : "border-stone-200 bg-white"}`}
              key={voice.id}
            >
              <button className="min-w-0 flex-1 text-left" onClick={() => onSelect(voice.id)} type="button">
                <strong className="block">{voice.label}</strong>
                <small className="text-stone-500">Gemini native TTS · {voice.lang}</small>
              </button>
              <button
                aria-label={previewing === voice.id ? `Stop ${voice.label} sample` : `Play ${voice.label} 10-second sample`}
                className="utility-trigger"
                onClick={() => void playPreview(voice)}
                type="button"
              >
                {previewing === voice.id ? "⏹ Stop" : "▶ 10s Sample"}
              </button>
            </div>
          ))}
        </div>
        <section className="voice-studio-dictation" aria-label="Voice dictation">
          <div className="voice-studio-dictation-header">
            <strong>Pause-safe dictation</strong>
            <button className="utility-trigger" onClick={() => dictationActive ? finishDictation() : startDictation()} type="button">
              {dictationActive ? <><Square size={14} /> Stop ({dictationSeconds}s)</> : <><Mic size={14} /> Dictate</>}
            </button>
          </div>
          {dictationActive && <p className="dictation-live-pill voice-studio-live-pill" role="status">
            🔴 Listening ({dictationSeconds}s left) · Pause-safe — Tap Mic to finish
          </p>}
          <textarea
            aria-label="Dictated text"
            onChange={(event) => {
              accumulatedTranscriptRef.current = event.target.value;
              setDictationText(event.target.value);
            }}
            placeholder="Your dictated text will appear here. You can edit it before copying."
            rows={4}
            value={dictationText}
          />
          {dictationError && <p className="mic-error" role="alert">{dictationError}</p>}
        </section>
      </section>
    </div>
  );
}
