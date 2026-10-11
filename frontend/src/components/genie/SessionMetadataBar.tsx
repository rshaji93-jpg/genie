"use client";

import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  Pin,
  Pencil,
  Share2,
  Trash2,
  X,
} from "lucide-react";

interface SessionMetadata {
  id: string;
  title: string;
  createdAt: string | Date;
}

interface SessionMetadataBarProps {
  session: SessionMetadata;
  isObserverOn: boolean;
  onRename: (newTitle: string) => void;
  onShare: () => void;
  onExport: (format: "markdown" | "json") => void;
  onExportDocument: (format: "pdf" | "docx", selectedOnly: boolean) => void;
  onSelectMessages: (format: "pdf" | "docx") => void;
  onDelete: () => void;
}

const PIN_STORAGE_KEY = "genie_session_bar_pinned";

function relativeAge(createdAt: string | Date): string {
  const elapsed = Math.max(0, Date.now() - new Date(createdAt).getTime());
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) {
    const minutes = Math.floor(elapsed / 60_000);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  if (elapsed < 86_400_000) {
    const hours = Math.floor(elapsed / 3_600_000);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const days = Math.floor(elapsed / 86_400_000);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export default function SessionMetadataBar({
  session,
  isObserverOn,
  onRename,
  onShare,
  onExport,
  onExportDocument,
  onSelectMessages,
  onDelete,
}: SessionMetadataBarProps) {
  const [isPinned, setIsPinned] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const [isPinPreferenceLoaded, setIsPinPreferenceLoaded] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(session.title);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [documentMenuOpen, setDocumentMenuOpen] = useState<"pdf" | "docx" | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        setIsPinned(localStorage.getItem(PIN_STORAGE_KEY) === "true");
      } catch (error) {
        console.warn("Session bar pin preference could not be loaded:", error);
      } finally {
        setIsPinPreferenceLoaded(true);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!isPinPreferenceLoaded) return;
    try {
      localStorage.setItem(PIN_STORAGE_KEY, String(isPinned));
    } catch (error) {
      console.warn("Session bar pin preference could not be saved:", error);
    }
  }, [isPinned, isPinPreferenceLoaded]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function saveRename() {
    const title = renameDraft.trim();
    if (!title) {
      setRenameDraft(session.title);
      setIsRenaming(false);
      return;
    }
    if (title !== session.title) onRename(title);
    setIsRenaming(false);
  }

  function handleShare() {
    onShare();
    setToast("Share options opened");
  }

  function handleExport(format: "markdown" | "json") {
    onExport(format);
    setExportMenuOpen(false);
    setToast(`Transcript exported as ${format.toUpperCase()}`);
  }

  function handleDocumentExport(format: "pdf" | "docx", selectedOnly: boolean) {
    onExportDocument(format, selectedOnly);
    setDocumentMenuOpen(null);
    setExportMenuOpen(false);
    if (selectedOnly) onSelectMessages(format);
  }

  const createdDate = new Date(session.createdAt);
  const formattedDate = `${createdDate.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })} • ${createdDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const expanded = isPinned || isHovered;

  const actions = (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={handleShare}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/70 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-indigo-950/50"
      >
        <Share2 className="h-3.5 w-3.5" />
        Share
      </button>
      <div className="relative">
        <button
          type="button"
          onClick={() => setExportMenuOpen((open) => !open)}
          aria-expanded={exportMenuOpen}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/70 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Download className="h-3.5 w-3.5" />
          Export
          <ChevronDown className="h-3 w-3" />
        </button>
        {exportMenuOpen && (
          <div className="absolute right-0 top-full z-40 mt-1 w-48 overflow-visible rounded-xl border border-slate-200 bg-white p-1 text-slate-700 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
            <div className="relative">
              <button type="button" onClick={() => setDocumentMenuOpen((open) => open === "pdf" ? null : "pdf")} className="w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800">
                Export as PDF (.pdf) <span className="float-right">›</span>
              </button>
              {documentMenuOpen === "pdf" && (
                <div className="absolute right-full top-0 mr-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  <button type="button" onClick={() => handleDocumentExport("pdf", false)} className="w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800">All Messages (Full Transcript)</button>
                  <button type="button" onClick={() => handleDocumentExport("pdf", true)} className="w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800">Select Messages...</button>
                </div>
              )}
            </div>
            <div className="relative">
              <button type="button" onClick={() => setDocumentMenuOpen((open) => open === "docx" ? null : "docx")} className="w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800">
                Export as Word (.doc) <span className="float-right">›</span>
              </button>
              {documentMenuOpen === "docx" && (
                <div className="absolute right-full top-0 mr-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  <button type="button" onClick={() => handleDocumentExport("docx", false)} className="w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800">All Messages (Full Transcript)</button>
                  <button type="button" onClick={() => handleDocumentExport("docx", true)} className="w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800">Select Messages...</button>
                </div>
              )}
            </div>
            <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
            <button type="button" onClick={() => handleExport("markdown")} className="w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800">
              Markdown (.md)
            </button>
            <button type="button" onClick={() => handleExport("json")} className="w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800">
              JSON (.json)
            </button>
          </div>
        )}
      </div>
      {!isObserverOn && (
        <button
          type="button"
          onClick={() => setShowDeleteConfirmation(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 dark:text-slate-300 dark:hover:bg-rose-950/40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      )}
      <button
        type="button"
        onClick={() => setIsPinned((pinned) => !pinned)}
        aria-pressed={isPinned}
        title={isPinned ? "Unpin session bar" : "Pin session bar"}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
          isPinned
            ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300"
            : "border-slate-200/70 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        }`}
      >
        <Pin className={`h-3.5 w-3.5 transition-transform ${isPinned ? "-rotate-45" : ""}`} />
        {isPinned ? "Pinned" : "Pin"}
      </button>
    </div>
  );

  const details = (
    <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 items-center gap-1.5">
        {isRenaming ? (
          <form
            className="flex min-w-0 items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              saveRename();
            }}
          >
            <input
              autoFocus
              maxLength={120}
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setRenameDraft(session.title);
                  setIsRenaming(false);
                }
              }}
              aria-label="Session title"
              className="min-w-0 rounded-md border border-indigo-300 bg-white px-2 py-1 text-sm font-semibold text-slate-800 outline-none ring-2 ring-indigo-100 dark:bg-slate-950 dark:text-slate-100"
            />
            <button type="submit" title="Save title" className="rounded p-1 text-emerald-600 hover:bg-emerald-50">
              <Check className="h-4 w-4" />
            </button>
            <button type="button" title="Cancel rename" onClick={() => { setRenameDraft(session.title); setIsRenaming(false); }} className="rounded p-1 text-slate-400 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <>
            <h2 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{session.title}</h2>
            <button
              type="button"
              onClick={() => {
                setRenameDraft(session.title);
                setIsRenaming(true);
              }}
              title="Rename session"
              aria-label="Rename session"
              className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-slate-800"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <time dateTime={createdDate.toISOString()}>📅 {formattedDate}</time>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {relativeAge(createdDate)}
        </span>
      </div>
    </div>
  );

  return (
    <>
      <div
        className="sticky top-0 z-20 w-full pt-2"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="mx-auto w-full max-w-3xl px-4">
          <div className="hidden sm:block">
            <div
              className={`transition-all duration-200 ${
                expanded
                  ? "max-h-40 translate-y-0 overflow-visible opacity-100"
                  : "max-h-1 -translate-y-1 overflow-hidden opacity-100"
              }`}
            >
              {expanded ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white/70 px-3.5 py-1.5 text-xs text-slate-600 shadow-xs backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
                  {details}
                  {actions}
                </div>
              ) : (
                <div className="h-1 rounded-full bg-gradient-to-r from-indigo-400/70 via-violet-400/60 to-cyan-400/70" aria-label="Session quick actions; hover to expand" />
              )}
            </div>
          </div>

          <div className="sm:hidden">
            <button
              type="button"
              onClick={() => setIsMobileExpanded((expandedMobile) => !expandedMobile)}
              aria-expanded={isMobileExpanded}
              className="flex w-full items-center justify-between rounded-full border border-slate-200/70 bg-white/85 px-3 py-2 text-left shadow-sm backdrop-blur-md dark:border-slate-800/70 dark:bg-slate-900/85"
            >
              <span className="truncate text-xs font-medium text-slate-600 dark:text-slate-300">{formattedDate}</span>
              <ChevronDown className={`ml-2 h-4 w-4 shrink-0 text-slate-500 transition-transform ${isMobileExpanded ? "rotate-180" : ""}`} />
            </button>
            <div
              className={`rounded-2xl border-slate-200/60 bg-white/90 backdrop-blur-md transition-all duration-200 dark:border-slate-800/60 dark:bg-slate-900/90 ${
                isMobileExpanded ? "mt-2 max-h-[32rem] overflow-visible border p-3 opacity-100" : "max-h-0 overflow-hidden border-0 p-0 opacity-0"
              }`}
            >
              <div className="mb-3">{details}</div>
              {actions}
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div role="status" className="fixed bottom-24 left-1/2 z-[90] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white shadow-lg">
          {toast}
        </div>
      )}

      {showDeleteConfirmation && !isObserverOn && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="session-delete-title" className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <h3 id="session-delete-title" className="text-base font-bold text-slate-900 dark:text-white">Delete this session?</h3>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">“{session.title}” will be moved to Recently Deleted.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowDeleteConfirmation(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button type="button" onClick={() => { setShowDeleteConfirmation(false); if (!isObserverOn) onDelete(); }} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700">
                Delete session
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
