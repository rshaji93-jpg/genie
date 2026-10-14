"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  PhoneOff,
  Volume2,
  VolumeX,
  UserPlus,
  Copy,
  Sparkles,
  Users,
} from "lucide-react";

export interface VoiceCallTurn {
  id: string;
  callId?: string;
  userId: string;
  userName: string;
  userAvatar?: string | null;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

export interface VoiceCallTranscript {
  callId: string;
  durationSeconds: number;
  dialect: string;
  participants: Array<{ id: string; name: string; avatarUrl?: string }>;
  turns: VoiceCallTurn[];
}

export interface VoiceCallModalProps {
  callId: string;
  isTeamMode: boolean;
  contextMode: "personal" | "workspace";
  isObserverActive?: boolean;
  onToggleObserver?: () => void;
  brandLogoSrc?: string;
  participants: Array<{ id: string; name: string; avatarUrl?: string }>;
  currentUser: { id: string; name: string; avatarUrl?: string };
  remoteTurns: VoiceCallTurn[];
  rtcTransport?: "ai" | "mesh";
  rtcEvents?: Array<Record<string, any>>;
  onRtcSignal?: (event: Record<string, unknown>) => boolean;
  languageCode: string;
  languageLabel: string;
  isRoomOriginHost?: boolean;
  selectedVoice: string;
  onVoiceChange: (voiceName: string) => void;
  shouldSubmitTurn?: (transcript: string) => boolean;
  onCopyInvite: () => void;
  onPingFriend: () => void;
  onLanguageChange: (languageCode: string) => void;
  onSubmitTurn: (transcript: string) => Promise<{
    text: string;
    audioData?: string;
    audioMimeType?: string;
  } | null>;
  onBroadcastTurn?: (turn: VoiceCallTurn, callId: string) => Promise<void>;
  onEndCall: (transcript: VoiceCallTranscript) => void;
}

const VOICE_OPTIONS = ["Aoede", "Charon", "Kore", "Fenrir", "Puck"];

export default function VoiceCallModal({
  callId,
  isTeamMode,
  isObserverActive = false,
  onToggleObserver,
  brandLogoSrc = "/avatars/Fixed-brand-Icon.png",
  participants,
  currentUser,
  remoteTurns,
  rtcTransport = "ai",
  languageCode,
  languageLabel,
  selectedVoice,
  onVoiceChange,
  onCopyInvite,
  onPingFriend,
  onSubmitTurn,
  onBroadcastTurn,
  onEndCall,
}: VoiceCallModalProps) {
  const [turns, setTurns] = useState<VoiceCallTurn[]>([]);
  const [spokenInput, setSpokenInput] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const turnsEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDurationSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!remoteTurns.length) return;
    setTurns((prev) => {
      const existing = new Set(prev.map((t) => t.id));
      const incoming = remoteTurns.filter((t) => !existing.has(t.id));
      return incoming.length ? [...prev, ...incoming] : prev;
    });
  }, [remoteTurns]);

  useEffect(() => {
    turnsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  async function handleSendSpokenTurn(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const text = spokenInput.trim();
    if (!text || isBusy) return;
    setSpokenInput("");

    const userTurn: VoiceCallTurn = {
      id: window.crypto.randomUUID(),
      callId,
      userId: currentUser.id,
      userName: currentUser.name,
      userAvatar: currentUser.avatarUrl || null,
      role: "user",
      text,
      timestamp: new Date().toISOString(),
    };
    setTurns((prev) => [...prev, userTurn]);
    if (onBroadcastTurn) {
      await onBroadcastTurn(userTurn, callId).catch(() => undefined);
    }

    const wakesAi = isObserverActive || rtcTransport === "ai" || /\bgenie\b/i.test(text);
    if (!wakesAi) return;

    setIsBusy(true);
    try {
      const reply = await onSubmitTurn(text);
      if (reply?.text) {
        const aiTurn: VoiceCallTurn = {
          id: window.crypto.randomUUID(),
          callId,
          userId: "genie-master",
          userName: isObserverActive ? "Genie Master" : "Genie Pro",
          userAvatar: brandLogoSrc,
          role: "assistant",
          text: reply.text,
          timestamp: new Date().toISOString(),
        };
        setTurns((prev) => [...prev, aiTurn]);
        if (onBroadcastTurn) {
          await onBroadcastTurn(aiTurn, callId).catch(() => undefined);
        }
        if (!speakerMuted && reply.audioData) {
          const mime = reply.audioMimeType || "audio/mpeg";
          const audio = new Audio(`data:${mime};base64,${reply.audioData}`);
          audioRef.current = audio;
          void audio.play().catch(() => undefined);
        } else if (!speakerMuted && typeof window !== "undefined" && "speechSynthesis" in window) {
          const utter = new SpeechSynthesisUtterance(reply.text);
          utter.lang = languageCode;
          window.speechSynthesis.speak(utter);
        }
      }
    } finally {
      setIsBusy(false);
    }
  }

  function finishCall() {
    audioRef.current?.pause();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    onEndCall({
      callId,
      durationSeconds,
      dialect: languageLabel,
      participants: participants.length ? participants : [currentUser],
      turns,
    });
  }

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/85 p-3 sm:p-6 backdrop-blur-md">
      <div className="relative flex h-[min(90vh,48rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 text-white shadow-2xl">
        {/* Exact Call Log UI Layout matching video specifications */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-10">
          <img
            src={brandLogoSrc}
            alt="Personal AI Genie Watermark"
            className="h-80 w-80 rounded-full object-contain"
          />
        </div>

        {/* Top Header inside Call Modal */}
        <div className="relative z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/70 px-6 py-4">
          <div className="text-center flex-1">
            <h2 className="text-base font-extrabold tracking-wide text-white">Call Genie</h2>
            <p className="text-xs text-slate-400 mt-0.5">Voice active · {formatTime(durationSeconds)}</p>
          </div>
          <div className="absolute right-4 flex items-center gap-2">
            {onToggleObserver && (
              <button
                type="button"
                onClick={onToggleObserver}
                className={`rounded-full px-3 py-1 text-xs font-bold transition-all ${
                  isObserverActive
                    ? "bg-emerald-600/30 border border-emerald-400 text-emerald-300"
                    : "bg-slate-800 border border-slate-700 text-slate-400 hover:text-white"
                }`}
              >
                {isObserverActive ? "AI Observer ON" : "AI Observer OFF"}
              </button>
            )}
          </div>
        </div>

        {/* Center Glowing Mic & Listening State (matching video layout) */}
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
          <div className="relative mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-cyan-600/20 shadow-[0_0_50px_rgba(6,182,212,0.35)] ring-4 ring-cyan-500/30">
            <div className="absolute inset-0 animate-ping rounded-full bg-cyan-500/10" />
            <Mic className="h-12 w-12 text-cyan-400 animate-pulse" />
          </div>

          <h3 className="text-lg font-bold text-slate-100">Listening to your voice...</h3>
          <p className="mt-2 max-w-sm text-xs leading-relaxed text-slate-400">
            Speak naturally to your AI assistant. Genie processes your speech in real time with low latency.
          </p>

          {/* Transcript Preview Box */}
          <div className="mt-6 max-h-36 w-full max-w-md overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/80 p-3 text-left text-xs text-slate-300 shadow-inner">
            {turns.length === 0 ? (
              <p className="italic text-slate-500 text-center">Your conversation transcript will appear here...</p>
            ) : (
              turns.map((t) => (
                <div key={t.id} className="mb-2">
                  <span className="font-bold text-cyan-400">{t.userName}: </span>
                  <span>{t.text}</span>
                </div>
              ))
            )}
            <div ref={turnsEndRef} />
          </div>
        </div>

        {/* Bottom Call Controls (Mute & End Call matching video) */}
        <div className="relative z-10 border-t border-slate-800 bg-slate-950/90 p-4 sm:p-5">
          <form onSubmit={(e) => void handleSendSpokenTurn(e)} className="mb-3 flex gap-2">
            <input
              type="text"
              value={spokenInput}
              onChange={(e) => setSpokenInput(e.target.value)}
              disabled={isMuted || isBusy}
              placeholder="Or type a spoken turn here..."
              className="flex-1 rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              disabled={!spokenInput.trim() || isMuted || isBusy}
              className="rounded-full bg-cyan-600 px-4 py-2 text-xs font-bold text-white hover:bg-cyan-500 disabled:opacity-40"
            >
              Send
            </button>
          </form>

          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setIsMuted((m) => !m)}
              className={`flex items-center gap-2 rounded-full px-6 py-3 text-xs font-bold transition-all shadow-md ${
                isMuted
                  ? "bg-amber-600 text-white"
                  : "bg-slate-800 text-slate-200 hover:bg-slate-700"
              }`}
            >
              {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              <span>{isMuted ? "Unmute" : "Mute"}</span>
            </button>

            <button
              type="button"
              onClick={finishCall}
              className="flex items-center gap-2 rounded-full bg-rose-600 px-7 py-3 text-xs font-bold text-white shadow-lg transition-all hover:bg-rose-700"
            >
              <PhoneOff className="h-4 w-4" />
              <span>End Call</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
