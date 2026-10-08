"use client";
import React, { useState } from "react";
import { X, AlertTriangle, Lightbulb } from "lucide-react";

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  disputeContext?: string;
}

export default function FeedbackModal({ isOpen, onClose, disputeContext }: FeedbackModalProps) {
  const [category, setCategory] = useState<"bad_reply" | "suggestion">(
    disputeContext ? "bad_reply" : "suggestion"
  );
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successStatus, setSuccessStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const res = await fetch("http://localhost:8000/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_email: "tester@genie.ai",
          user_name: "Workspace Tester",
          category,
          message,
          chat_context: disputeContext || "Direct app interface feedback",
        }),
      });

      await res.json();
      setSuccessStatus(
        category === "bad_reply"
          ? "Dispute registered. Our AI Quality Auditor has generated a resolution and sent it to your email."
          : "Suggestion registered! Thank you for shaping Personal AI Genie."
      );
      setTimeout(() => {
        setSuccessStatus(null);
        setMessage("");
        onClose();
      }, 2500);
    } catch {
      alert("Please ensure the backend is active on port 8000.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-fade">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <span className="font-semibold text-slate-800 text-sm">
            {disputeContext ? "Report Issue with Response" : "Share Feature & Ideas"}
          </span>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {successStatus ? (
          <div className="p-6 text-center text-sm font-medium text-emerald-600">
            <p>{successStatus}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCategory("bad_reply")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium rounded-lg border transition-all ${
                  category === "bad_reply"
                    ? "bg-rose-50 border-rose-200 text-rose-700 shadow-inner"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 text-rose-500" /> Disputed Answer
              </button>
              <button
                type="button"
                onClick={() => setCategory("suggestion")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium rounded-lg border transition-all ${
                  category === "suggestion"
                    ? "bg-indigo-50 border-indigo-200 text-indigo-700 shadow-inner"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Lightbulb className="w-3.5 h-3.5 text-indigo-500" /> Suggestion
              </button>
            </div>

            <textarea
              required
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                category === "bad_reply"
                  ? "Explain what was wrong with the answer (e.g., incorrect math, hallucinated fact)..."
                  : "How can we make Genie better? Describe your suggestion..."
              }
              className="w-full text-sm border border-slate-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 text-slate-800"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !message.trim()}
                className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {isSubmitting ? "Submitting..." : "Submit Ticket"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}