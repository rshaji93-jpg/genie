"use client";

import React, { useState, useEffect } from "react";
import { 
  Crown, 
  Share2, 
  Check, 
  WifiOff, 
  X, 
  ShieldCheck,
  UploadCloud,
  KeyRound
} from "lucide-react";

interface UnifiedEngineProps {
  onInjectPrompt: (prompt: string) => void;
  userEmail?: string;
  compact?: boolean;
}

export default function UnifiedStudyEngine({
  onInjectPrompt,
  userEmail = "",
  compact = false,
}: UnifiedEngineProps) {
  const [isVip, setIsVip] = useState(false);
  const [vipModalOpen, setVipModalOpen] = useState(false);
  const [totpInput, setTotpInput] = useState("");
  const [vipMessage, setVipMessage] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  const [isOnline, setIsOnline] = useState(true);
  const [shareCopied, setShareCopied] = useState(false);
  const [isProcessingDoc, setIsProcessingDoc] = useState(false);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const storedVip = localStorage.getItem("genie_vip_unlocked") === "true";
    const isAcademic =
      userEmail.endsWith(".edu") ||
      userEmail.endsWith(".ac.in") ||
      userEmail.endsWith(".res.in");

    if (storedVip || isAcademic) {
      setIsVip(true);
      localStorage.setItem("genie_vip_unlocked", "true");
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [userEmail]);

  const handleVerifyTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifying(true);
    setVipMessage("");

    try {
      const response = await fetch("/api/genie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify_totp", code: totpInput }),
      });
      const result = (await response.json()) as { valid?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(result.error || `Authenticator service returned HTTP ${response.status}.`);
      }

      if (result.valid) {
        setIsVip(true);
        localStorage.setItem("genie_vip_unlocked", "true");
        setVipMessage("Google Authenticator verified! VIP Pass activated.");
        setTimeout(() => {
          setVipModalOpen(false);
          setVipMessage("");
        }, 1500);
      } else {
        setVipMessage("Invalid Authenticator code. Check your Google Authenticator app.");
      }
    } catch (error) {
      const diagnostic =
        error instanceof Error ? error.message : "Unknown authenticator verification error.";
      console.error("TOTP verification request failed.", error);
      setVipMessage(`Authenticator verification failed: ${diagnostic}`);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleCopyShareLink = () => {
    const shareUrl = `${window.location.origin}?session=${Date.now()}`;
    navigator.clipboard.writeText(shareUrl);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingDoc(true);
    try {
      const text = await file.text();
      const snippet = text.slice(0, 3000);
      const flashcardPrompt = `Please review this academic document ("${file.name}"):\n\n"""\n${snippet}\n"""\n\n1. Provide a 3-bullet revision summary.\n2. Extract 3 key flashcards (Question & Answer format).\n3. Formulate one sample exam problem with step-by-step solution.`;
      onInjectPrompt(flashcardPrompt);
    } catch {
      alert("Could not read text file. Please upload a .txt or .md lecture handout.");
    } finally {
      setIsProcessingDoc(false);
    }
  };

  return (
    <div className={`w-full mx-auto px-1 mb-2 text-xs ${compact ? "flex flex-col items-stretch gap-2" : "max-w-2xl flex items-center justify-between px-2"}`}>
      <div className={`flex items-center gap-2 ${compact ? "flex-wrap" : ""}`}>
        <button
          type="button"
          onClick={() => setVipModalOpen(true)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold shadow-xs transition-all border ${
            isVip
              ? "bg-gradient-to-r from-amber-50 to-yellow-50 text-amber-700 border-amber-300 hover:border-amber-400"
              : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
          }`}
        >
          <Crown className={`w-3.5 h-3.5 ${isVip ? "text-amber-600 fill-amber-500" : "text-slate-400"}`} />
          <span>{isVip ? "VIP Unlimited Active" : "Get VIP Pass"}</span>
        </button>

        {!isOnline && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-600 font-semibold text-[10px]">
            <WifiOff className="w-3 h-3" />
            <span>Offline (Read Cache)</span>
          </span>
        )}
      </div>

      <div className={`flex items-center gap-2 ${compact ? "w-full flex-col items-stretch" : ""}`}>
        <label className={`flex min-w-0 items-center justify-center gap-1 px-2.5 py-1 bg-white border border-slate-200 hover:border-purple-300 text-slate-700 rounded-full font-semibold cursor-pointer shadow-xs transition-all ${compact ? "w-full text-center" : ""}`}>
          <UploadCloud className="w-3.5 h-3.5 text-purple-600" />
          <span className="truncate">{isProcessingDoc ? "Analyzing..." : "Notes to Flashcards"}</span>
          <input
            type="file"
            accept=".txt,.md,.json,.csv"
            className="hidden"
            onChange={handleDocumentUpload}
            disabled={isProcessingDoc}
          />
        </label>

        <button
          type="button"
          onClick={handleCopyShareLink}
          className={`flex items-center justify-center gap-1 px-2.5 py-1 bg-white border border-slate-200 hover:border-purple-300 text-slate-700 rounded-full font-semibold shadow-xs transition-all ${compact ? "w-full" : ""}`}
          title="Share Session Link"
        >
          {shareCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5 text-indigo-600" />}
          <span>{shareCopied ? "Link Copied!" : "Share Room"}</span>
        </button>
      </div>

      {vipModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-500" />
                <h3 className="font-bold text-slate-800 text-base">Google Authenticator VIP</h3>
              </div>
              <button
                type="button"
                onClick={() => setVipModalOpen(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Enter the live 6-digit rolling code from your Google Authenticator app to activate VIP Unlimited.
            </p>

            <form onSubmit={handleVerifyTotp} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  6-Digit Rolling Code
                </label>
                <input
                  type="text"
                  maxLength={7}
                  value={totpInput}
                  onChange={(e) => setTotpInput(e.target.value)}
                  placeholder="000 000"
                  className="w-full text-center tracking-widest text-base font-mono font-bold border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 text-slate-800 focus:outline-none focus:border-amber-400"
                />
              </div>

              {vipMessage && (
                <p className={`text-[11px] font-semibold text-center ${isVip ? "text-emerald-600" : "text-rose-600"}`}>
                  {vipMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={isVerifying || totpInput.trim().length < 6}
                className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 disabled:opacity-40 text-white font-bold text-xs rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{isVerifying ? "Verifying Token..." : "Verify & Unlock VIP"}</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
