"use client";

import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface VoiceMicProps {
  isMultiUserRoom: boolean;
  dialect?: string;
  disabled?: boolean;
  onTranscription: (text: string) => void;
  onVoiceNoteRecorded: (dataUrl: string, durationSeconds: number) => void;
  transcribeRequest?: number;
  onActivity?: (activity: "recording" | "idle") => void;
}

type RecognitionConstructor = new () => {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

export default function VoiceMic(props: VoiceMicProps) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const recognition = useRef<InstanceType<RecognitionConstructor> | null>(null);
  const manualStop = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const startedAt = useRef(0);
  const chunks = useRef<Blob[]>([]);

  function professionalizeTranscript(value: string): string {
    const normalized = value
      .replace(/\b(?:um+|uh+|erm+|you know)\b/gi, "")
      .replace(/\s+/g, " ")
      .replace(/\s+([,.!?])/g, "$1")
      .trim();
    if (!normalized) return "";
    const sentence = normalized
      .replace(/(^|[.!?]\s+)([a-z])/g, (_match, boundary: string, letter: string) => `${boundary}${letter.toLocaleUpperCase()}`)
      .replace(/^./, (first) => first.toLocaleUpperCase());
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
  }

  useEffect(() => () => {
    manualStop.current = true;
    recognition.current?.stop();
    recorder.current?.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function start(transcribeOnly = false) {
    setError("");
    startedAt.current = Date.now();
    manualStop.current = false;
    if (!props.isMultiUserRoom || transcribeOnly) {
      const candidate = window as typeof window & {
        SpeechRecognition?: RecognitionConstructor;
        webkitSpeechRecognition?: RecognitionConstructor;
      };
      const Speech = candidate.SpeechRecognition || candidate.webkitSpeechRecognition;
      if (Speech) {
        const instance = new Speech();
        instance.lang = props.dialect === "Tanglish" ? "en-IN" : props.dialect || "en-IN";
        instance.interimResults = false;
        instance.onresult = (event) => {
          const text = professionalizeTranscript(Array.from(event.results).map((result) => result[0]?.transcript || "").join(" "));
          if (text) props.onTranscription(text);
        };
        instance.onerror = (event) => {
          if (event.error === "no-speech") return;
          manualStop.current = true;
          setError("Speech recognition failed. Check microphone permissions.");
        };
        instance.onend = () => {
          if (!manualStop.current && recognition.current === instance) {
            window.setTimeout(() => {
              if (!manualStop.current && recognition.current === instance) {
                try {
                  instance.start();
                } catch {
                  manualStop.current = true;
                  recognition.current = null;
                  setRecording(false);
                  props.onActivity?.("idle");
                }
              }
            }, 200);
            return;
          }
          if (recognition.current === instance) recognition.current = null;
          setRecording(false);
          props.onActivity?.("idle");
        };
        recognition.current = instance;
        instance.start();
        setRecording(true);
        props.onActivity?.("recording");
        return;
      }
      if (transcribeOnly) {
        setError("Live transcription is unavailable in this browser.");
        return;
      }
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const capture = new MediaRecorder(media);
      recorder.current = capture;
      chunks.current = [];
      capture.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      capture.onstop = () => {
        const blob = new Blob(chunks.current, { type: capture.mimeType || "audio/webm" });
        if (blob.size > 8_000_000) {
          setError("Voice note is larger than 8 MB. Record a shorter note.");
          media.getTracks().forEach((track) => track.stop());
          stream.current = null;
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === "string") {
            props.onVoiceNoteRecorded(reader.result, Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)));
          }
        };
        reader.readAsDataURL(blob);
        media.getTracks().forEach((track) => track.stop());
        stream.current = null;
      };
      capture.start();
      setRecording(true);
      props.onActivity?.("recording");
    } catch {
      setError("Microphone access is unavailable. Use HTTPS and grant permission.");
    }
  }

  useEffect(() => {
    if (props.transcribeRequest) void start(true);
  }, [props.transcribeRequest]);

  function stop() {
    manualStop.current = true;
    recognition.current?.stop();
    recognition.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current = null;
    setRecording(false);
    props.onActivity?.("idle");
  }

  return (
    <div className="voice-control">
      <button
        type="button"
        className={`icon-button mic-button ${recording ? "recording" : ""}`}
        disabled={props.disabled}
        onClick={() => recording ? stop() : void start()}
        aria-label={recording ? "Stop voice input" : props.isMultiUserRoom ? "Record encrypted voice note" : "Dictate to Genie"}
        title={props.isMultiUserRoom ? "Record encrypted P2P voice note" : "Dictate to Genie"}
      >
        {recording ? <Square size={15} fill="currentColor" /> : <Mic size={18} />}
      </button>
      {recording && !props.isMultiUserRoom && <span className="voice-waveform" aria-label="Listening">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</span>}
      {error && <span className="mic-error" role="status">{error}</span>}
    </div>
  );
}
