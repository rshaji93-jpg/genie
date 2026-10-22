"use client";

import { useState } from "react";

export default function StealthVipClaimModal({ onClaim }: { onClaim: (code: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  if (!open) return <button className="stealth-vip-trigger" onClick={() => setOpen(true)} type="button">✦ Claim VIP</button>;
  return (
    <form className="stealth-vip-form" onSubmit={(event) => {
      event.preventDefault();
      void onClaim(code).then(() => setOpen(false)).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "VIP claim failed."));
    }}>
      <input aria-label="VIP pass code" maxLength={64} onChange={(event) => setCode(event.target.value)} value={code} />
      <button type="submit">Claim pass</button><button onClick={() => setOpen(false)} type="button">Cancel</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
