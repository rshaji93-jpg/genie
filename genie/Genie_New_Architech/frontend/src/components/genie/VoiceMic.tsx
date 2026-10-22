"use client";

import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface VoiceMicProps {
  isMultiUserRoom: boolean;
  dialect?: string;
  currentText?: string;
  recentContext?: string;
  disabled?: boolean;
  onTranscription: (text: string, interim?: boolean) => void;
  onVoiceNoteRecorded: (dataUrl: string, durationSeconds: number) => void;
  transcribeRequest?: number;
  onActivity?: (activity: "recording" | "idle") => void;
  wakeWordActive?: boolean;
  onWakeWordPrompt?: (text: string, dialect: string) => void;
}

type RecognitionResultLike = ArrayLike<{ transcript: string }> & { isFinal?: boolean };

type RecognitionConstructor = new () => {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<RecognitionResultLike> }) => void) | null;
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
  const lastWakeWordAt = useRef(0);
  const wakeCallback = useRef(props.onWakeWordPrompt);
  const dictationBaseText = useRef("");
  const recognitionLocale = useRef("en-IN");

  useEffect(() => {
    wakeCallback.current = props.onWakeWordPrompt;
  }, [props.onWakeWordPrompt]);

  function wakeWordCommand(transcript: string): { prompt: string; dialect: string } | null {
    const match = /(?:^|\s)genie(?:\s+(?:pro|master))?\b[\s,:-]*/i.exec(transcript);
    if (!match) return null;
    const prompt = transcript.slice(match.index + match[0].length).trim();
    const dialect = /[\u0B80-\u0BFF]/.test(transcript)
      ? "ta-IN"
      : /[\u0C00-\u0C7F]/.test(transcript)
        ? "te-IN"
        : /[\u0900-\u097F]/.test(transcript)
          ? "hi-IN"
          : /[\u0D00-\u0D7F]/.test(transcript)
            ? "ml-IN"
            : props.dialect === "Tanglish" ? "en-IN" : props.dialect || "en-IN";
    return { prompt: prompt || "How can you help me?", dialect };
  }

  function detectLocale(context: string): string | null {
    if (/[\u0B80-\u0BFF]|\b(?:tamil|vanakkam|epdi)\b/i.test(context)) return "ta-IN";
    if (/[\u0D00-\u0D7F]|\b(?:malayalam|sugama)\b/i.test(context)) return "ml-IN";
    if (/[\u0900-\u097F]|\b(?:hindi|namaste)\b/i.test(context)) return "hi-IN";
    if (/[\u0C00-\u0C7F]|\btelugu\b/i.test(context)) return "te-IN";
    return null;
  }

  function contextLocale(): string {
    const currentTextLocale = detectLocale(props.currentText || "");
    if (currentTextLocale) return currentTextLocale;
    const recentLocale = (props.recentContext || "")
      .split("\n")
      .reverse()
      .map(detectLocale)
      .find((locale) => locale !== null);
    return recentLocale || "en-IN";
  }

  recognitionLocale.current = contextLocale();

  function startWakeListener() {
    if (!props.wakeWordActive || recognition.current) return;
    const candidate = window as typeof window & {
      SpeechRecognition?: RecognitionConstructor;
      webkitSpeechRecognition?: RecognitionConstructor;
    };
    const Speech = candidate.SpeechRecognition || candidate.webkitSpeechRecognition;
    if (!Speech) {
      setError("Wake-word listening is unavailable in this browser.");
      return;
    }
    manualStop.current = false;
    const instance = new Speech();
    instance.lang = recognitionLocale.current;
    instance.continuous = true;
    instance.interimResults = false;
    instance.onresult = (event) => {
      const transcript = event.results[event.results.length - 1]?.[0]?.transcript || "";
      const command = wakeWordCommand(transcript);
      if (!command || Date.now() - lastWakeWordAt.current < 2500) return;
      lastWakeWordAt.current = Date.now();
      wakeCallback.current?.(command.prompt, command.dialect);
    };
    instance.onerror = (event) => {
      if (event.error === "no-speech") return;
      manualStop.current = true;
      setError("Wake-word listening stopped. Check microphone permissions.");
    };
    instance.onend = () => {
      if (!manualStop.current && props.wakeWordActive && recognition.current === instance) {
        recognition.current = null;
        window.setTimeout(startWakeListener, 250);
        return;
      }
      if (recognition.current === instance) recognition.current = null;
      setRecording(false);
    };
    recognition.current = instance;
    try {
      instance.start();
      setError("");
      setRecording(true);
    } catch {
      recognition.current = null;
      manualStop.current = true;
      setError("Wake-word listening could not start.");
    }
  }

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
    return sentence;
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
        dictationBaseText.current = props.currentText || "";
        instance.lang = recognitionLocale.current;
        instance.continuous = false;
        instance.interimResults = true;
        instance.onresult = (event) => {
          const latestResult = event.results[event.results.length - 1];
          const isFinal = latestResult?.isFinal ?? true;
          let text = professionalizeTranscript(
            Array.from(event.results).map((result) => result[0]?.transcript || "").join(" "),
          );
          if (!text) return;
          if (isFinal && !/[.!?]$/.test(text)) text += ".";
          const base = dictationBaseText.current;
          props.onTranscription(
            `${base}${base && !/\s$/.test(base) ? " " : ""}${text}`,
            !isFinal,
          );
        };
        instance.onerror = (event) => {
          if (event.error === "no-speech") return;
          manualStop.current = true;
          setError("Speech recognition failed. Check microphone permissions.");
        };
        instance.onend = () => {
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

  useEffect(() => {
    if (!props.wakeWordActive) return;
    startWakeListener();
    return () => {
      manualStop.current = true;
      recognition.current?.stop();
      recognition.current = null;
      setRecording(false);
    };
  }, [props.wakeWordActive, props.dialect]);

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
        onClick={() => {
          if (recording) stop();
          else if (props.wakeWordActive) startWakeListener();
          else void start();
        }}
        aria-label={recording
          ? props.wakeWordActive ? "Stop listening for Genie" : "Stop voice input"
          : props.wakeWordActive ? "Listen for Genie wake word" : props.isMultiUserRoom ? "Record encrypted voice note" : "Dictate to Genie"}
        title={props.wakeWordActive
          ? recording ? "Stop listening for Genie" : "Listen for Genie wake word"
          : props.isMultiUserRoom ? "Record encrypted P2P voice note" : "Dictate to Genie"}
      >
        {recording ? <Square size={15} fill="currentColor" /> : <Mic size={18} />}
      </button>
      {recording && <span className="voice-waveform" aria-label={props.wakeWordActive ? "Listening for Genie wake word" : "Listening"}>{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</span>}
      {error && <span className="mic-error" role="status">{error}</span>}
    </div>
  );
}
