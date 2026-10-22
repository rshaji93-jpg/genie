"use client";

export default function PasscodeInviteModal({ passcode, onClose }: { passcode: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <section aria-label="Room invitation passcode" aria-modal="true" className="invite-passcode-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <h2>Room invitation passcode</h2><p>Share this six-digit code with the intended invitees separately from the room link.</p>
        <strong>{passcode}</strong><button onClick={onClose}>Done</button>
      </section>
    </div>
  );
}
