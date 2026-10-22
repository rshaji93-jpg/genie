"use client";

import { Copy, Mail, MessageCircle, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";

interface RoomInviteModalProps {
  open: boolean;
  link: string;
  passcode: string;
  onClose: () => void;
  onIssueInvite: (username: string) => Promise<void>;
  onShare: () => void;
  onCopy: () => void;
}

export default function RoomInviteModal(props: RoomInviteModalProps) {
  const [username, setUsername] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!props.open) return;
    setUsername("");
    setError("");
  }, [props.open]);

  if (!props.open) return null;
  const hasInvite = Boolean(props.link && props.passcode);
  const inviteText = `Join my private, encrypted Genie room as @${username.trim().replace(/^@/, "")}:\n${props.link}\nRoom passcode: ${props.passcode}\nShare the link and passcode only with the intended participant.`;
  async function issueInvite() {
    const normalized = username.trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{2,32}$/.test(normalized)) {
      setError("Enter a valid @username.");
      return;
    }
    setIssuing(true);
    setError("");
    try {
      await props.onIssueInvite(normalized);
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : "The targeted invite could not be created.");
    } finally {
      setIssuing(false);
    }
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section className="room-invite-modal" role="dialog" aria-modal="true" aria-labelledby="room-invite-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span className="eyebrow">END-TO-END ENCRYPTED</span><h2 id="room-invite-title">Invite people to this room</h2></div><button className="icon-button" onClick={props.onClose} aria-label="Close invite"><X size={17} /></button></header>
        <p>Invite registered @usernames one at a time. Rooms hold one owner and up to four invitees (five members total). The room key stays in the link fragment; share the passcode only with the intended person.</p>
        <label className="room-invite-recipient">
          Invite @username
          <input
            autoComplete="off"
            maxLength={33}
            onChange={(event) => setUsername(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void issueInvite(); }}
            placeholder="@username"
            value={username}
          />
        </label>
        <button className="room-invite-issue" disabled={issuing} onClick={() => void issueInvite()} type="button">
          {issuing ? "Creating targeted invite…" : "Create targeted invite"}
        </button>
        {error && <p className="room-invite-error" role="alert">{error}</p>}
        {hasInvite && (
          <>
            <code>{props.link}</code>
            <strong className="room-invite-passcode">{props.passcode}</strong>
            <div className="room-invite-actions">
              <button onClick={props.onCopy}><Copy size={15} /> Copy invite</button>
              <a href={`mailto:?subject=${encodeURIComponent("Encrypted Genie room invitation")}&body=${encodeURIComponent(inviteText)}`}><Mail size={15} /> Email</a>
              <a href={`https://wa.me/?text=${encodeURIComponent(inviteText)}`} rel="noreferrer" target="_blank"><MessageCircle size={15} /> WhatsApp</a>
              <button onClick={props.onShare}><Share2 size={15} /> Share…</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
