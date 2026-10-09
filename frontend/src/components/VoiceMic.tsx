"use client";

import { Mic, MicOff } from "lucide-react";
import { PointerEvent, useEffect, useRef, useState } from "react";

interface VoiceMicProps {
  backendUrl: string;
  disabled?: boolean;
  onRecordingChange?: (recording: boolean) => void;
  onTranscription: (text: string) => void;
}

export default function VoiceMic({
  backendUrl,
  disabled = false,
  onRecordingChange,
  onTranscription,
}: VoiceMicProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startingRef = useRef(false);
  const suppressTouchClickRef = useRef(false);
  const touchHoldRef = useRef(false);
  const touchModeRef = useRef(false);

  useEffect(
    () => () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  async function startRecording() {
    if (startingRef.current || recorderRef.current || disabled) return;
    startingRef.current = true;
    setError("");
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
    } finally {
      startingRef.current = false;
    }
  }

  function stopRecording() {
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
      const response = await fetch(`${backendUrl}/api/voice/transcribe`, {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as { text?: string; detail?: string };
      if (!response.ok) {
        throw new Error(result.detail || `Transcription failed (HTTP ${response.status}).`);
      }
      if (!result.text?.trim()) throw new Error("No speech was detected.");
      onTranscription(result.text.trim());
    } catch (transcriptionError) {
      setError(
        transcriptionError instanceof Error
          ? transcriptionError.message
          : "Voice transcription failed.",
      );
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
