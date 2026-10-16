"use client";

import { Copy, Mail, MessageCircle, Share2, X } from "lucide-react";

interface RoomInviteModalProps {
  open: boolean;
  link: string;
  passcode: string;
  onClose: () => void;
  onShare: () => void;
  onCopy: () => void;
}

export default function RoomInviteModal(props: RoomInviteModalProps) {
  if (!props.open) return null;
  const inviteText = `Join my private, encrypted Genie room:\n${props.link}\nRoom passcode: ${props.passcode}\nShare the link and passcode only with intended participants.`;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section className="room-invite-modal" role="dialog" aria-modal="true" aria-labelledby="room-invite-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span className="eyebrow">END-TO-END ENCRYPTED</span><h2 id="room-invite-title">Invite people to this room</h2></div><button className="icon-button" onClick={props.onClose} aria-label="Close invite"><X size={17} /></button></header>
        <p>The room key is included in the link fragment. Share the six-digit passcode only with intended participants.</p>
        <code>{props.link}</code>
        <strong className="room-invite-passcode">{props.passcode}</strong>
        <div className="room-invite-actions">
          <button onClick={props.onCopy}><Copy size={15} /> Copy invite</button>
          <a href={`mailto:?subject=${encodeURIComponent("Encrypted Genie room invitation")}&body=${encodeURIComponent(inviteText)}`}><Mail size={15} /> Email</a>
          <a href={`https://wa.me/?text=${encodeURIComponent(inviteText)}`} rel="noreferrer" target="_blank"><MessageCircle size={15} /> WhatsApp</a>
          <button onClick={props.onShare}><Share2 size={15} /> Share…</button>
        </div>
      </section>
    </div>
  );
}
