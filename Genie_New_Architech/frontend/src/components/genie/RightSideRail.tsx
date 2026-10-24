"use client";

import { AudioLines, PhoneCall, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import LiveAgentCallDock from "@/components/genie/modules/LiveAgentCallDock";

export interface RoomPerson {
  user_sub: string;
  user_name: string;
  username?: string;
}

export interface CallSignal {
  from_sub: string;
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit | { type: "decline"; message: string };
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
  onVoiceParticipantsChange: (userSubs: string[]) => void;
  onLocalStreamChange?: (stream: MediaStream | null) => void;
  onSendSignal: (toSub: string, payload: CallSignal["payload"]) => void;
}

export default function RightSideRail(props: RightSideRailProps) {
  const [inCall, setInCall] = useState(false);
  const [selectedCallMembers, setSelectedCallMembers] = useState<string[]>([]);
  const [pendingIncoming, setPendingIncoming] = useState<CallSignal | null>(null);
  const [callError, setCallError] = useState("");
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [localVideoEnabled, setLocalVideoEnabled] = useState(false);
  const [localMicEnabled, setLocalMicEnabled] = useState(true);
  const [genieSummoned, setGenieSummoned] = useState(false);
  const [callPickerOpen, setCallPickerOpen] = useState(false);
  const localStream = useRef<MediaStream | null>(null);
  const screenShareStream = useRef<MediaStream | null>(null);
  const peers = useRef<Map<string, RTCPeerConnection>>(new Map());

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

  async function inviteCallMembers(userSubs: string[]) {
    const participants = props.members.filter((member) =>
      userSubs.includes(member.user_sub)
      && member.user_sub !== props.mySub
      && props.onlineSubs.includes(member.user_sub)
      && !peers.current.has(member.user_sub),
    );
    if (!localStream.current) {
      setCallError("Start a room call before adding another member.");
      return;
    }
    if (!participants.length) {
      setCallError("Select an online room member who is not already in the call.");
      return;
    }
    try {
      setCallError("");
      for (const participant of participants) {
        const peer = getPeer(participant.user_sub);
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        props.onSendSignal(participant.user_sub, offer);
      }
      setSelectedCallMembers((current) => current.filter((sub) => !participants.some((member) => member.user_sub === sub)));
      setCallPickerOpen(false);
    } catch {
      setCallError("Could not add the selected member to the call.");
    }
  }

  async function startCall() {
    if (inCall) {
      setCallError("Use + Add member in the live call dock to invite more people.");
      return;
    }
    if (!props.roomId) {
      setCallError("Open an encrypted room before starting a peer call.");
      return;
    }
    const participants = props.members.filter((member) =>
      member.user_sub !== props.mySub
      && selectedCallMembers.includes(member.user_sub)
      && props.onlineSubs.includes(member.user_sub),
    );
    if (!participants.length) {
      setCallError("Select at least one online room member to call.");
      return;
    }
    try {
      setCallError("");
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      localStream.current = media;
      props.onLocalStreamChange?.(media);
      setInCall(true);
      await inviteCallMembers(participants.map((participant) => participant.user_sub));
    } catch {
      setCallError("Microphone permission or peer call setup failed.");
    }
  }

  async function acceptIncomingCall() {
    const incoming = pendingIncoming;
    if (!incoming || !("type" in incoming.payload) || incoming.payload.type !== "offer") return;
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      localStream.current = media;
      props.onLocalStreamChange?.(media);
      setInCall(true);
      setPendingIncoming(null);
      const peer = getPeer(incoming.from_sub);
      await peer.setRemoteDescription(incoming.payload);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      props.onSendSignal(incoming.from_sub, answer);
    } catch {
      setCallError("Could not accept the incoming call. Check microphone permission.");
    }
  }

  function toggleLocalMic() {
    const enabled = !localMicEnabled;
    localStream.current?.getAudioTracks().forEach((track) => { track.enabled = enabled; });
    setLocalMicEnabled(enabled);
  }

  async function syncScreenShare(stream: MediaStream | null) {
    const previousStream = screenShareStream.current;
    if (previousStream && localStream.current) {
      for (const track of previousStream.getTracks()) {
        localStream.current.removeTrack(track);
        for (const peer of peers.current.values()) {
          const sender = peer.getSenders().find((candidate) => candidate.track?.id === track.id);
          if (sender) await sender.replaceTrack(null);
        }
      }
    }
    screenShareStream.current = stream;
    if (!stream || !localStream.current) return;

    for (const track of stream.getTracks()) {
      localStream.current.addTrack(track);
      for (const [userSub, peer] of peers.current) {
        peer.addTrack(track, stream);
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        props.onSendSignal(userSub, offer);
      }
    }
  }

  async function toggleLocalVideo() {
    if (localVideoEnabled) {
      const tracks = localStream.current?.getVideoTracks() || [];
      for (const track of tracks) {
        for (const peer of peers.current.values()) {
          const sender = peer.getSenders().find((candidate) => candidate.track?.id === track.id);
          if (sender) await sender.replaceTrack(null);
        }
        localStream.current?.removeTrack(track);
        track.stop();
      }
      setLocalVideoEnabled(false);
      return;
    }
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (!localStream.current) {
        videoStream.getTracks().forEach((track) => track.stop());
        setCallError("Start a room call before enabling video.");
        return;
      }
      for (const track of videoStream.getVideoTracks()) {
        localStream.current.addTrack(track);
        for (const [userSub, peer] of peers.current) {
          peer.addTrack(track, localStream.current);
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          props.onSendSignal(userSub, offer);
        }
      }
      setLocalVideoEnabled(true);
    } catch {
      setCallError("Camera access is unavailable.");
    }
  }

  function declineIncomingCall(message: string) {
    if (!pendingIncoming) return;
    props.onSendSignal(pendingIncoming.from_sub, { type: "decline", message });
    setPendingIncoming(null);
  }

  function endCall() {
    peers.current.forEach((peer) => peer.close());
    peers.current.clear();
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    screenShareStream.current = null;
    props.onLocalStreamChange?.(null);
    setRemoteStreams({});
    setLocalVideoEnabled(false);
    setLocalMicEnabled(true);
    setInCall(false);
    setGenieSummoned(false);
  }

  function summonGenie() {
    setGenieSummoned(true);
    props.onCallGenie();
  }

  useEffect(() => {
    const incoming = props.incomingSignal;
    if (!incoming) return;
    if ("type" in incoming.payload && incoming.payload.type === "decline") {
      setCallError(incoming.payload.message);
      return;
    }
    if ("type" in incoming.payload && incoming.payload.type === "offer" && !inCall) {
      setPendingIncoming(incoming);
      if ("serviceWorker" in navigator && "Notification" in window && Notification.permission === "granted") {
        void navigator.serviceWorker.ready.then((registration) => registration.showNotification("Incoming Genie room call", {
          body: "A room member is calling you.",
          tag: `genie-call-${incoming.from_sub}`,
        }));
      }
      return;
    }
    void (async () => {
      try {
        if (!localStream.current && "type" in incoming.payload && incoming.payload.type === "offer") {
          localStream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
          setInCall(true);
        }
        if (!localStream.current) return;
        const peer = getPeer(incoming.from_sub);
        const signal = incoming.payload;
        if ("type" in signal && signal.type === "decline") return;
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
  }, [props.incomingSignal, inCall]);

  useEffect(() => () => {
    endCall();
  }, []);

  return (
    <>
      {inCall && (
        <section className="active-call-dock" aria-label="Active room call">
          <div className="active-call-dock-heading">
            <strong>Live room call</strong>
            <span>{Math.min(5, Object.keys(remoteStreams).length + 1)}/5</span>
            <button type="button" className="call-dock-end" onClick={endCall}>End call</button>
          </div>
          {genieSummoned && (
            <div className="call-dock-genie-participant" role="status">
              <span aria-hidden="true">✨</span>
              <span><strong>Genie</strong><small>AI participant · shared responses appear in this room</small></span>
              <span className="call-dock-genie-status">Summoned</span>
            </div>
          )}
          <LiveAgentCallDock
            activeSpeakerName={props.members.find((member) => member.user_sub === props.mySub)?.user_name || "You"}
            activeSpeakerStatus="Connected"
            audioEnabled={localMicEnabled}
            cameraStream={localStream.current}
            liveAiLabel="Genie"
            liveAiStatus={genieSummoned ? "In the room" : "Ready"}
            onEndCall={endCall}
            onScreenShareChange={(stream) => { void syncScreenShare(stream).catch(() => setCallError("Screen sharing could not be synchronized with every call participant.")); }}
            onToggleAudio={toggleLocalMic}
            onToggleVideo={() => void toggleLocalVideo()}
            videoEnabled={localVideoEnabled}
          />
          <div className="active-call-dock-controls">
            {Object.entries(remoteStreams).map(([userSub, media]) => {
              const name = props.members.find((member) => member.user_sub === userSub)?.user_name || "Member";
              const audioEnabled = media.getAudioTracks().some((track) => track.enabled);
              const videoEnabled = media.getVideoTracks().some((track) => track.enabled);
              return (
                <span className="call-dock-member" key={userSub}>
                  <strong>{name}</strong>
                  <button type="button" onClick={() => {
                    media.getAudioTracks().forEach((track) => { track.enabled = !audioEnabled; });
                    setRemoteStreams((current) => ({ ...current }));
                  }}>🎤 {audioEnabled ? "On" : "Off"}</button>
                  <button type="button" onClick={() => {
                    media.getVideoTracks().forEach((track) => { track.enabled = !videoEnabled; });
                    setRemoteStreams((current) => ({ ...current }));
                  }}>📹 {videoEnabled ? "On" : "Off"}</button>
                </span>
              );
            })}
            <button type="button" onClick={() => setCallPickerOpen((open) => !open)}>+ Add member</button>
            <button type="button" onClick={summonGenie}>✨ Summon Genie</button>
          </div>
          {(localVideoEnabled || Object.values(remoteStreams).some((media) => media.getVideoTracks().length > 0)) && (
            <div className="call-dock-media">
              {localVideoEnabled && localStream.current && (
                <video autoPlay muted playsInline ref={(element) => {
                  if (element && localStream.current) element.srcObject = localStream.current;
                }} />
              )}
              {Object.entries(remoteStreams).map(([userSub, media]) => (
                <div key={userSub}>
                  <audio autoPlay ref={(element) => { if (element) element.srcObject = media; }} />
                  {media.getVideoTracks().length > 0 && (
                    <video autoPlay playsInline ref={(element) => { if (element) element.srcObject = media; }} />
                  )}
                </div>
              ))}
            </div>
          )}
          {Object.values(remoteStreams).length > 0 && !Object.values(remoteStreams).some((media) => media.getVideoTracks().length > 0) && (
            <div className="call-dock-audio">
              {Object.entries(remoteStreams).map(([userSub, media]) => (
                <audio key={userSub} autoPlay ref={(element) => { if (element) element.srcObject = media; }} />
              ))}
            </div>
          )}
          {callPickerOpen && (
            <div className="call-dock-picker" role="dialog" aria-label="Add room members to call">
              {props.members.filter((member) =>
                member.user_sub !== props.mySub
                && props.onlineSubs.includes(member.user_sub)
                && !peers.current.has(member.user_sub),
              ).map((member) => (
                <label key={member.user_sub}>
                  <input
                    checked={selectedCallMembers.includes(member.user_sub)}
                    onChange={(event) => setSelectedCallMembers((current) => event.target.checked
                      ? [...current, member.user_sub]
                      : current.filter((sub) => sub !== member.user_sub))}
                    type="checkbox"
                  />
                  {member.user_name}
                </label>
              ))}
              <button type="button" onClick={() => void inviteCallMembers(selectedCallMembers)}>Ring selected</button>
            </div>
          )}
        </section>
      )}
      {pendingIncoming && (
        <div className="incoming-call-backdrop" role="presentation">
          <section className="incoming-call-card" role="dialog" aria-modal="true" aria-label="Incoming room call">
            <span className="eyebrow">INCOMING ROOM CALL</span>
            <h2>{props.members.find((member) => member.user_sub === pendingIncoming.from_sub)?.user_name || "A room member"} is calling</h2>
            <button className="primary-button" onClick={() => void acceptIncomingCall()} type="button">✓ Accept</button>
            <button className="subtle-button" onClick={() => declineIncomingCall("In a meeting, will call back soon 🙏")} type="button">In a meeting, will call back soon 🙏</button>
            <button className="subtle-button" onClick={() => declineIncomingCall("Busy right now, message in the room 🚗")} type="button">Busy right now, message in the room 🚗</button>
          </section>
        </div>
      )}
      {props.open && <button className="call-picker-backdrop" onClick={props.onClose} aria-label="Close call picker" />}
      {props.open && <aside className="call-picker-popover" aria-label="Selective room call">
        <div className="rail-heading">
          <div><span className="eyebrow">LIVE ROOM</span><h2>Call room members</h2></div>
          <button className="icon-button" onClick={props.onClose} aria-label="Close call picker"><X size={17} /></button>
        </div>
        <div className="call-member-picker" aria-label="Choose room members to call">
          <strong>Choose who to ring</strong>
          {props.members.filter((member) => member.user_sub !== props.mySub).map((member) => (
            <label key={member.user_sub}>
              <input
                checked={selectedCallMembers.includes(member.user_sub)}
                disabled={!props.onlineSubs.includes(member.user_sub)}
                onChange={(event) => setSelectedCallMembers((current) => event.target.checked
                  ? [...current, member.user_sub]
                  : current.filter((sub) => sub !== member.user_sub))}
                type="checkbox"
              />
              <span>{member.user_name}</span>
              <small>{props.onlineSubs.includes(member.user_sub) ? "Online" : "Offline"}</small>
            </label>
          ))}
        </div>
        <div className="call-picker-actions">
          <button type="button" onClick={() => void startCall()} disabled={!props.roomId || selectedCallMembers.length === 0}>
            <PhoneCall size={16} /> Call selected members
          </button>
          <button type="button" onClick={summonGenie}><AudioLines size={16} /> Summon Genie
          </button>
        </div>
        {callError && <p className="rail-error" role="status">{callError}</p>}
      </aside>}
    </>
  );
}
