"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface RequestVIPModalProps {
  onClose: () => void;
  onRequest: (message: string) => Promise<void>;
}

export default function RequestVIPModal({ onClose, onRequest }: RequestVIPModalProps) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onRequest(message.trim());
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "VIP request could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="request-vip-title" className="w-full max-w-sm space-y-4 rounded-2xl border border-cyan-900/50 bg-[#070b12] p-5 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 id="request-vip-title" className="text-sm font-bold text-cyan-100">Request VIP Pass</h2>
          <button type="button" onClick={onClose} aria-label="Close VIP request" className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          <p className="text-xs leading-relaxed text-slate-300">Send a request to the Genie administrator. Approved passes are assigned by the administrator.</p>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">Why would VIP access help? (optional)</span>
            <textarea maxLength={1000} rows={3} value={message} onChange={(event) => setMessage(event.target.value)} className="w-full resize-y rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500" />
          </label>
          {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-xl bg-cyan-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? "Sending request…" : "Request VIP Pass"}
          </button>
        </form>
      </section>
    </div>
  );
}
