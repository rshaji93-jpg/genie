"use client";
import React, { useState } from "react";
import { ThumbsUp, ThumbsDown, Copy, MoreHorizontal, Mail, Check } from "lucide-react";

export default function MessageItem({
  message,
  chatTitle,
  onDispute,
}: {
  message: { role: string; content: string };
  chatTitle: string;
  onDispute: (msgContent: string) => void;
}) {
  const isAI = message.role === "assistant";
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportToGmail = () => {
    const url = `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(
      chatTitle
    )}&body=${encodeURIComponent(message.content)}`;
    window.open(url, "_blank");
  };

  const exportToOutlook = () => {
    const url = `https://outlook.live.com/mail/0/deeplink/compose?subject=${encodeURIComponent(
      chatTitle
    )}&body=${encodeURIComponent(message.content)}`;
    window.open(url, "_blank");
  };

  return (
    <div className={`flex flex-col gap-2 py-2 ${isAI ? "items-start" : "items-end"}`}>
      <div
        className={`rounded-2xl px-5 py-3.5 max-w-[88%] text-base leading-relaxed ${
          isAI
            ? "bg-white border border-slate-200/80 shadow-sm text-slate-800"
            : "bg-indigo-600 text-white"
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>

      {isAI && (
        <div className="flex items-center gap-1 text-slate-400 pl-2 select-none">
          <button className="p-1.5 hover:text-slate-700 rounded-md transition-colors" title="Accurate response">
            <ThumbsUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDispute(message.content)}
            className="p-1.5 hover:text-rose-600 rounded-md transition-colors"
            title="Report inaccurate Response (AI QA Auditor)"
          >
            <ThumbsDown className="w-4 h-4" />
          </button>
          <button
            onClick={handleCopy}
            className="p-1.5 hover:text-slate-700 rounded-md transition-colors"
            title="Copy text"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          </button>

          <div className="relative group">
            <button className="p-1.5 hover:text-slate-700 rounded-md transition-colors">
              <MoreHorizontal className="w-4 h-4" />
            </button>
            <div className="absolute left-0 bottom-full mb-1 hidden group-hover:flex flex-col bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-44 z-20">
              <button
                onClick={exportToGmail}
                type="button"
                className="flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Mail className="w-3.5 h-3.5 text-red-500" /> Draft in Gmail
              </button>
              <button
                onClick={exportToOutlook}
                type="button"
                className="flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Mail className="w-3.5 h-3.5 text-blue-500" /> Draft in Outlook
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}