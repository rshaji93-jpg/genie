"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, PhoneOff, Radio } from "lucide-react";
import { INDIAN_DIALECT_MAP } from "./voiceAudio";

interface SpeechRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResult>;
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
  abort(): void;
}

interface BrowserSpeechRecognitionWindow extends Window {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
}

export interface VoiceCallTurn {
  id: string;
  callId?: string;
  userId: string;
  userName: string;
  userAvatar: string | null;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

export interface VoiceCallTranscript {
  callId: string;
  durationSeconds: number;
  dialect: string;
  participants: Array<{ id: string; name: string; avatarUrl: string | null }>;
  turns: VoiceCallTurn[];
}

interface VoiceCallModalProps {
  callId: string;
  isTeamMode: boolean;
  contextMode: "personal" | "workspace";
  participants: Array<{ id: string; name: string; avatarUrl?: string }>;
  currentUser: { id: string; name: string; avatarUrl?: string };
  remoteTurns: VoiceCallTurn[];
  languageCode: string;
  languageLabel: string;
  onSubmitTurn: (transcript: string) => Promise<{
    text: string;
    audioData?: string;
  } | null>;
  onBroadcastTurn: (turn: VoiceCallTurn, callId: string) => Promise<void>;
  onEndCall: (transcript: VoiceCallTranscript) => void;
}

type CallPhase = "listening" | "thinking" | "speaking";

export default function VoiceCallModal({
  languageCode,
  languageLabel,
  callId,
  isTeamMode,
  contextMode,
  participants,
  currentUser,
  remoteTurns,
  onSubmitTurn,
  onBroadcastTurn,
  onEndCall,
}: VoiceCallModalProps) {
  const [muted, setMuted] = useState(false);
  const [phase, setPhase] = useState<CallPhase>("listening");
  const [error, setError] = useState<string | null>(null);
  const [latestTranscript, setLatestTranscript] = useState("");
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const callStartedAtRef = useRef(0);
  const turnsRef = useRef<VoiceCallTurn[]>([]);
  const phaseRef = useRef(phase);
  const mutedRef = useRef(muted);
  const onSubmitTurnRef = useRef(onSubmitTurn);
  const onBroadcastTurnRef = useRef(onBroadcastTurn);
  const currentUserRef = useRef(currentUser);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeAssistantTurnIdRef = useRef<string | null>(null);
  const speechStartedAtRef = useRef(0);
  const finishPlaybackRef = useRef<(() => void) | null>(null);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const speechWindow =
    typeof window === "undefined" ? null : (window as BrowserSpeechRecognitionWindow);
  const recognitionSupported = Boolean(
    speechWindow?.webkitSpeechRecognition || speechWindow?.SpeechRecognition,
  );

  useEffect(() => {
    phaseRef.current = phase;
    mutedRef.current = muted;
    onSubmitTurnRef.current = onSubmitTurn;
    onBroadcastTurnRef.current = onBroadcastTurn;
    currentUserRef.current = currentUser;
  }, [currentUser, muted, onBroadcastTurn, onSubmitTurn, phase]);

  useEffect(() => {
    callStartedAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    const knownIds = new Set(turnsRef.current.map((turn) => turn.id));
    const unseen = remoteTurns.filter((turn) =>
      turn.callId === callId && turn.id && !knownIds.has(turn.id),
    );
    if (!unseen.length) return;
    const updated = [...turnsRef.current, ...unseen].sort((left, right) =>
      left.timestamp.localeCompare(right.timestamp),
    );
    turnsRef.current = updated;
    const latest = unseen[unseen.length - 1];
    setActiveSpeakerId(latest.userId);
    if (latest.role === "assistant") {
      phaseRef.current = "speaking";
      setPhase("speaking");
      window.setTimeout(() => {
        if (!mountedRef.current || processingRef.current) return;
        phaseRef.current = "listening";
        setPhase("listening");
      }, 2000);
    }
  }, [callId, remoteTurns]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      recognitionRef.current?.abort();
      activeAudioRef.current?.pause();
      if (activeAudioRef.current) activeAudioRef.current.currentTime = 0;
      finishPlaybackRef.current?.();
      activeAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (muted || phase !== "listening") return;
    const browserWindow = window as BrowserSpeechRecognitionWindow;
    const Recognition =
      browserWindow.webkitSpeechRecognition || browserWindow.SpeechRecognition;
    if (!Recognition) return;

    let cancelled = false;
    let restartTimer: number | undefined;
    const startRecognition = () => {
      if (cancelled || mutedRef.current || phaseRef.current !== "listening") return;
      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang =
        INDIAN_DIALECT_MAP[languageLabel] ||
        INDIAN_DIALECT_MAP[languageCode] ||
        "en-IN";
      recognition.onresult = (event) => {
        const finalParts: string[] = [];
        const interimParts: string[] = [];
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result[0].transcript.trim();
          if (!transcript) continue;
          (result.isFinal ? finalParts : interimParts).push(transcript);
        }
        if (interimParts.length) setLatestTranscript(interimParts.join(" "));
        if (!finalParts.length || processingRef.current) return;

        const transcript = finalParts.join(" ").trim();
        recognitionRef.current?.abort();
        recognitionRef.current = null;
        setLatestTranscript(transcript);
        const spokenTurn: VoiceCallTurn = {
          id: window.crypto.randomUUID(),
          callId,
          userId: currentUserRef.current.id,
          userName: currentUserRef.current.name || "Guest User",
          userAvatar: currentUserRef.current.avatarUrl || null,
          role: "user",
          text: transcript,
          timestamp: new Date().toISOString(),
        };
        turnsRef.current = [...turnsRef.current, spokenTurn];
        setActiveSpeakerId(spokenTurn.userId);
        if (isTeamMode) {
          void onBroadcastTurnRef.current(spokenTurn, callId).catch((broadcastError: unknown) => {
            console.error("Voice turn broadcast failed:", broadcastError);
            if (mountedRef.current) setError("Your voice turn could not be shared with the room.");
          });
        }
        processingRef.current = true;
        phaseRef.current = "thinking";
        setPhase("thinking");
        void (async () => {
          try {
            const turnResult = await onSubmitTurnRef.current(transcript);
            if (!mountedRef.current) return;
            if (!turnResult?.text.trim()) {
              setError("Genie could not respond to that voice turn. You can try again.");
              processingRef.current = false;
              phaseRef.current = "listening";
              setPhase("listening");
              return;
            }
            if (!turnResult.audioData) {
              throw new Error("The server did not return synthesized voice audio.");
            }
            const assistantTurn: VoiceCallTurn = {
              id: window.crypto.randomUUID(),
              callId,
              userId: "genie-master",
              userName: "Genie Master",
              userAvatar: null,
              role: "assistant",
              text: turnResult.text.trim(),
              timestamp: new Date().toISOString(),
            };
            turnsRef.current = [...turnsRef.current, assistantTurn];
            activeAssistantTurnIdRef.current = assistantTurn.id;
            setActiveSpeakerId(assistantTurn.userId);
            if (isTeamMode) {
              void onBroadcastTurnRef.current(assistantTurn, callId).catch((broadcastError: unknown) => {
                console.error("Genie Master voice response broadcast failed:", broadcastError);
                if (mountedRef.current) setError("Genie Master's response could not be shared with the room.");
              });
            }
            phaseRef.current = "speaking";
            speechStartedAtRef.current = Date.now();
            setPhase("speaking");
            const audio = new Audio(`data:audio/mp3;base64,${turnResult.audioData}`);
            activeAudioRef.current = audio;
            await new Promise<void>((resolve, reject) => {
              const finish = () => {
                if (finishPlaybackRef.current === finish) finishPlaybackRef.current = null;
                if (activeAudioRef.current === audio) activeAudioRef.current = null;
                if (mountedRef.current) {
                  processingRef.current = false;
                  phaseRef.current = "listening";
                  setPhase("listening");
                }
                resolve();
              };
              finishPlaybackRef.current = finish;
              audio.addEventListener("ended", finish, { once: true });
              audio.addEventListener("error", () => {
                finish();
                reject(new Error("Server-generated voice audio could not be played."));
              }, { once: true });
              void audio.play().catch((playError) => {
                finish();
                reject(playError);
              });
            });
          } catch (turnError) {
            if (!mountedRef.current) return;
            console.error("Voice call turn failed:", turnError);
            setError(turnError instanceof Error ? turnError.message : "Voice call turn failed.");
            processingRef.current = false;
            phaseRef.current = "listening";
            setPhase("listening");
          }
        })();
      };
      recognition.onerror = (event) => {
        if (event.error === "aborted" || event.error === "no-speech") return;
        setError(
          event.error === "not-allowed" || event.error === "service-not-allowed"
            ? "Microphone permission was denied. Allow microphone access to use Call Genie."
            : "Speech recognition failed. Unmute or restart the call to try again.",
        );
        mutedRef.current = true;
        setMuted(true);
      };
      recognition.onend = () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        if (!cancelled && !mutedRef.current && phaseRef.current === "listening") {
          restartTimer = window.setTimeout(startRecognition, 250);
        }
      };
      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch (recognitionError) {
        recognitionRef.current = null;
        cancelled = true;
        setError(
          recognitionError instanceof Error
            ? recognitionError.message
            : "Speech recognition could not start.",
        );
        mutedRef.current = true;
        setMuted(true);
      }
    };

    startRecognition();
    return () => {
      cancelled = true;
      if (restartTimer !== undefined) window.clearTimeout(restartTimer);
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
      }
    };
  }, [callId, isTeamMode, languageCode, languageLabel, muted, phase]);

  function interruptGenie() {
    if (phaseRef.current !== "speaking") return;
    const assistantTurnId = activeAssistantTurnIdRef.current;
    const audio = activeAudioRef.current;
    if (assistantTurnId) {
      const turnIndex = turnsRef.current.findIndex((turn) => turn.id === assistantTurnId);
      if (turnIndex >= 0) {
        if (contextMode === "personal") {
          turnsRef.current = turnsRef.current.filter((turn) => turn.id !== assistantTurnId);
        } else {
          const turn = turnsRef.current[turnIndex];
          const elapsed = Math.max(0, Date.now() - speechStartedAtRef.current);
          const estimatedDuration = Math.max(1200, (turn.text.trim().split(/\s+/).length / 150) * 60_000);
          const progress = audio && Number.isFinite(audio.duration) && audio.duration > 0
            ? Math.min(1, audio.currentTime / audio.duration)
            : Math.min(1, elapsed / estimatedDuration);
          const cutoff = Math.max(0, Math.floor(turn.text.length * progress));
          const truncated = turn.text.slice(0, cutoff).replace(/\s+\S*$/, "").trim();
          turnsRef.current = turnsRef.current.map((item) =>
            item.id === assistantTurnId
              ? { ...item, text: `${truncated}${truncated ? " " : ""}[Interrupted by user]` }
              : item,
          );
        }
      }
    }

    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.currentTime = 0;
    }
    finishPlaybackRef.current?.();

    activeAssistantTurnIdRef.current = null;
    processingRef.current = false;
    phaseRef.current = "listening";
    setActiveSpeakerId(currentUserRef.current.id);
    setPhase("listening");
  }

  function toggleMute() {
    const nextMuted = !muted;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
    setError(null);
  }

  const statusText = muted
    ? "Microphone muted"
    : phase === "thinking"
      ? "Genie Master is thinking..."
      : phase === "speaking"
        ? "Genie Master is speaking..."
        : "Listening to your voice...";

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-call-title"
    >
      <div className="relative flex min-h-[min(680px,90vh)] w-full max-w-xl flex-col items-center justify-between overflow-hidden rounded-[2rem] border border-indigo-200/20 bg-gradient-to-b from-slate-900 via-indigo-950 to-slate-950 px-6 py-8 text-white shadow-2xl sm:px-12">
        <div className="absolute inset-x-0 top-0 h-40 bg-indigo-500/10 blur-3xl" aria-hidden="true" />
        <div className="relative z-10 text-center">
          <div className="mb-2 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-200">
            <Radio className="h-4 w-4" />
            ((•)) LIVE VOICE CALL
          </div>
          <h2 id="voice-call-title" className="text-2xl font-bold tracking-tight">Genie Master</h2>
          <p className="mt-2 text-sm text-indigo-100/75">Dialect: {languageLabel}</p>
          {isTeamMode && (
            <div className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Room participants">
              {participants.map((participant) => (
                <div
                  key={participant.id}
                  className={`flex items-center gap-2 rounded-full border px-2.5 py-1 transition-colors ${
                    activeSpeakerId === participant.id
                      ? "border-indigo-300 bg-indigo-400/20"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  <Image
                    src={participant.avatarUrl || "/default-avatar.png"}
                    alt=""
                    width={24}
                    height={24}
                    unoptimized
                    className="h-6 w-6 rounded-full object-cover"
                  />
                  <span className="text-[11px] font-medium">{participant.name}</span>
                </div>
              ))}
              <div className={`flex items-center gap-2 rounded-full border px-2.5 py-1 ${
                activeSpeakerId === "genie-master"
                  ? "border-violet-300 bg-violet-400/20"
                  : "border-white/10 bg-white/5"
              }`}>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500 text-[10px] font-bold">G</span>
                <span className="text-[11px] font-medium">Genie Master</span>
              </div>
            </div>
          )}
        </div>

        <div className="relative flex flex-col items-center justify-center py-10">
          <div
            className={`absolute h-56 w-56 rounded-full border border-indigo-300/20 ${
              !muted && phase === "listening" ? "animate-ping [animation-duration:2.4s]" : ""
            }`}
            aria-hidden="true"
          />
          <div
            className={`absolute h-44 w-44 rounded-full border border-violet-300/20 ${
              !muted && phase !== "thinking" ? "animate-pulse" : ""
            }`}
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={phase === "speaking" ? interruptGenie : undefined}
            disabled={phase !== "speaking"}
            aria-label={phase === "speaking" ? "Stop and interrupt Genie Master" : "Genie Master call status"}
            title={phase === "speaking" ? "Stop & Rephrase / Interrupt" : statusText}
            className={`relative flex h-32 w-32 items-center justify-center rounded-full border border-indigo-200/40 bg-gradient-to-br from-indigo-400 via-violet-600 to-indigo-800 shadow-[0_0_80px_rgba(99,102,241,0.45)] ${
              phase === "speaking" ? "scale-105" : ""
            } transition-transform duration-500`}
          >
            {phase === "thinking" ? (
              <Loader2 className="h-10 w-10 animate-spin text-white" />
            ) : phase === "speaking" ? (
              <span className="flex h-10 items-center gap-1" aria-label="Genie speaking">
                {[0, 1, 2, 3, 4].map((bar) => (
                  <span
                    key={bar}
                    className="w-1.5 animate-pulse rounded-full bg-white"
                    style={{ height: `${14 + (bar % 3) * 9}px`, animationDelay: `${bar * 90}ms` }}
                  />
                ))}
              </span>
            ) : (
              <Mic className={`h-10 w-10 ${muted ? "opacity-40" : "text-white"}`} />
            )}
          </button>
          {phase === "speaking" && (
            <button
              type="button"
              onClick={interruptGenie}
              className="absolute top-[calc(100%+1.25rem)] rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20"
            >
              Stop &amp; Rephrase / Interrupt
            </button>
          )}
          <p className="mt-8 text-lg font-semibold" aria-live="polite">
            {isTeamMode && phase === "listening" && activeSpeakerId && activeSpeakerId !== "genie-master"
              ? `${participants.find((participant) => participant.id === activeSpeakerId)?.name || currentUser.name} is speaking...`
              : statusText}
          </p>
          {latestTranscript && (
            <p className="mt-3 max-w-md text-center text-sm text-indigo-100/70">
              “{latestTranscript}”
            </p>
          )}
          {(error || !recognitionSupported) && (
            <p role="alert" className="mt-3 max-w-md text-center text-sm text-rose-300">
              {error || "Live speech recognition is not supported in this browser."}
            </p>
          )}
        </div>

        <div className="relative z-10 flex w-full items-center justify-center gap-4">
          <button
            type="button"
            onClick={toggleMute}
            className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold transition-colors hover:bg-white/15"
          >
            {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {muted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            onClick={() => {
              recognitionRef.current?.abort();
              activeAudioRef.current?.pause();
              if (activeAudioRef.current) activeAudioRef.current.currentTime = 0;
              const durationSeconds = Math.max(
                0,
                Math.round((Date.now() - callStartedAtRef.current) / 1000),
              );
              onEndCall({
                callId,
                durationSeconds,
                dialect: languageLabel,
                participants: participants.map((participant) => ({
                  id: participant.id,
                  name: participant.name,
                  avatarUrl: participant.avatarUrl || null,
                })),
                turns: turnsRef.current,
              });
            }}
            className="flex items-center gap-2 rounded-full bg-rose-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-rose-950/30 transition-colors hover:bg-rose-500"
          >
            <PhoneOff className="h-4 w-4" />
            End Call
          </button>
        </div>
      </div>
    </div>
  );
}
