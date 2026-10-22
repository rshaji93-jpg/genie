"use client";

import { Volume2 } from "lucide-react";

export default function BroadcastToCallButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return <button aria-label="Broadcast audio to call" className="broadcast-call-button" disabled={disabled} onClick={onClick} type="button"><Volume2 size={15} /> Broadcast to call</button>;
}
