"use client";

import { Mic, MicOff } from "lucide-react";
import { PointerEvent, useEffect, useRef, useState } from "react";
import { INDIAN_DIALECT_MAP } from "./genie/voiceAudio";

interface SpeechRecognitionResultItem {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResultItem;
}

interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface BrowserSpeechRecognitionConstructor {
  new(): BrowserSpeechRecognition;
}

interface VoiceMicProps {
  disabled?: boolean;
  language?: string;
  onRecordingChange?: (recording: boolean) => void;
  onError?: (message: string) => void;
  onTranscription: (text: string) => void;
}

export default function VoiceMic({
  disabled = false,
  language = "en-IN",
  onRecordingChange,
  onError,
  onTranscription,
}: VoiceMicProps) {
  const languageCode = INDIAN_DIALECT_MAP[language] || "en-IN";
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startingRef = useRef(false);
  const suppressTouchClickRef = useRef(false);
  const touchHoldRef = useRef(false);
  const touchModeRef = useRef(false);

  useEffect(() => {
    if (recognitionRef.current) recognitionRef.current.lang = languageCode;
  }, [languageCode]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  async function startRecording() {
    if (startingRef.current || recognitionRef.current || recorderRef.current || disabled) return;
    startingRef.current = true;
    setError("");

    const speechWindow = window as typeof window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    const SpeechRecognition =
      speechWindow.webkitSpeechRecognition || speechWindow.SpeechRecognition;
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = languageCode;
        recognition.onresult = (event) => {
          const transcript = Array.from(
            { length: event.results.length - event.resultIndex },
            (_, index) => event.results[event.resultIndex + index],
          )
            .filter((result) => result.isFinal)
            .map((result) => result[0].transcript.trim())
            .filter(Boolean)
            .join(" ");
          if (transcript) onTranscription(transcript);
        };
        recognition.onerror = (event) => {
          if (event.error !== "aborted") {
            const message =
              event.error === "not-allowed" || event.error === "service-not-allowed"
                ? "Microphone permission was denied. Allow microphone access and try again."
                : event.error === "no-speech"
                  ? "No speech was detected. Try speaking again."
                  : "Speech recognition failed. Please try again.";
            setError(message);
            onError?.(message);
          }
          setIsRecording(false);
          onRecordingChange?.(false);
        };
        recognition.onend = () => {
          if (recognitionRef.current !== recognition) return;
          recognitionRef.current = null;
          setIsRecording(false);
          onRecordingChange?.(false);
          touchModeRef.current = false;
        };
        recognitionRef.current = recognition;
        recognition.start();
        setIsRecording(true);
        onRecordingChange?.(true);
        if (touchModeRef.current && !touchHoldRef.current) stopRecording();
        return;
      } catch (recognitionError) {
        recognitionRef.current = null;
        const message =
          recognitionError instanceof Error
            ? recognitionError.message
            : "Speech recognition could not start.";
        setError(message);
        onError?.(message);
        return;
      } finally {
        startingRef.current = false;
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const isIOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const preferredTypes = isIOS
        ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]
        : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const mimeType = preferredTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const audioType = recorder.mimeType || mimeType || "audio/webm";
        const extension = audioType.includes("mp4") ? "mp4" : "webm";
        const audio = new Blob(chunksRef.current, { type: audioType });
        chunksRef.current = [];
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setIsRecording(false);
        onRecordingChange?.(false);
        touchModeRef.current = false;
        void uploadRecording(audio, extension);
      };
      recorder.onerror = () => {
        setError("Recording failed. Please try again.");
        if (recorder.state !== "inactive") recorder.stop();
      };
      recorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      onRecordingChange?.(true);
      if (touchModeRef.current && !touchHoldRef.current) stopRecording();
    } catch (recordingError) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      const message =
        recordingError instanceof Error ? recordingError.message : "Microphone access is unavailable.";
      setError(message);
      onError?.(message);
    } finally {
      startingRef.current = false;
    }
  }

  function stopRecording() {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.stop();
      return;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  async function uploadRecording(audio: Blob, extension: string) {
    if (!audio.size) {
      setError("No audio was recorded.");
      return;
    }
    try {
      const formData = new FormData();
      formData.append("file", audio, `voice-message.${extension}`);
      const response = await fetch("/api/py/api/voice/transcribe", {
        method: "POST",
        body: formData,
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        throw new Error(
          response.ok
            ? "The transcription service returned an unexpected response."
            : `Transcription failed (HTTP ${response.status}).`,
        );
      }
      const result = (await response.json()) as { text?: string; detail?: string };
      if (!response.ok) {
        throw new Error(result.detail || `Transcription failed (HTTP ${response.status}).`);
      }
      if (!result.text?.trim()) throw new Error("No speech was detected.");
      onTranscription(result.text.trim());
    } catch (transcriptionError) {
      const message =
        transcriptionError instanceof Error
          ? transcriptionError.message
          : "Voice transcription failed.";
      setError(message);
      onError?.(message);
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "touch") {
      event.preventDefault();
      suppressTouchClickRef.current = true;
      touchModeRef.current = true;
      touchHoldRef.current = true;
      void startRecording();
    }
  }

  function handlePointerEnd(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "touch") {
      event.preventDefault();
      touchHoldRef.current = false;
      if (recorderRef.current) {
        stopRecording();
        touchModeRef.current = false;
      }
    }
  }

  function handleClick() {
    if (suppressTouchClickRef.current) {
      suppressTouchClickRef.current = false;
      return;
    }
    if (isRecording) stopRecording();
    else void startRecording();
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onClick={handleClick}
        onContextMenu={(event) => event.preventDefault()}
        disabled={disabled}
        aria-label={isRecording ? "Stop recording and transcribe" : "Record voice message"}
        aria-pressed={isRecording}
        title={
          error
            ? error
            : isRecording
              ? "Recording — release to transcribe"
              : "Hold to talk on mobile; click twice on desktop"
        }
        className={`touch-none select-none rounded-full p-1.5 transition-all sm:p-2 ${
          isRecording
            ? "bg-rose-100 text-rose-600 ring-2 ring-rose-400 animate-pulse"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        } disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </button>
      {error && (
        <span role="alert" className="absolute bottom-full right-0 mb-2 w-56 rounded-lg bg-rose-950 px-2.5 py-2 text-[11px] text-rose-100 shadow-lg">
          {error}
        </span>
      )}
    </span>
  );
}
