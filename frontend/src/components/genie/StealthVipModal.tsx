"use client";

import { useState } from "react";
import { X } from "lucide-react";

export interface VipApprovalRequest {
  request_id: string;
  email: string;
  display_name: string;
  message: string;
}

interface StealthVipModalProps {
  request: VipApprovalRequest;
  action: "approve" | "reject";
  onClose: () => void;
  onSubmit: (code: string, durationDays: number) => Promise<void>;
}

export default function StealthVipModal({
  request,
  action,
  onClose,
  onSubmit,
}: StealthVipModalProps) {
  const [code, setCode] = useState("");
  const [durationDays, setDurationDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(code, durationDays);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "VIP request could not be reviewed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="stealth-vip-title"
        className="w-full max-w-sm space-y-4 rounded-2xl border border-violet-900/50 bg-[#070b12] p-5 text-slate-100 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="stealth-vip-title" className="text-sm font-bold text-violet-100">
              Verify VIP {action === "approve" ? "approval" : "rejection"}
            </h2>
            <p className="mt-1 truncate text-xs text-slate-400">{request.email}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close authenticator verification" className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          {action === "approve" && (
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-300">VIP duration</span>
              <select
                value={durationDays}
                onChange={(event) => setDurationDays(Number(event.target.value))}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white"
              >
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
              </select>
            </label>
          )}
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">6-digit authenticator code</span>
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em] text-white outline-none focus:border-violet-500"
            />
          </label>
          {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="w-full rounded-xl bg-violet-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Verifying…" : action === "approve" ? "Verify & Approve" : "Verify & Reject"}
          </button>
        </form>
      </section>
    </div>
  );
}
