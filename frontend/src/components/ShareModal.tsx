"use client";

import React, { useState } from "react";
import { X, Users, Copy, Check, Send, Sparkles } from "lucide-react";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle: string;
  chatMessages: { role: string; content: string }[];
}

export default function ShareModal({
  isOpen,
  onClose,
  chatTitle,
  chatMessages,
}: ShareModalProps) {
  const [friendEmail, setFriendEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const shareCode = `GENIE-SHARE-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  const handleShareWithFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!friendEmail.trim()) return;
    setIsSending(true);

    try {
      // Simulate/call backend chat share dispatch
      await new Promise((r) => setTimeout(r, 600));
      setStatusMessage(`Shared "${chatTitle}" directly to ${friendEmail}'s Genie workspace!`);
      setTimeout(() => {
        setStatusMessage(null);
        setFriendEmail("");
        onClose();
      }, 2200);
    } catch {
      setStatusMessage("Failed to share. Please try again.");
    } finally {
      setIsSending(false);
    }
  };

  const handleCopyShareCode = () => {
    navigator.clipboard.writeText(shareCode);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-violet-100 rounded-lg text-violet-700">
              <Users className="w-4 h-4" />
            </div>
            <span className="font-bold text-slate-800 text-sm">
              Share Chat with Genie Friends
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {statusMessage ? (
          <div className="p-6 text-center text-sm font-semibold text-emerald-600 bg-emerald-50">
            {statusMessage}
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Target Chat Info */}
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Sharing Conversation
              </span>
              <span className="text-sm font-medium text-slate-800 truncate block">
                {chatTitle}
              </span>
              <span className="text-xs text-slate-500">
                {chatMessages.length} message(s) included
              </span>
            </div>

            {/* Direct Send to Friend's Genie Account */}
            <form onSubmit={handleShareWithFriend} className="space-y-2">
              <label className="text-xs font-semibold text-slate-700">
                Send to Friend's Genie ID / Gmail:
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  required
                  value={friendEmail}
                  onChange={(e) => setFriendEmail(e.target.value)}
                  placeholder="friend@gmail.com"
                  className="flex-1 text-xs border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-400"
                />
                <button
                  type="submit"
                  disabled={isSending || !friendEmail.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-semibold disabled:opacity-50 transition-all shadow-sm"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSending ? "Sending..." : "Share"}</span>
                </button>
              </div>
            </form>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-slate-200"></div>
              <span className="flex-shrink mx-2 text-[10px] text-slate-400 uppercase font-semibold">
                Or Share with Code
              </span>
              <div className="flex-grow border-t border-slate-200"></div>
            </div>

            {/* Share Code / Link Box */}
            <div className="flex items-center justify-between bg-purple-50/60 border border-purple-200 p-2.5 rounded-xl">
              <div>
                <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider block">
                  Genie Sync Code
                </span>
                <span className="text-xs font-mono font-bold text-purple-900">
                  {shareCode}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopyShareCode}
                className="flex items-center gap-1 px-3 py-1.5 bg-white border border-purple-200 rounded-lg text-xs font-semibold text-purple-700 hover:bg-purple-100 transition-colors shadow-xs"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Code</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}