"use client";

import { Smile } from "lucide-react";
import { useState } from "react";

const emojis = ["🙂", "😂", "❤️", "🙏", "👍", "✨", "🎉", "🤔", "🔥", "✅", "👋", "💡"];

export default function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="emoji-picker-wrap">
      <button aria-expanded={open} aria-label="Choose emoji" className="icon-button" onClick={() => setOpen((value) => !value)} type="button"><Smile size={18} /></button>
      {open && <div className="emoji-picker" role="listbox">{emojis.map((emoji) => <button aria-label={emoji} key={emoji} onClick={() => { onSelect(emoji); setOpen(false); }} type="button">{emoji}</button>)}</div>}
    </div>
  );
}
