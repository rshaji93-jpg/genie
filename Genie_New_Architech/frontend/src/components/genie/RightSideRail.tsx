"use client";

import { AudioLines, Mic, PhoneCall, Settings2, ShieldCheck, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface RoomPerson {
  user_sub: string;
  user_name: string;
}

export interface CallSignal {
  from_sub: string;
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
}

interface RightSideRailProps {
  open: boolean;
  roomId?: string;
  mySub: string;
  members: RoomPerson[];
  onlineSubs: string[];
  incomingSignal?: CallSignal;
  onClose: () => void;
  onCallGenie: () => void;
  onSendVoiceNote: (dataUrl: string, durationSeconds: number) => void;
  onStageVoiceNote: (dataUrl: string, durationSeconds: number) => void;
  onTranscribeLive: () => void;
  onOpenSettings: () => void;
  onVoiceParticipantsChange: (userSubs: string[]) => void;
  onSendSignal: (toSub: string, payload: RTCSessionDescriptionInit | RTCIceCandidateInit) => void;
}

export default function RightSideRail(props: RightSideRailProps) {
  const [inCall, setInCall] = useState(false);
  const [recordingVoiceNote, setRecordingVoiceNote] = useState(false);
  const [pendingVoiceNote, setPendingVoiceNote] = useState<{ dataUrl: string; durationSeconds: number } | null>(null);
  const [callError, setCallError] = useState("");
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const localStream = useRef<MediaStream | null>(null);
  const peers = useRef<Map<string, RTCPeerConnection>>(new Map());
  const noteRecorder = useRef<MediaRecorder | null>(null);
  const noteStream = useRef<MediaStream | null>(null);
  const noteChunks = useRef<Blob[]>([]);
  const noteStartedAt = useRef(0);

  useEffect(() => {
    props.onVoiceParticipantsChange(Object.keys(remoteStreams));
  }, [remoteStreams, props.onVoiceParticipantsChange]);

  function getPeer(userSub: string): RTCPeerConnection {
    const existing = peers.current.get(userSub);
    if (existing) return existing;
    const turnUrl = process.env.NEXT_PUBLIC_GENIE_TURN_URL;
    const turnUsername = process.env.NEXT_PUBLIC_GENIE_TURN_USERNAME;
    const turnCredential = process.env.NEXT_PUBLIC_GENIE_TURN_CREDENTIAL;
    const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
    if (turnUrl && turnUsername && turnCredential) {
      iceServers.push({ urls: turnUrl, username: turnUsername, credential: turnCredential });
    }
    const peer = new RTCPeerConnection({ iceServers });
    localStream.current?.getTracks().forEach((track) => peer.addTrack(track, localStream.current!));
    peer.onicecandidate = (event) => {
      if (event.candidate) props.onSendSignal(userSub, event.candidate.toJSON());
    };
    peer.ontrack = (event) => {
      if (event.streams[0]) setRemoteStreams((streams) => ({ ...streams, [userSub]: event.streams[0] }));
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed" || peer.connectionState === "closed") {
        setRemoteStreams((streams) => {
          const next = { ...streams };
          delete next[userSub];
          return next;
        });
      }
    };
    peers.current.set(userSub, peer);
    return peer;
  }

  async function startCall() {
    if (!props.roomId) {
      setCallError("Open an encrypted room before starting a peer call.");
      return;
    }
    try {
      setCallError("");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream.current = media;
      setInCall(true);
      const participants = props.members.filter(
        (member) => member.user_sub !== props.mySub && props.onlineSubs.includes(member.user_sub),
      );
      for (const participant of participants) {
        const peer = getPeer(participant.user_sub);
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        props.onSendSignal(participant.user_sub, offer);
      }
      if (!participants.length) setCallError("Waiting for another room member to come online.");
    } catch {
      setCallError("Microphone permission or peer call setup failed.");
    }
  }

  function endCall() {
    peers.current.forEach((peer) => peer.close());
    peers.current.clear();
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    setRemoteStreams({});
    setInCall(false);
  }

  async function startVoiceNote() {
    try {
      setCallError("");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      noteStream.current = media;
      noteChunks.current = [];
      noteStartedAt.current = Date.now();
      const recorder = new MediaRecorder(media);
      noteRecorder.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) noteChunks.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(noteChunks.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size > 8_000_000) {
          setCallError("Voice note is larger than 8 MB. Record a shorter note.");
        } else {
          const reader = new FileReader();
          reader.onloadend = () => {
            if (typeof reader.result === "string") {
              setPendingVoiceNote({
                dataUrl: reader.result,
                durationSeconds: Math.max(1, Math.round((Date.now() - noteStartedAt.current) / 1000)),
              });
            }
          };
          reader.onerror = () => setCallError("The recorded voice note could not be read.");
          reader.readAsDataURL(blob);
        }
        media.getTracks().forEach((track) => track.stop());
        noteStream.current = null;
        noteRecorder.current = null;
        setRecordingVoiceNote(false);
      };
      recorder.start();
      setRecordingVoiceNote(true);
    } catch {
      setCallError("Microphone access for voice notes is unavailable.");
    }
  }

  function stopVoiceNote() {
    if (noteRecorder.current?.state === "recording") noteRecorder.current.stop();
  }

  useEffect(() => {
    const incoming = props.incomingSignal;
    if (!incoming) return;
    void (async () => {
      try {
        if (!localStream.current && "type" in incoming.payload && incoming.payload.type === "offer") {
          localStream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
          setInCall(true);
        }
        if (!localStream.current) return;
        const peer = getPeer(incoming.from_sub);
        const signal = incoming.payload;
        if ("type" in signal && signal.type) {
          await peer.setRemoteDescription(signal);
          if (signal.type === "offer") {
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            props.onSendSignal(incoming.from_sub, answer);
          }
        } else if ("candidate" in signal) {
          await peer.addIceCandidate(signal);
        }
      } catch {
        setCallError("Could not establish the incoming peer connection.");
      }
    })();
  }, [props.incomingSignal]);

  useEffect(() => () => {
    endCall();
    stopVoiceNote();
    noteStream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  return (
    <>
      {props.open && <button className="rail-backdrop" onClick={props.onClose} aria-label="Close utility drawer" />}
      <aside className={`utility-rail ${props.open ? "utility-rail-open" : ""}`} aria-label="Workspace utilities">
        <div className="rail-heading">
          <div><span className="eyebrow">WORKSPACE TOOLS</span><h2>Utilities</h2></div>
          <button className="icon-button" onClick={props.onClose} aria-label="Close utilities"><X size={17} /></button>
        </div>
        <div className="rail-actions">
          <button className="rail-action" onClick={props.onCallGenie}><span className="utility-icon lilac"><AudioLines size={18} /></span><span><strong>Call Genie</strong><small>Start a voice conversation</small></span></button>
          <button className="rail-action" onClick={() => void (inCall ? endCall() : startCall())}><span className="utility-icon peach"><PhoneCall size={18} /></span><span><strong>{inCall ? "End call with friends" : "Call Friends"}</strong><small>Private audio · WebRTC</small></span><span className={`presence-light ${inCall ? "yellow" : "green"}`} /></button>
          <button className="rail-action" disabled={!props.roomId} onClick={() => recordingVoiceNote ? stopVoiceNote() : void startVoiceNote()}><span className="utility-icon stone">{recordingVoiceNote ? <Square size={17} /> : <Mic size={18} />}</span><span><strong>{recordingVoiceNote ? "Stop voice note" : "Record a voice note"}</strong><small>{props.roomId ? "Send encrypted to this room" : "Open a room to record"}</small></span></button>
        </div>
        {pendingVoiceNote && <div className="voice-note-actions">
          <audio controls src={pendingVoiceNote.dataUrl} />
          <button type="button" onClick={() => {
            props.onSendVoiceNote(pendingVoiceNote.dataUrl, pendingVoiceNote.durationSeconds);
            setPendingVoiceNote(null);
          }}>Send as encrypted voice note</button>
          <button type="button" onClick={() => {
            props.onStageVoiceNote(pendingVoiceNote.dataUrl, pendingVoiceNote.durationSeconds);
            setPendingVoiceNote(null);
          }}>Stage in composer · ↑ to Genie, people button to room</button>
          <button type="button" onClick={() => props.onTranscribeLive()}>Start live transcription in composer</button>
          <button type="button" onClick={() => setPendingVoiceNote(null)}>Discard recording</button>
        </div>}
        {callError && <p className="rail-error" role="status">{callError}</p>}
        <section className="call-stage">
          <div className="stage-heading"><span>Teams audio cluster</span><span>{Math.min(5, Object.keys(remoteStreams).length + (inCall ? 1 : 0))}/5</span></div>
          <div className="stage-grid">
            <div className="stage-person local-stage"><span className={`presence-light ${inCall ? "yellow" : "green"}`} /><strong>You</strong><small>{inCall ? "On call" : "Ready"}</small></div>
            {props.members.filter((member) => member.user_sub !== props.mySub).slice(0, 4).map((member) => {
              const online = props.onlineSubs.includes(member.user_sub);
              const connected = Boolean(remoteStreams[member.user_sub]);
              return (
                <div className="stage-person" key={member.user_sub}>
                  <span className={`presence-light ${connected ? "yellow" : online ? "green" : "red"}`} />
                  <strong>{member.user_name}</strong><small>{connected ? "On call" : online ? "Online" : "Offline"}</small>
                  {remoteStreams[member.user_sub] && <audio autoPlay ref={(element) => { if (element && remoteStreams[member.user_sub]) element.srcObject = remoteStreams[member.user_sub]; }} />}
                </div>
              );
            })}
            {!props.members.some((member) => member.user_sub !== props.mySub) && <div className="stage-empty">Invite people to your room to start a P2P call.</div>}
          </div>
        </section>
        <button className="rail-action preferences-action" onClick={props.onOpenSettings}><span className="utility-icon stone"><Settings2 size={18} /></span><span><strong>Workspace preferences</strong><small>Privacy, security, and platform terms</small></span></button>
        <div className="rail-security-note"><ShieldCheck size={15} /><span>Audio is peer-to-peer. Use HTTPS and configure TURN for reliable calls across restrictive networks.</span></div>
      </aside>
    </>
  );
}
