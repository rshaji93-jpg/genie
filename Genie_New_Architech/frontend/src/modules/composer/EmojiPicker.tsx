"use client";

import WhatsAppEmojiPicker from "@/components/genie/modules/WhatsAppEmojiPicker";

export default function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  return <WhatsAppEmojiPicker onSelect={onSelect} />;
}
