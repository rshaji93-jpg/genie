"use client";

export default function GeoAttestationModal({ open, action, onConfirm, onCancel }: {
  open: boolean;
  action: "send" | "accept";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onCancel} role="presentation">
      <section aria-label="Personal acquaintance attestation" aria-modal="true" className="geo-attestation-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <h2>Personal acquaintance check</h2>
        <p>Do you know this person personally? Their coarse region differs from yours.</p>
        <button onClick={onConfirm}>{action === "send" ? "Yes, send request" : "Yes, accept request"}</button>
        <button onClick={onCancel}>Cancel</button>
      </section>
    </div>
  );
}
