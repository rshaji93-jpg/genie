"use client";

export default function SovereignGenesisModal({ onClose }: { onClose: () => void }) {
  return (
    <section aria-label="Sovereign Genesis claim" className="sovereign-console">
      <header><h2>Sovereign Genesis</h2><button onClick={onClose}>×</button></header>
      <p>Claim setup requires the admin passkey session and authenticator app verification.</p>
    </section>
  );
}
