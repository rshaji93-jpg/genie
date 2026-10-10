"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

type SetupDetails = {
  email: string;
  qr_code: string;
  secret: string;
  detail?: string;
};

export default function TotpReconfigurePage() {
  const [token] = useState(() =>
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("token") || "",
  );
  const [setup, setSetup] = useState<SetupDetails | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!token) {
      void Promise.resolve().then(() => {
        setError("This Authenticator setup link is missing its security token.");
        setLoading(false);
      });
      return;
    }
    window.history.replaceState(null, "", window.location.pathname);
    const controller = new AbortController();
    void fetch(`/api/py/auth/totp-reconfigure?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as SetupDetails;
        if (!response.ok || !result.qr_code || !result.secret || !result.email) {
          throw new Error(result.detail || "This Authenticator setup link is invalid or expired.");
        }
        setSetup(result);
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setError(fetchError instanceof Error ? fetchError.message : "Authenticator setup could not be loaded.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [token]);

  async function verifyAndRelink() {
    if (!setup || code.length !== 6 || !token) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/py/auth/totp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: setup.email,
          code,
          reset_token: token,
        }),
      });
      const result = (await response.json()) as { verified?: boolean; detail?: string };
      if (!response.ok || !result.verified) {
        throw new Error(result.detail || "The Authenticator code could not be verified.");
      }
      setComplete(true);
      setSetup(null);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Authenticator could not be re-linked.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <section className="w-full max-w-md space-y-5 rounded-3xl border border-cyan-900/40 bg-slate-900 p-6 shadow-2xl sm:p-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">Personal AI Genie</p>
          <h1 className="mt-2 text-xl font-bold">Re-link Google Authenticator</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            Set up a new authenticator for your verified account. This one-time link expires after 15 minutes.
          </p>
        </div>

        {loading && <p role="status" className="text-sm text-slate-300">Preparing secure setup…</p>}
        {setup && !complete && (
          <div className="space-y-4">
            <p className="text-xs text-slate-300">{setup.email}</p>
            <Image
              src={setup.qr_code}
              alt="Google Authenticator setup QR code"
              width={192}
              height={192}
              unoptimized
              className="mx-auto h-48 w-48 rounded-xl bg-white p-2"
            />
            <p className="break-all text-center font-mono text-xs text-slate-300">Manual key: {setup.secret}</p>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-300">6-digit Authenticator code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-center font-mono text-lg tracking-[0.4em] text-white outline-none focus:border-cyan-500"
              />
            </label>
            <button
              type="button"
              onClick={() => void verifyAndRelink()}
              disabled={submitting || code.length !== 6}
              className="w-full rounded-xl bg-cyan-700 px-4 py-3 text-sm font-bold text-white hover:bg-cyan-600 disabled:opacity-50"
            >
              {submitting ? "Verifying…" : "Verify & Re-link Authenticator"}
            </button>
          </div>
        )}
        {complete && (
          <p role="status" className="rounded-xl border border-emerald-800 bg-emerald-950/60 px-4 py-3 text-sm text-emerald-200">
            Google Authenticator has been re-linked successfully. You can close this page.
          </p>
        )}
        {error && <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/60 px-4 py-3 text-sm text-rose-200">{error}</p>}
      </section>
    </main>
  );
}
