"use client";

import React, { useState, useRef } from "react";
import { X, Download, Upload, KeyRound, Check, AlertCircle } from "lucide-react";

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportCode: (code: string) => void;
  onExportBackup: () => void;
  onRestoreBackup: (file: File) => void;
}

export default function SyncModal({
  isOpen,
  onClose,
  onImportCode,
  onExportBackup,
  onRestoreBackup,
}: SyncModalProps) {
  const [tab, setTab] = useState<"code" | "backup">("code");
  const [syncCode, setSyncCode] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!syncCode.trim()) return;
    onImportCode(syncCode.trim().toUpperCase());
    setStatusMsg("Sync code applied! Conversation loaded.");
    setTimeout(() => {
      setStatusMsg(null);
      setSyncCode("");
      onClose();
    }, 1200);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onRestoreBackup(file);
      setStatusMsg("Backup restored successfully!");
      setTimeout(() => {
        setStatusMsg(null);
        onClose();
      }, 1500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <span className="font-bold text-slate-800 text-sm">
            Chat Sync & Data Backup
          </span>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-100 bg-slate-50/50">
          <button
            type="button"
            onClick={() => setTab("code")}
            className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-all ${
              tab === "code"
                ? "border-violet-600 text-violet-700 bg-white"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" /> Import Sync Code
          </button>
          <button
            type="button"
            onClick={() => setTab("backup")}
            className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-all ${
              tab === "backup"
                ? "border-violet-600 text-violet-700 bg-white"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <Download className="w-3.5 h-3.5" /> Backup & Restore
          </button>
        </div>

        <div className="p-5">
          {statusMsg && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-medium text-emerald-700 flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>{statusMsg}</span>
            </div>
          )}

          {tab === "code" ? (
            <form onSubmit={handleCodeSubmit} className="space-y-3">
              <label className="text-xs font-semibold text-slate-700 block">
                Enter Friend's Genie Sync Code:
              </label>
              <input
                type="text"
                required
                value={syncCode}
                onChange={(e) => setSyncCode(e.target.value)}
                placeholder="e.g. GENIE-SHARE-BLOOHL"
                className="w-full text-xs font-mono uppercase border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-400"
              />
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Paste the 6-character code your friend shared to load their conversation directly into your active sessions.
              </p>
              <button
                type="submit"
                disabled={!syncCode.trim()}
                className="w-full mt-2 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-semibold transition-all shadow-sm disabled:opacity-50"
              >
                Import Chat Session
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <span className="text-xs font-bold text-slate-700 block">
                  Export Chat Backup
                </span>
                <p className="text-[11px] text-slate-500">
                  Download all your current chat sessions into an encrypted JSON backup file.
                </p>
                <button
                  type="button"
                  onClick={onExportBackup}
                  className="mt-2 w-full flex items-center justify-center gap-2 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition-all shadow-xs"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" /> Download Backup (.json)
                </button>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <span className="text-xs font-bold text-slate-700 block">
                  Restore from File
                </span>
                <p className="text-[11px] text-slate-500">
                  Select a previous `.json` backup file to restore all conversations.
                </p>
                <input
                  type="file"
                  accept=".json"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-2 w-full flex items-center justify-center gap-2 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-semibold transition-all shadow-sm"
                >
                  <Upload className="w-3.5 h-3.5" /> Upload & Restore Backup
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}