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
  Globe,
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

    // If in Friends P2P mesh call and AI Observer is OFF, do not invoke Genie AI unless @Genie is spoken
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
      <div className="relative flex h-[min(88vh,46rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 text-white shadow-2xl">
        {/* Branded App Logo Watermark in Call Background */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-10">
          <img
            src={brandLogoSrc}
            alt="Personal AI Genie Trademark Logo"
            className="h-72 w-72 rounded-full object-contain"
          />
        </div>

        {/* Top Call Bar */}
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/60 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <img
              src={brandLogoSrc}
              alt="Personal AI Genie"
              className="h-9 w-9 rounded-full border border-cyan-500/40 object-cover"
            />
            <div>
              <h2 className="text-sm font-extrabold tracking-tight text-white">
                {isObserverActive
                  ? "Call Genie · AI Agent Active (Token Pool)"
                  : isTeamMode
                  ? "Friends Peer-to-Peer Call"
                  : "Personal AI Genie Voice Session"}
              </h2>
              <p className="text-[11px] text-slate-400">
                {formatTime(durationSeconds)} · {languageLabel} · Voice: {selectedVoice}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Include / Toggle AI Agent inside Start Call or Group Call */}
            {onToggleObserver && (
              <button
                type="button"
                onClick={onToggleObserver}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-all ${
                  isObserverActive
                    ? "border-emerald-400 bg-emerald-500/20 text-emerald-300 shadow-sm"
                    : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
                title="Include or mute the AI Agent in this call"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{isObserverActive ? "AI Agent ON (Call Genie)" : "Include AI Agent"}</span>
              </button>
            )}

            <select
              value={selectedVoice}
              onChange={(e) => onVoiceChange(e.target.value)}
              aria-label="Select AI Voice Persona"
              className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 outline-none"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  Voice: {v}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={onPingFriend}
              className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Add Friend</span>
            </button>

            <button
              type="button"
              onClick={onCopyInvite}
              className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Invite Link</span>
            </button>
          </div>
        </div>

        {/* Active Participants Strip */}
        <div className="relative z-10 flex flex-wrap items-center gap-2 border-b border-slate-800/80 bg-slate-900/70 px-5 py-2.5 text-xs">
          <span className="inline-flex items-center gap-1 font-bold text-slate-400">
            <Users className="h-3.5 w-3.5" /> In Call:
          </span>
          {(participants.length ? participants : [currentUser]).map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/90 px-2.5 py-1 text-[11px] font-semibold text-slate-200"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              {p.name}
            </span>
          ))}
        </div>

        {/* Live Prompting / Transcript Stream inside Call Box */}
        <div className="relative z-10 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {turns.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
              <p className="text-sm font-semibold text-slate-200">
                Live Voice &amp; Prompting Stream Ready
              </p>
              <p className="mt-1 max-w-md text-xs text-slate-400">
                {isObserverActive
                  ? "Call Genie is active. Speak or type below—responses are spoken aloud and transcribed live."
                  : "Friends Call active. Speak with your friends or click 'Include AI Agent' above to bring Genie into the call."}
              </p>
            </div>
          ) : (
            turns.map((turn) => (
              <div
                key={turn.id}
                className={`flex flex-col ${
                  turn.role === "assistant" ? "items-start" : "items-end"
                }`}
              >
                <span className="mb-1 px-1 text-[10px] font-bold text-slate-400">
                  {turn.userName} ·{" "}
                  {new Date(turn.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <div
                  className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                    turn.role === "assistant"
                      ? "border border-cyan-500/30 bg-cyan-950/60 text-cyan-100"
                      : "bg-sky-600 text-white"
                  }`}
                >
                  {turn.text}
                </div>
              </div>
            ))
          )}
          <div ref={turnsEndRef} />
        </div>

        {/* Bottom Spoken Turn Input + Call Controls */}
        <div className="relative z-10 border-t border-slate-800 bg-slate-950/80 p-4">
          <form onSubmit={(e) => void handleSendSpokenTurn(e)} className="mb-3 flex gap-2">
            <input
              type="text"
              value={spokenInput}
              onChange={(e) => setSpokenInput(e.target.value)}
              disabled={isMuted || isBusy}
              placeholder={
                isMuted
                  ? "Microphone is muted..."
                  : isObserverActive
                  ? "Speak or type to Genie Master in this call..."
                  : "Speak to friends in call (or type @Genie)..."
              }
              className="flex-1 rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              disabled={!spokenInput.trim() || isMuted || isBusy}
              className="rounded-full bg-cyan-600 px-4 py-2 text-xs font-bold text-white hover:bg-cyan-500 disabled:opacity-40"
            >
              {isBusy ? "Thinking..." : "Send Turn"}
            </button>
          </form>

          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setIsMuted((m) => !m)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition ${
                isMuted
                  ? "bg-amber-600 text-white"
                  : "bg-slate-800 text-slate-200 hover:bg-slate-700"
              }`}
            >
              {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              <span>{isMuted ? "Unmute Mic" : "Mute Mic"}</span>
            </button>

            <button
              type="button"
              onClick={() => setSpeakerMuted((s) => !s)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition ${
                speakerMuted
                  ? "bg-amber-600 text-white"
                  : "bg-slate-800 text-slate-200 hover:bg-slate-700"
              }`}
            >
              {speakerMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              <span>{speakerMuted ? "Speaker Off" : "Speaker On"}</span>
            </button>

            <button
              type="button"
              onClick={finishCall}
              className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-5 py-2 text-xs font-bold text-white shadow-lg hover:bg-rose-700"
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
