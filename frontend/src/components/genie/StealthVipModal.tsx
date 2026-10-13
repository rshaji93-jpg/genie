"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface StealthVipModalProps {
  onClose: () => void;
  onClaim: (code: string, days: number) => Promise<void>;
}

export default function StealthVipModal({ onClose, onClaim }: StealthVipModalProps) {
  const [code, setCode] = useState("");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter a valid six-digit authenticator code.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onClaim(code, days);
      onClose();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "VIP claim failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="stealth-vip-title"
        className="w-full max-w-sm space-y-4 rounded-2xl border border-cyan-900/50 bg-[#070b12] p-5 text-slate-100 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 id="stealth-vip-title" className="text-sm font-bold text-cyan-100">VIP Access</h2>
          <button type="button" onClick={onClose} aria-label="Close VIP access" className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">6-digit authenticator code</span>
            <input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-center font-mono text-lg tracking-[0.35em] text-white outline-none focus:border-cyan-500"
              aria-label="Six-digit authenticator code"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">VIP duration</span>
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white"
            >
              {Array.from({ length: 7 }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>{value} {value === 1 ? "day" : "days"}</option>
              ))}
            </select>
          </label>
          {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="w-full rounded-xl bg-cyan-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Verifying..." : "Claim VIP Access"}
          </button>
        </form>
      </section>
    </div>
  );
}
