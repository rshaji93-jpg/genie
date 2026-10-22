"use client";

import { Copy, MessageCircle, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";

interface RoomInviteModalProps {
  open: boolean;
  link: string;
  passcode: string;
  onClose: () => void;
  onShare: (text: string) => void;
  onCopy: () => Promise<void>;
}

export default function RoomInviteModal(props: RoomInviteModalProps) {
  const [recipient, setRecipient] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  useEffect(() => {
    if (!props.open) return;
    setRecipient("");
    setCopied(false);
    setCopyError("");
  }, [props.open]);

  if (!props.open) return null;
  const inviteText = `Join my encrypted Personal AI Genie room: ${props.link}${props.passcode ? `\nPasscode: ${props.passcode}` : ""}`;
  const copyInvite = async () => {
    try {
      await props.onCopy();
      setCopied(true);
      setCopyError("");
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : "The invitation could not be copied.");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section className="room-invite-modal" role="dialog" aria-modal="true" aria-labelledby="room-invite-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span className="eyebrow">END-TO-END ENCRYPTED</span><h2 id="room-invite-title">Invite people to this room</h2></div>
          <button className="icon-button" onClick={props.onClose} aria-label="Close invite"><X size={17} /></button>
        </header>
        <p>Share this encrypted room link and passcode only with people you trust. The room key stays in the link fragment.</p>
        <label className="room-invite-recipient">
          Friend's name or @username <span>(optional)</span>
          <input
            autoComplete="off"
            maxLength={80}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="e.g. raja or @raja"
            value={recipient}
          />
        </label>
        {props.link && (
          <>
            <code>{props.link}</code>
            {props.passcode && <strong className="room-invite-passcode">{props.passcode}</strong>}
            <div className="room-invite-actions">
              <a
                className="room-invite-whatsapp"
                href={`https://wa.me/?text=${encodeURIComponent(inviteText)}`}
                rel="noreferrer"
                target="_blank"
                aria-label={recipient.trim() ? `Share invite with ${recipient.trim()} on WhatsApp` : "Share on WhatsApp"}
              >
                <MessageCircle size={15} /> Share on WhatsApp
              </a>
              <button onClick={() => props.onShare(inviteText)} type="button"><Share2 size={15} /> Native Share</button>
              <button onClick={() => void copyInvite()} type="button"><Copy size={15} /> {copied ? "Copied!" : "Copy Invite Link"}</button>
            </div>
            {copyError && <p className="room-invite-error" role="alert">{copyError}</p>}
          </>
        )}
      </section>
    </div>
  );
}
