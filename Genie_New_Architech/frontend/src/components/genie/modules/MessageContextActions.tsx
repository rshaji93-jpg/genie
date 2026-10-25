"use client";

import { Forward, Sparkles } from "lucide-react";
import WhatsAppEmojiPicker from "./WhatsAppEmojiPicker";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

interface MessageContextActionsProps {
  position: { x: number; y: number };
  onReact: (emoji: string) => void;
  onForward: () => void;
  onAIReview: () => void;
  onClose: () => void;
}

const actionButtonStyle: React.CSSProperties = {
  alignItems: "center",
  background: "white",
  border: "1px solid #e5e7eb",
  borderRadius: 9,
  color: "#374151",
  cursor: "pointer",
  display: "inline-flex",
  flex: "0 0 auto",
  fontSize: 12,
  gap: 5,
  height: 34,
  justifyContent: "center",
  padding: "0 9px",
  whiteSpace: "nowrap",
};

export default function MessageContextActions({
  position,
  onReact,
  onForward,
  onAIReview,
  onClose,
}: MessageContextActionsProps) {
  return (
    <div
      aria-label="Message actions"
      className="message-context-actions"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="toolbar"
      style={{
        alignItems: "center",
        background: "rgba(255,255,255,0.98)",
        border: "1px solid rgba(31,41,55,0.12)",
        borderRadius: 13,
        boxShadow: "0 10px 32px rgba(15,23,42,0.18)",
        display: "flex",
        flexWrap: "wrap",
        gap: 5,
        left: Math.max(8, Math.min(position.x, window.innerWidth - 420)),
        maxWidth: "calc(100vw - 16px)",
        overflow: "visible",
        padding: 6,
        position: "fixed",
        top: Math.max(8, Math.min(position.y, window.innerHeight - 100)),
        zIndex: 60,
        width: "max-content",
      }}
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          aria-label={`React with ${emoji}`}
          key={emoji}
          onClick={() => { onReact(emoji); onClose(); }}
          style={{ ...actionButtonStyle, border: 0, fontSize: 20, padding: 0, width: 34 }}
          title={`React with ${emoji}`}
          type="button"
        >
          {emoji}
        </button>
      ))}
      <WhatsAppEmojiPicker
        ariaLabel="More reaction emojis"
        className="[&>button]:h-[34px] [&>button]:w-[34px] [&>button]:rounded-[9px]"
        onSelect={(emoji) => { onReact(emoji); onClose(); }}
        triggerIcon="plus"
      />
      <button
        onClick={() => { onForward(); onClose(); }}
        style={actionButtonStyle}
        type="button"
      >
        <Forward aria-hidden="true" size={15} /> Forward
      </button>
      <button
        onClick={() => { onAIReview(); onClose(); }}
        style={actionButtonStyle}
        type="button"
      >
        <Sparkles aria-hidden="true" size={15} /> AI Review
      </button>
    </div>
  );
}
