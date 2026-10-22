"use client";

import { ArrowLeft, ArrowRight, ArrowRightLeft, Info, Pencil, Smile } from "lucide-react";

interface ArrowActionToolbarProps {
  messageRole: "user" | "assistant";
  onQuote: () => void;
  onForward: () => void;
  onReferToGenie: () => void;
  onInfo: () => void;
  onEdit: () => void;
}

export default function ArrowActionToolbar(props: ArrowActionToolbarProps) {
  return (
    <div className="message-action-toolbar" role="toolbar" aria-label="Message actions">
      <button onClick={props.onQuote} title="Quote in this room" aria-label="Quote message"><ArrowLeft size={14} /></button>
      <button onClick={props.onForward} title="Forward to another room" aria-label="Forward message"><ArrowRight size={14} /></button>
      <button onClick={props.onReferToGenie} title="Refer to Genie" aria-label="Refer message to Genie"><ArrowRightLeft size={14} /></button>
      <button onClick={props.onInfo} title="Message audit ledger" aria-label="Show message info"><Info size={14} /></button>
      {props.messageRole === "user" && <button onClick={props.onEdit} title="Edit message" aria-label="Edit message"><Pencil size={14} /></button>}
      <button title="Emoji reaction" aria-label="Add emoji reaction"><Smile size={14} /></button>
    </div>
  );
}
