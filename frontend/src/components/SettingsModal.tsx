"use client";

import React, { useEffect, useState } from "react";
import { X, Settings, Key, ExternalLink, GraduationCap, Briefcase, Check, Eye, EyeOff, CircleHelp, ShieldCheck } from "lucide-react";
import { Download, FileUp } from "lucide-react";

interface SettingsUserProfile {
  name: string;
  email: string;
  avatarUrl: string;
  role: "student" | "professional";
  ageGroup: string;
  customApiKey: string;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: SettingsUserProfile;
  onSaveProfile: (profile: SettingsUserProfile) => void;
  onAuthorizeBackupExport?: () => Promise<boolean>;
}

export default function SettingsModal({
  isOpen,
  onClose,
  userProfile,
  onSaveProfile,
  onAuthorizeBackupExport,
}: SettingsModalProps) {
  const [role, setRole] = useState<"student" | "professional">(userProfile.role);
  const [ageGroup, setAgeGroup] = useState(userProfile.ageGroup);
  const [apiKey, setApiKey] = useState(userProfile.customApiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [byokHelpOpen, setByokHelpOpen] = useState(false);
  const [byokStorageError, setByokStorageError] = useState<string | null>(null);
  const [backupExportError, setBackupExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      try {
        setApiKey(localStorage.getItem("genie_user_byok_key") || "");
        setByokStorageError(null);
      } catch (error) {
        console.error("The device BYOK key could not be read:", error);
        setByokStorageError("Browser storage is unavailable. Your API key cannot be saved on this device.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (apiKey.trim()) localStorage.setItem("genie_user_byok_key", apiKey.trim());
      else localStorage.removeItem("genie_user_byok_key");
      setByokStorageError(null);
    } catch (error) {
      console.error("The BYOK key could not be saved to this device:", error);
      setByokStorageError("The API key could not be saved in browser storage.");
      return;
    }
    onSaveProfile({
      ...userProfile,
      role,
      ageGroup,
      customApiKey: "",
    });
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-fade">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-purple-100 rounded-xl text-purple-700">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Genie Workspace Preferences</h3>
              <p className="text-[11px] text-slate-400">Configure profile, persona, and API keys</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        {savedSuccess ? (
          <div className="p-8 text-center text-sm font-semibold text-emerald-600 flex flex-col items-center gap-2">
            <Check className="w-8 h-8 text-emerald-500 bg-emerald-50 p-1.5 rounded-full" />
            <span>Preferences saved successfully!</span>
          </div>
        ) : (
          <form onSubmit={handleSave} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
            {/* Account Card */}
            <div className="flex items-center gap-3 p-3 bg-purple-50/50 border border-purple-100 rounded-2xl">
              <img
                src={userProfile.avatarUrl}
                alt={userProfile.name}
                className="w-12 h-12 rounded-full object-cover border-2 border-purple-300 shadow-sm"
              />
              <div className="flex-1 min-w-0">
                <span className="font-bold text-sm text-slate-800 block truncate">{userProfile.name}</span>
                <span className="text-xs text-slate-500 block truncate">{userProfile.email}</span>
                <span className="text-[10px] text-pink-600 font-semibold uppercase tracking-wider">
                  Google Workspace Connected
                </span>
              </div>
            </div>
                    {/* Backup & Restore Utility */}
        <div className="p-3 bg-white border border-slate-200 rounded-2xl space-y-2 mt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800">
              Chat Vault & Backup Safeguard
            </span>
            <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-semibold border border-emerald-200">
              Auto-Persist Active
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            Export chat history to a JSON file or restore an earlier backup.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={!onAuthorizeBackupExport}
              title={!onAuthorizeBackupExport ? "Export disabled by room policy" : "Export chat backup"}
              onClick={async () => {
                try {
                  if (!onAuthorizeBackupExport) return;
                  if (!(await onAuthorizeBackupExport())) return;
                  const stored = localStorage.getItem("genie_chat_sessions_v2") || localStorage.getItem("genie_chat_sessions");
                  const blob = new Blob([stored || "[]"], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `Genie_Backup_${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  setBackupExportError(null);
                } catch (error) {
                  console.error("Backup export authorization failed:", error);
                  setBackupExportError("Backup export failed or is not authorized for this room.");
                }
              }}
              className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Backup</span>
            </button>

            <label className="flex-1 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer">
              <FileUp className="w-3.5 h-3.5" />
              <span>Restore Backup</span>
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      try {
                        const content = event.target?.result as string;
                        localStorage.setItem("genie_chat_sessions_v2", content);
                        alert("Backup restored! Reloading application...");
                        window.location.reload();
                      } catch {
                        alert("Invalid backup file.");
                      }
                    };
                    reader.readAsText(file);
                  }
                }}
              />
            </label>
          </div>
          {backupExportError && <p role="alert" className="text-[10px] text-rose-700">{backupExportError}</p>}
        </div>

            {/* Persona Switch: Student vs Professional */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Workflow Persona</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRole("student")}
                  className={`flex items-center justify-center gap-2 p-3 rounded-2xl border text-xs font-semibold transition-all ${
                    role === "student"
                      ? "border-purple-600 bg-purple-50 text-purple-700 shadow-sm"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <GraduationCap className="w-4 h-4 text-purple-600" />
                  <span>Student Mode</span>
                </button>

                <button
                  type="button"
                  onClick={() => setRole("professional")}
                  className={`flex items-center justify-center gap-2 p-3 rounded-2xl border text-xs font-semibold transition-all ${
                    role === "professional"
                      ? "border-purple-600 bg-purple-50 text-purple-700 shadow-sm"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Briefcase className="w-4 h-4 text-purple-600" />
                  <span>Professional Pro</span>
                </button>
              </div>
            </div>

            {/* Age Category Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Age Demographic</label>
              <select
                value={ageGroup}
                onChange={(e) => setAgeGroup(e.target.value)}
                className="w-full text-xs font-medium border border-slate-200 rounded-xl p-2.5 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-400"
              >
                <option value="teen">Under 18 (School & Foundational)</option>
                <option value="college">18 – 24 (University / Early Career)</option>
                <option value="pro">25 – 45 (Working Professional / Enterprise)</option>
                <option value="senior">45+ (Executive & Senior Leadership)</option>
              </select>
            </div>

            {/* BYOK / API Key Purchase Hub */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Key className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-bold text-slate-800">Bring Your Own Key (BYOK)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] font-semibold text-purple-700 hover:underline"
                  >
                    <span>Get Gemini API Key</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <button
                    type="button"
                    onClick={() => setByokHelpOpen((open) => !open)}
                    aria-label="BYOK and room privacy guidance"
                    aria-expanded={byokHelpOpen}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-purple-300 text-[11px] font-bold text-purple-700 hover:bg-purple-100"
                  >
                    <CircleHelp className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {byokHelpOpen && (
                <aside className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-[10px] leading-relaxed text-slate-700" aria-label="BYOK privacy guidance">
                  <h4 className="mb-1 font-bold text-slate-900">Personal Mode</h4>
                  <ul className="list-disc space-y-1 pl-4">
                    <li>Your key is stored in this browser and is not included in profile sync or Genie application logs. It is transmitted over HTTPS to Genie for request processing and forwarded to Google; Google bills usage and applies its quota/terms. Genie is not responsible for provider charges.</li>
                    <li>Room owners control whether invitees see earlier history. Export is unavailable to invited guests in multi-user Personal Mode.</li>
                    <li>Only the Room Owner may save a Personal Mode voice-call log.</li>
                  </ul>
                  <h4 className="mb-1 mt-2 font-bold text-slate-900">Workspace Mode</h4>
                  <ul className="list-disc space-y-1 pl-4">
                    <li>Server Genie uses platform-managed quota. BYOK requests use your organization&apos;s Google Cloud billing account; the key remains hidden from workspace members.</li>
                    <li>Workspace Origin Admin provisions history and export permissions before inviting members. Voice logs are saved to the workspace; only its Origin Admin may export or share them.</li>
                  </ul>
                  <p className="mt-2 border-t border-indigo-200 pt-2">
                    Local storage is device/browser scoped, not encrypted vault storage. Revoking a key here removes this browser copy; also revoke it in Google AI Studio to invalidate it.
                  </p>
                </aside>
              )}

              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={apiKey ? "••••••••" : "Paste provider API key"}
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-10 font-mono text-xs text-slate-800 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-200"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((visible) => !visible)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-800"
                  aria-label={showApiKey ? "Hide API key" : "Show API key"}
                  aria-pressed={showApiKey}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[10px] text-slate-400 leading-normal">
                The key is saved only in this browser. Google usage is billed to your account and follows Google&apos;s quota and terms.
              </p>
              {byokStorageError && <p role="alert" className="text-[10px] font-medium text-rose-600">{byokStorageError}</p>}
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.removeItem("genie_user_byok_key");
                    setApiKey("");
                    setByokStorageError(null);
                  } catch (error) {
                    console.error("The BYOK key could not be revoked from this device:", error);
                    setByokStorageError("The API key could not be removed from browser storage.");
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-50"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Revoke key on this device
              </button>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl transition-all shadow-sm"
              >
                Save Changes
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
