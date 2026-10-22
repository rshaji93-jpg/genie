"use client";

import { useEffect, useRef, useState } from "react";

export type GenieVoiceId = "genie-assistant" | "genie-master";

interface VoiceStudioModalProps {
  open: boolean;
  credential: string;
  selectedVoiceId: GenieVoiceId;
  onClose: () => void;
  onSelect: (voiceId: GenieVoiceId) => void;
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
}: VoiceStudioModalProps) {
  const [previewing, setPreviewing] = useState<GenieVoiceId | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

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
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
  }, []);

  async function playPreview(voice: (typeof VOICES)[number]) {
    if (previewing === voice.id) {
      stopPreview();
      return;
    }
    stopPreview();
    setPreviewing(voice.id);
    try {
      const response = await fetch("/api/py/tts", {
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
      </section>
    </div>
  );
}
