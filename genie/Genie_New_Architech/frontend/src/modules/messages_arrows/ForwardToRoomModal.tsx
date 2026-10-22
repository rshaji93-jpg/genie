"use client";

import { useState } from "react";
import type { ChatMessage } from "@/components/genie/ChatCanvas";

interface RoomOption {
  id: string;
  name: string;
}

export default function ForwardToRoomModal({ open, rooms, source, onClose, onForward }: {
  open: boolean;
  rooms: RoomOption[];
  source?: ChatMessage;
  onClose: () => void;
  onForward: (roomId: string) => Promise<void>;
}) {
  const [sendingTo, setSendingTo] = useState("");
  const [error, setError] = useState("");
  if (!open || !source) return null;
  async function forward(roomId: string) {
    setSendingTo(roomId);
    setError("");
    try {
      await onForward(roomId);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Forward could not be sent.");
    } finally {
      setSendingTo("");
    }
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <section aria-label="Forward to room" aria-modal="true" className="forward-room-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <header><h2>Forward to room</h2><button aria-label="Close forward dialog" onClick={onClose}>×</button></header>
        <p>Message content is decrypted here and encrypted with the destination room key before sending.</p>
        {rooms.map((room) => <button disabled={Boolean(sendingTo)} key={room.id} onClick={() => void forward(room.id)}>{room.name}{sendingTo === room.id ? " · Sending…" : ""}</button>)}
        {!rooms.length && <p>No other rooms are available.</p>}
        {error && <p role="alert">{error}</p>}
      </section>
    </div>
  );
}
