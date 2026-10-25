"use client";

import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface RecognitionResult {
  readonly 0: { readonly transcript: string };
  readonly isFinal: boolean;
}

interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
}

interface RecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface ContinuousMicDictationProps {
  currentText: string;
  disabled?: boolean;
  dialect: string;
  onActivity?: (activity: "recording" | "idle") => void;
  onTranscription: (text: string) => void;
}

type RecognitionConstructor = new () => RecognitionInstance;

export default function ContinuousMicDictation(props: ContinuousMicDictationProps) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const listeningRef = useRef(false);
  const baseTextRef = useRef("");
  const finalTextRef = useRef("");
  const restartTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    listeningRef.current = false;
    if (restartTimerRef.current !== undefined) window.clearTimeout(restartTimerRef.current);
    recognitionRef.current?.stop();
  }, []);

  function stop() {
    listeningRef.current = false;
    if (restartTimerRef.current !== undefined) window.clearTimeout(restartTimerRef.current);
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    props.onActivity?.("idle");
  }

  function start() {
    const browser = window as typeof window & {
      SpeechRecognition?: RecognitionConstructor;
      webkitSpeechRecognition?: RecognitionConstructor;
    };
    const Speech = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!Speech) {
      setError("Continuous speech dictation is unavailable in this browser.");
      return;
    }

    setError("");
    baseTextRef.current = props.currentText.trim();
    finalTextRef.current = "";
    listeningRef.current = true;

    const createRecognition = () => {
      if (!listeningRef.current) return;
      const recognition = new Speech();
      recognition.lang = props.dialect;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        const interim: string[] = [];
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result?.[0]?.transcript.trim();
          if (!transcript) continue;
          if (result.isFinal) {
            finalTextRef.current = [finalTextRef.current, transcript].filter(Boolean).join(" ");
          } else {
            interim.push(transcript);
          }
        }
        const spokenText = [finalTextRef.current, ...interim].filter(Boolean).join(" ").trim();
        const base = baseTextRef.current;
        if (spokenText) props.onTranscription(`${base}${base ? " " : ""}${spokenText}`);
      };
      recognition.onerror = (event) => {
        if (event.error !== "no-speech" && event.error !== "aborted") {
          setError("Speech recognition failed. Check microphone permissions.");
          listeningRef.current = false;
          setListening(false);
          props.onActivity?.("idle");
        }
      };
      recognition.onend = () => {
        if (!listeningRef.current) return;
        restartTimerRef.current = window.setTimeout(createRecognition, 120);
      };
      recognitionRef.current = recognition;
      try {
        recognition.start();
        setListening(true);
        props.onActivity?.("recording");
      } catch {
        recognitionRef.current = null;
        if (listeningRef.current) restartTimerRef.current = window.setTimeout(createRecognition, 250);
      }
    };
    createRecognition();
  }

  return (
    <div className="voice-control">
      <button
        aria-label={listening ? "Stop dictation" : "Start dictation"}
        className={`icon-button mic-button ${listening ? "recording" : ""}`}
        disabled={props.disabled}
        onClick={listening ? stop : start}
        title={listening ? "Stop dictation" : "Dictate to Genie"}
        type="button"
      >
        {listening ? <Square size={15} fill="currentColor" /> : <Mic size={18} />}
      </button>
      {listening && <span className="dictation-live-pill" role="status">Listening · tap Stop when finished</span>}
      {error && <span className="mic-error" role="status">{error}</span>}
    </div>
  );
}
