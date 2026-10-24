"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff, X } from "lucide-react";

export type ProsodyMarker = "question" | "emphasis" | "statement";

export interface SpeechPacingCallbacks {
  onBackchannel?: () => void;
  onProsodyMarker?: (marker: ProsodyMarker, clause: string) => void;
  onClausePause?: (milliseconds: number) => void;
}

export interface SpeechPacingOptions {
  backchannelThresholdMs?: number;
  clausePauseMs?: number;
}

const wait = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timeout = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => window.clearTimeout(timeout), { once: true });
  });

/** Emits pacing cues for a speech segment without coupling consumers to a voice provider. */
export async function paceSpeechSegment(
  text: string,
  silenceBeforeMs: number,
  callbacks: SpeechPacingCallbacks,
  options: SpeechPacingOptions = {},
  signal?: AbortSignal,
): Promise<void> {
  const backchannelThresholdMs = options.backchannelThresholdMs ?? 400;
  const clausePauseMs = options.clausePauseMs ?? 220;
  if (silenceBeforeMs > backchannelThresholdMs && !signal?.aborted) callbacks.onBackchannel?.();

  const clauses = text.match(/[^.!?]+[.!?]?/g) ?? [];
  for (const rawClause of clauses) {
    if (signal?.aborted) return;
    const clause = rawClause.trim();
    if (!clause) continue;
    const marker: ProsodyMarker = clause.endsWith("?")
      ? "question"
      : /[!]/.test(clause)
        ? "emphasis"
        : "statement";
    callbacks.onProsodyMarker?.(marker, clause);
    if (/[.!?]$/.test(clause)) {
      callbacks.onClausePause?.(clausePauseMs);
      await wait(clausePauseMs, signal);
    }
  }
}

export function cancelSpeechOnBargeIn(synthesis?: SpeechSynthesis): void {
  const target = synthesis ?? (typeof window !== "undefined" ? window.speechSynthesis : undefined);
  target?.cancel();
}

export interface LiveAgentCallDockProps extends SpeechPacingCallbacks {
  audioEnabled: boolean;
  videoEnabled: boolean;
  activeSpeakerName: string;
  activeSpeakerStatus: string;
  liveAiLabel?: string;
  liveAiStatus?: string;
  liveAiContent?: string;
  cameraStream?: MediaStream | null;
  speechText?: string;
  silenceBeforeSpeechMs?: number;
  bargeInToken?: number;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onScreenShareChange?: (stream: MediaStream | null) => void;
  onBargeIn?: () => void;
  onBackchannel?: () => void;
  onProsodyMarker?: (marker: ProsodyMarker, clause: string) => void;
  onClausePause?: (milliseconds: number) => void;
  onEndCall?: () => void;
}

export default function LiveAgentCallDock(props: LiveAgentCallDockProps) {
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [screenError, setScreenError] = useState("");
  const [wakeLockNotice, setWakeLockNotice] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const pacingAbortRef = useRef<AbortController | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenShareCallbackRef = useRef(props.onScreenShareChange);

  useEffect(() => {
    screenStreamRef.current = screenStream;
  }, [screenStream]);

  useEffect(() => {
    screenShareCallbackRef.current = props.onScreenShareChange;
  }, [props.onScreenShareChange]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = props.cameraStream ?? null;
  }, [props.cameraStream]);

  useEffect(() => {
    let active = true;
    let sentinel: WakeLockSentinel | undefined;
    const wakeLock = navigator.wakeLock;
    if (!wakeLock) return;
    void wakeLock.request("screen").then((requested) => {
      if (active) sentinel = requested;
      else void requested.release();
    }).catch(() => {
      if (active) setWakeLockNotice("Keep the device awake for uninterrupted pocket audio.");
    });
    return () => {
      active = false;
      if (sentinel) void sentinel.release();
    };
  }, []);

  useEffect(() => () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenShareCallbackRef.current?.(null);
    }
    pacingAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (props.speechText === undefined) return;
    pacingAbortRef.current?.abort();
    const controller = new AbortController();
    pacingAbortRef.current = controller;
    void paceSpeechSegment(
      props.speechText,
      props.silenceBeforeSpeechMs ?? 0,
      {
        onBackchannel: props.onBackchannel,
        onProsodyMarker: props.onProsodyMarker,
        onClausePause: props.onClausePause,
      },
      {},
      controller.signal,
    );
    return () => controller.abort();
  }, [
    props.silenceBeforeSpeechMs,
    props.speechText,
    props.onBackchannel,
    props.onClausePause,
    props.onProsodyMarker,
  ]);

  useEffect(() => {
    if (props.bargeInToken === undefined) return;
    cancelSpeechOnBargeIn();
    pacingAbortRef.current?.abort();
  }, [props.bargeInToken]);

  const toggleScreenShare = async () => {
    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());
      setScreenStream(null);
      props.onScreenShareChange?.(null);
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setScreenError("Screen sharing is not available in this browser.");
      return;
    }
    try {
      setScreenError("");
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          setScreenStream(null);
          props.onScreenShareChange?.(null);
        }, { once: true });
      });
      setScreenStream(stream);
      props.onScreenShareChange?.(stream);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "NotAllowedError") {
        setScreenError("Screen sharing was cancelled or denied.");
      } else {
        setScreenError("Could not start screen sharing.");
      }
    }
  };

  const interruptAi = () => {
    cancelSpeechOnBargeIn();
    pacingAbortRef.current?.abort();
    props.onBargeIn?.();
  };

  return (
    <section aria-label="Live call controls" className="live-agent-call-dock">
      <div className="live-agent-call-dock-tiles">
        <article aria-label={`Active speaker: ${props.activeSpeakerName}`} className="live-agent-call-dock-speaker">
          <video autoPlay className="live-agent-call-dock-camera" muted playsInline ref={videoRef} />
          {!props.videoEnabled && <span className="live-agent-call-dock-camera-off">Camera off</span>}
          <div className="live-agent-call-dock-tile-caption">
            <strong>{props.activeSpeakerName}</strong>
            <span role="status">{props.activeSpeakerStatus}</span>
          </div>
        </article>
        <article aria-label={`${props.liveAiLabel ?? "AI assistant"}: ${props.liveAiStatus ?? "Live"}`} className="live-agent-call-dock-ai">
          <span aria-hidden="true" className="live-agent-call-dock-ai-indicator" />
          <strong>{props.liveAiLabel ?? "Live AI"}</strong>
          <span role="status">{props.liveAiStatus ?? "Listening"}</span>
          {props.liveAiContent && <p>{props.liveAiContent}</p>}
        </article>
        {screenStream && (
          <article aria-label="Screen share is active" className="live-agent-call-dock-share">
            <MonitorUp aria-hidden="true" size={22} />
            <span>Screen sharing</span>
          </article>
        )}
      </div>

      {screenError && <p className="live-agent-call-dock-error" role="alert">{screenError}</p>}
      {wakeLockNotice && <p className="live-agent-call-dock-error" role="status">{wakeLockNotice}</p>}
      <div aria-label="Call actions" className="live-agent-call-dock-actions" role="group">
        <button aria-pressed={!props.audioEnabled} className="live-agent-call-dock-control" onClick={props.onToggleAudio} type="button">
          {props.audioEnabled ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
          {props.audioEnabled ? "Mute" : "Unmute"}
        </button>
        <button aria-pressed={!props.videoEnabled} className="live-agent-call-dock-control" onClick={props.onToggleVideo} type="button">
          {props.videoEnabled ? <Video aria-hidden="true" /> : <VideoOff aria-hidden="true" />}
          {props.videoEnabled ? "Turn camera off" : "Turn camera on"}
        </button>
        <button aria-pressed={Boolean(screenStream)} className="live-agent-call-dock-control" onClick={() => void toggleScreenShare()} type="button">
          {screenStream ? <X aria-hidden="true" /> : <MonitorUp aria-hidden="true" />}
          {screenStream ? "Stop sharing" : "Share screen"}
        </button>
        <button className="live-agent-call-dock-control" onClick={interruptAi} type="button">Interrupt AI</button>
        {props.onEndCall && (
          <button className="live-agent-call-dock-end" onClick={props.onEndCall} type="button">
            <PhoneOff aria-hidden="true" /> End call
          </button>
        )}
      </div>
    </section>
  );
}
