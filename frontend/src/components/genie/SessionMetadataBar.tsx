"use client";

import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  Pin,
  Pencil,
  Share2,
  X,
} from "lucide-react";

interface SessionMetadata {
  id: string;
  title: string;
  createdAt: string | Date;
  isArchived?: boolean;
  messages: Array<{ role: string; content: string; timestamp?: string }>;
}

interface SessionMetadataBarProps {
  session: SessionMetadata;
  isObserverOn: boolean;
  onRename: (newTitle: string) => void;
  onShare: () => void;
  onExport: (format: "markdown" | "json") => void;
  onExportDocument: (format: "pdf" | "docx", selectedOnly: boolean) => void;
  onSelectMessages: (format: "pdf" | "docx") => void;
  participantCount: number;
  onArchive: () => void;
  onAutoArchive: () => void;
  onWipeClientCache: () => void;
  onFullEphemeralReset: () => void;
  onForkCurrentMessage: () => void;
  onCloneTranscript: () => void;
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
  participantCount,
  onArchive,
  onAutoArchive,
  onWipeClientCache,
  onFullEphemeralReset,
  onForkCurrentMessage,
  onCloneTranscript,
}: SessionMetadataBarProps) {
  const [isPinned, setIsPinned] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const [isPinPreferenceLoaded, setIsPinPreferenceLoaded] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(session.title);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageGroup, setManageGroup] = useState("");
  const [governanceOpen, setGovernanceOpen] = useState(false);
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
  const manageSections = [
    {
      title: "📦 Archive Session",
      description: "Move the active transcript to read-only storage.",
      items: [
        {
          label: session.isArchived ? "Archived · Read-only" : "Move to Archive",
          description: "Mark this session archived and prevent additional messages.",
          action: onArchive,
          disabled: Boolean(session.isArchived),
        },
        {
          label: "Export & Auto-Archive",
          description: "Download a Markdown copy, then archive this session.",
          action: onAutoArchive,
          disabled: Boolean(session.isArchived),
        },
      ],
    },
    {
      title: "🛡️ Purge & Minimization",
      description: "Clear browser-side state and credentials.",
      items: [
        {
          label: "Wipe Client Cache & Tokens",
          description: "Remove Genie browser cache and sign-in tokens while keeping chat transcripts.",
          action: onWipeClientCache,
        },
        {
          label: "Full Ephemeral Reset",
          description: "Delete local Genie session traces and reset this browser's conversation state.",
          action: onFullEphemeralReset,
        },
      ],
    },
    {
      title: "📋 Branch & Duplicate",
      description: "Create an independent sandbox copy.",
      items: [
        {
          label: "Fork from Current Message",
          description: "Start a new session with the transcript through the latest message.",
          action: onForkCurrentMessage,
        },
        {
          label: "Clone Full Transcript to Sandbox",
          description: "Duplicate the complete transcript into a new session.",
          action: onCloneTranscript,
        },
      ],
    },
    {
      title: "ℹ️ Session Governance & Specs",
      description: "Review usage and session governance details.",
      items: [
        {
          label: "Token Usage & Model Latency",
          description: "Review message counts and whether provider timing is available.",
          action: () => setGovernanceOpen(true),
        },
        {
          label: "Active Security & Encryption Status",
          description: "Review browser storage and archive encryption scope.",
          action: () => setGovernanceOpen(true),
        },
        {
          label: "Room Participant Audit",
          description: "Review the participant count for this session context.",
          action: () => setGovernanceOpen(true),
        },
      ],
    },
  ];
  const managePanel = (mobile: boolean) => (
    <div className={mobile
      ? "space-y-1"
      : "absolute right-0 top-full z-50 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-2 text-slate-700 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    }>
      {manageSections.map((section) => {
        const opened = manageGroup === section.title;
        return (
          <div key={section.title} className="overflow-hidden rounded-xl">
            <button
              type="button"
              onMouseEnter={() => !mobile && setManageGroup(section.title)}
              onClick={() => setManageGroup(opened ? "" : section.title)}
              aria-expanded={opened}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <span>{section.title}</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${opened ? "rotate-180" : ""}`} />
            </button>
            <div className={`grid transition-all duration-200 ${opened ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
              <div className="overflow-hidden">
                {section.items.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    title={item.description}
                    disabled={
                      ("disabled" in item && item.disabled) ||
                      (isObserverOn && !["Token Usage & Model Latency", "Active Security & Encryption Status", "Room Participant Audit"].includes(item.label))
                    }
                    onClick={() => {
                      setManageOpen(false);
                      item.action();
                    }}
                    className="block w-full rounded-lg px-4 py-2 text-left text-xs hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-indigo-950/50"
                  >
                    <span className="block font-semibold">{item.label}</span>
                    <span className="mt-0.5 block text-[10px] font-normal text-slate-500 dark:text-slate-400">{item.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

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
      <div className="relative">
        {!session.isArchived && <button
          type="button"
          onClick={() => {
            setManageOpen((open) => !open);
            setManageGroup("");
          }}
          aria-expanded={manageOpen}
          aria-haspopup="menu"
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-bold text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300"
        >
          Manage <ChevronDown className={`h-3.5 w-3.5 transition-transform ${manageOpen ? "rotate-180" : ""}`} />
        </button>}
        {manageOpen && <div className="hidden sm:block">{managePanel(false)}</div>}
      </div>
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
              {session.isArchived && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">Archived · Read-only</span>}
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
        <div className="mx-auto w-full max-w-3xl px-4 sm:mr-16">
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

      {manageOpen && (
        <div className="fixed inset-0 z-[100] flex items-end bg-slate-950/50 p-0 backdrop-blur-sm sm:hidden" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setManageOpen(false);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="session-manage-title" style={{ animation: "genieSheetUp 180ms ease-out" }} className="max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 id="session-manage-title" className="text-base font-bold">Manage Session</h3>
                <p className="max-w-[75vw] truncate text-xs text-slate-500">{session.title}</p>
              </div>
              <button type="button" onClick={() => setManageOpen(false)} aria-label="Close session management" className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
            </div>
            {managePanel(true)}
          </section>
        </div>
      )}

      {governanceOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setGovernanceOpen(false);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="session-governance-title" className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="session-governance-title" className="text-base font-bold">Session Governance &amp; Specs</h3>
                <p className="mt-1 truncate text-xs text-slate-500">{session.title}</p>
              </div>
              <button type="button" onClick={() => setGovernanceOpen(false)} aria-label="Close governance details" className="rounded-full p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
                <h4 className="text-xs font-bold">Usage &amp; latency</h4>
                <p className="mt-1 text-[11px] text-slate-500">{session.messages.length} messages · provider token and latency telemetry is not available for this local session.</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
                <h4 className="text-xs font-bold">Security &amp; encryption</h4>
                <p className="mt-1 text-[11px] text-slate-500">Browser session data stays in this profile. Client-side archive encryption applies to encrypted vault snapshots.</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800 sm:col-span-2">
                <h4 className="text-xs font-bold">Participant audit</h4>
                <p className="mt-1 text-[11px] text-slate-500">{participantCount} current room participant{participantCount === 1 ? "" : "s"}. This personal session has no participant-level activity log.</p>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
