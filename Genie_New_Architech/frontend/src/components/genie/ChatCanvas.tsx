"use client";

import {
  Check,
  CheckCheck,
  Copy,
  Globe2,
  LockKeyhole,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ArrowActionToolbar from "@/modules/messages_arrows/ArrowActionToolbar";
import InlineMessageEditor from "@/modules/messages_arrows/InlineMessageEditor";
import MessageInfoLedgerModal from "@/modules/messages_arrows/MessageInfoLedgerModal";
import IdealGLogo from "@/modules/brand/IdealGLogo";
import type { ReactNode } from "react";

export type TickStatus = "sent" | "delivered" | "read_no_ai" | "yellow_no_ai" | "ai_review_active" | "ai_verified";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  is_secret?: boolean;
  chat_mode?: "ai_room" | "friends_only" | "private_ai";
  attachment?: { mime_type: string; data: string };
  tick_status?: TickStatus;
  sent_at?: string;
  delivered_at?: string | null;
  read_at?: string | null;
  review_at?: string | null;
  verified_at?: string | null;
  review_triggered_by?: string;
  triggered_by?: string;
  tokens_burned?: number;
  review_cost?: number;
  breakdown?: string;
  review_breakdown?: string;
  ai_reply?: string;
  verified_by?: string;
  sender_name?: string;
  updated_at?: string | null;
  is_edited?: boolean;
  read_receipts?: { user_sub: string; user_name: string; read_at: string }[];
  sender_sub?: string;
  ledger_error?: string;
  is_group_shared_ai_response?: boolean;
  owner_sub?: string;
  sub_agents?: string[];
}

interface ChatCanvasProps {
  messages: ChatMessage[];
  loading: boolean;
  activeRoom: boolean;
  mySub: string;
  onReview: (messageId: string) => void;
  onVerify: (messageId: string) => void;
  onRefine: (messageId: string) => void;
  onQuote?: (message: ChatMessage) => void;
  onForward?: (message: ChatMessage) => void;
  onReferToGenie?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage, content: string) => void;
  onLoadLedger?: (messageId: string) => Promise<Partial<ChatMessage>>;
  reactionCounts?: Record<string, Record<string, number>>;
  onReact?: (message: ChatMessage, target: "user_message" | "ai_response", emoji: string) => void;
  onReadAloud?: (message: ChatMessage) => void;
  onCopyResponse?: (message: ChatMessage) => void;
  onRegenerateResponse?: (message: ChatMessage) => void;
  onRetryResponse?: (message: ChatMessage) => void;
  onToggleResponseVisibility?: (message: ChatMessage) => void;
  selectionMode: boolean;
  selectedMessageIds: string[];
  onEnterMessageSelection: (messageId?: string) => void;
  onToggleMessageSelection: (messageId: string) => void;
  onSelectAllMessages: () => void;
  onCancelMessageSelection: () => void;
  onDeleteSelectedMessages: () => void;
  children: React.ReactNode;
}

const tickClass: Record<TickStatus, string> = {
  sent: "tick-gray",
  delivered: "tick-gray",
  read_no_ai: "tick-yellow",
  yellow_no_ai: "tick-yellow",
  ai_review_active: "tick-red",
  ai_verified: "tick-green",
};

function inlineMarkdown(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g).map((part, index) => {
    if (part.startsWith("**") || part.startsWith("__")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code className="inline-code" key={index}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function MarkdownContent({ content }: { content: string }) {
  const [copiedBlock, setCopiedBlock] = useState<number | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  async function copyCode(code: string, blockId: number) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedBlock(blockId);
      setCopyFailed(false);
      if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopiedBlock(null), 2000);
    } catch {
      setCopyFailed(true);
    }
  }

  function downloadCode(code: string, language: string) {
    const extensions: Record<string, string> = {
      py: "py", python: "py", python3: "py", js: "js", javascript: "js", jsx: "js",
      ts: "ts", typescript: "ts", tsx: "ts", sh: "sh", bash: "sh", shell: "sh", json: "json",
    };
    const extension = extensions[language.toLowerCase()] || "txt";
    const url = URL.createObjectURL(new Blob([code], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `genie-code.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => () => {
    if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
  }, []);

  while (index < lines.length) {
    const line = lines[index] || "";
    const fence = line.match(/^\s*```([\w+-]*)\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] || "")) {
        codeLines.push(lines[index] || "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      const code = codeLines.join("\n");
      const blockId = key;
      blocks.push(
        <div className="code-card" key={key++}>
          <div className="code-card-header">
            <span>{fence[1] || "text"}</span>
            <div>
              <button onClick={() => void copyCode(code, blockId)} type="button">
                {copiedBlock === blockId ? "✓ Copied" : copyFailed ? "Copy failed" : "📋 Copy"}
              </button>
              <button onClick={() => downloadCode(code, fence[1] || "")} type="button">⬇️ Download</button>
            </div>
          </div>
          <pre><code>{code}</code></pre>
        </div>,
      );
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const Heading = (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[level - 1];
      blocks.push(<Heading className="markdown-heading" key={key++}>{inlineMarkdown(heading[2])}</Heading>);
      index += 1;
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] || "").match(/^\s*[-*+]\s+(.+)$/);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      blocks.push(<ul className="markdown-list" key={key++}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ul>);
      continue;
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (numbered) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] || "").match(/^\s*\d+[.)]\s+(.+)$/);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      blocks.push(<ol className="markdown-list" key={key++}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ol>);
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && (lines[index] || "").trim() && !/^\s*(?:```|#{1,6}\s|[-*+]\s|\d+[.)]\s)/.test(lines[index] || "")) {
      paragraph.push(lines[index] || "");
      index += 1;
    }
    if (!paragraph.length) {
      paragraph.push(line);
      index += 1;
    }
    blocks.push(<p key={key++}>{paragraph.map((text, lineIndex) => <span key={lineIndex}>{lineIndex > 0 && <br />}{inlineMarkdown(text)}</span>)}</p>);
  }
  return <div className="markdown-content">{blocks}</div>;
}

function Tick({ status }: { status: TickStatus }) {
  const double = status !== "sent";
  return (
    <span className={`message-tick ${tickClass[status]}`} title={status.replaceAll("_", " ")}>
      {double ? <CheckCheck size={15} /> : <Check size={15} />}
    </span>
  );
}

export default function ChatCanvas(props: ChatCanvasProps) {
  const [auditMessage, setAuditMessage] = useState<ChatMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeActionsId, setActiveActionsId] = useState<string | null>(null);
  const [actionsPosition, setActionsPosition] = useState<{ x: number; y: number } | null>(null);
  const longPressTimer = useRef<number | undefined>(undefined);
  const longPressTriggered = useRef(false);

  useEffect(() => {
    const closeOnOutside = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".message-actions-popover")) return;
      setActiveActionsId(null);
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveActionsId(null);
      if (event.target instanceof Element && event.target.closest(".omni-composer")) setActiveActionsId(null);
    };
    const closeOnComposerFocus = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.closest(".omni-composer")) setActiveActionsId(null);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("touchstart", closeOnOutside);
    document.addEventListener("keydown", closeOnKeyDown);
    document.addEventListener("focusin", closeOnComposerFocus);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("touchstart", closeOnOutside);
      document.removeEventListener("keydown", closeOnKeyDown);
      document.removeEventListener("focusin", closeOnComposerFocus);
    };
  }, []);

  async function openLedger(message: ChatMessage) {
    try {
      const details = props.onLoadLedger ? await props.onLoadLedger(message.id) : {};
      setAuditMessage({ ...message, ...details });
    } catch (error) {
      setAuditMessage({
        ...message,
        ledger_error: error instanceof Error ? error.message : "Message ledger could not be loaded.",
      });
    }
  }

  return (
    <main className="chat-canvas">
      <div className="canvas-topline">
        <div className="canvas-heading">
          <span className="eyebrow">{props.activeRoom ? "ENCRYPTED ROOM" : "PERSONAL WORKSPACE"}</span>
          <h1>{props.activeRoom ? "Room conversation" : "Good to see you."}</h1>
        </div>
      </div>
      <section className="message-scroll" aria-live="polite">
        {!props.messages.length && (
          <div className="welcome-card">
            <div className="welcome-sparkle"><IdealGLogo size={42} /></div>
            <h2>What would you like to work on?</h2>
            <p>Ask Genie, share an encrypted room message, or use Secret mode for content that never leaves this device for AI.</p>
          </div>
        )}
        {props.messages.map((message) => {
          const status = message.tick_status || "sent";
          const hasReview = Boolean(message.ai_reply);
          const reactionTarget = message.role === "user" ? "user_message" : "ai_response";
          const counts = props.reactionCounts?.[`${reactionTarget}:${message.id}`];
          const canVerify = message.review_triggered_by === props.mySub && status === "ai_review_active";
          const retryOnly = message.role === "assistant" && /failed to fetch|\b405\b/i.test(message.content);
          return (
            <article
              className={`message-row ${message.role === "user" ? "user-row" : "assistant-row"} ${props.selectionMode ? "message-row-selecting" : ""}`}
              key={message.id}
            >
              {props.selectionMode && (
                <input
                  aria-label={`Select message from ${message.sender_name || message.role}`}
                  checked={props.selectedMessageIds.includes(message.id)}
                  className="message-selection-checkbox"
                  disabled={props.activeRoom && message.sender_sub !== props.mySub && message.owner_sub !== props.mySub}
                  onChange={() => props.onToggleMessageSelection(message.id)}
                  type="checkbox"
                />
              )}
              <div
                className={`message-bubble ${message.role === "user" ? "user-bubble" : "assistant-bubble"} ${message.is_secret ? "secret-bubble" : ""}`}
                onPointerDown={() => {
                  longPressTriggered.current = false;
                  if (props.selectionMode) return;
                  longPressTimer.current = window.setTimeout(() => {
                    longPressTriggered.current = true;
                    setActiveActionsId(null);
                    props.onEnterMessageSelection(
                      !props.activeRoom || message.sender_sub === props.mySub || message.owner_sub === props.mySub
                        ? message.id
                        : undefined,
                    );
                  }, 500);
                }}
                onPointerUp={() => window.clearTimeout(longPressTimer.current)}
                onPointerCancel={() => window.clearTimeout(longPressTimer.current)}
                onPointerLeave={() => window.clearTimeout(longPressTimer.current)}
                onClick={(event) => {
                  if (longPressTriggered.current) {
                    longPressTriggered.current = false;
                    return;
                  }
                  if (
                    props.selectionMode
                    && !(event.target instanceof Element && event.target.closest("button,input,audio,a"))
                    && (!props.activeRoom || message.sender_sub === props.mySub || message.owner_sub === props.mySub)
                  ) {
                    props.onToggleMessageSelection(message.id);
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setActiveActionsId(message.id);
                  setActionsPosition({ x: event.clientX, y: event.clientY });
                }}
              >
                {message.is_secret && <div className="secret-label">🔒 Secret · not sent to AI</div>}
                {message.chat_mode === "friends_only" && <div className="friends-e2ee-badge">🛡️ Friends E2EE</div>}
                {message.role === "assistant" && message.chat_mode === "private_ai" && !message.is_group_shared_ai_response && (
                  <div className="private-response-badge">🔒 Only You</div>
                )}
                {message.role === "assistant" && Boolean(message.sub_agents?.length) && (
                  <details className="sub-agent-row">
                    <summary><Sparkles size={13} /> {message.sub_agents?.length} collaborators</summary>
                    <div className="sub-agent-badges">
                      {message.sub_agents?.map((agent) => <span key={agent}>{agent}</span>)}
                    </div>
                  </details>
                )}
                {message.attachment?.mime_type.startsWith("audio/") ? (
                  <audio controls src={`data:${message.attachment.mime_type};base64,${message.attachment.data}`} />
                ) : message.attachment?.mime_type.startsWith("image/") ? (
                  <img className="message-image" src={`data:${message.attachment.mime_type};base64,${message.attachment.data}`} alt="Attached to this message" />
                ) : null}
                {editingId === message.id ? (
                  <InlineMessageEditor
                    initialText={message.content}
                    onSave={(content) => { props.onEdit?.(message, content); setEditingId(null); }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : message.content ? <MarkdownContent content={message.content} /> : null}
                <div className="message-meta">
                  {message.sender_name && <span>{message.sender_name}</span>}
                  <time>{message.sent_at ? new Date(message.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Now"}</time>
                  {message.is_edited && <span>Edited {message.updated_at ? new Date(message.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>}
                  {message.role === "user" && (
                    <button className="tick-button" onClick={() => void openLedger(message)} aria-label="Show timestamp and status audit">
                      <Tick status={status} />
                    </button>
                  )}
                  {message.role === "assistant" && message.tick_status === "yellow_no_ai" && <span>Local only</span>}
                </div>
                <div
                  className={`message-actions-popover ${activeActionsId === message.id ? "message-actions-visible" : ""}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  style={activeActionsId === message.id && actionsPosition ? {
                    left: Math.max(8, Math.min(actionsPosition.x, window.innerWidth - 300)),
                    top: Math.max(8, Math.min(actionsPosition.y, window.innerHeight - 56)),
                  } : undefined}
                >
                  <ArrowActionToolbar
                    messageRole={message.role}
                    onQuote={() => { setActiveActionsId(null); props.onQuote?.(message); }}
                    onForward={() => { setActiveActionsId(null); props.onForward?.(message); }}
                    onReferToGenie={() => { setActiveActionsId(null); props.onReferToGenie?.(message); }}
                    onInfo={() => { setActiveActionsId(null); void openLedger(message); }}
                    onEdit={() => {
                      if (message.role === "user" && (!message.sender_sub || message.sender_sub === props.mySub)) {
                        setEditingId(message.id);
                      }
                      setActiveActionsId(null);
                    }}
                  />
                </div>
              </div>
              {retryOnly && (
                <button className="message-retry-button" onClick={() => (props.onRetryResponse || props.onRegenerateResponse)?.(message)} type="button">
                  <RefreshCw size={14} /> Retry
                </button>
              )}
              {message.role === "assistant" && !retryOnly && (
                <div className="ai-response-toolbar" aria-label="AI response actions">
                  <button type="button" onClick={() => props.onReadAloud?.(message)} title="Read this response aloud" aria-label="Read this response aloud"><Volume2 size={15} /></button>
                  <button type="button" onClick={() => props.onCopyResponse?.(message)} title="Copy response" aria-label="Copy response"><Copy size={15} /></button>
                  <button
                    type="button"
                    disabled={props.activeRoom && message.sender_sub !== props.mySub}
                    onClick={() => props.onRegenerateResponse?.(message)}
                    title={!props.activeRoom || message.sender_sub === props.mySub ? "Regenerate response" : "Only the response owner can regenerate it"}
                    aria-label="Regenerate response"
                  ><RefreshCw size={15} /></button>
                  {message.chat_mode === "friends_only" ? (
                    <span className="friends-e2ee-badge">🛡️ Friends E2EE</span>
                  ) : (
                    <button
                      className={`response-visibility-pill ${message.is_group_shared_ai_response ? "response-shared" : "response-private"}`}
                      type="button"
                      disabled={!props.activeRoom || message.sender_sub !== props.mySub || !props.onToggleResponseVisibility}
                      onClick={() => props.onToggleResponseVisibility?.(message)}
                      title={message.is_group_shared_ai_response ? "Hide this response from the room" : "Share this response with the room"}
                      aria-label={message.is_group_shared_ai_response ? "Shared; click to hide from room" : "Only you; click to share with room"}
                    >
                      {message.is_group_shared_ai_response ? <><Globe2 size={14} /> Shared</> : <><LockKeyhole size={14} /> Only You · Share</>}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!props.activeRoom}
                    onClick={() => props.onReact?.(message, "ai_response", "👍")}
                    aria-label="Like AI response"
                  ><ThumbsUp size={15} /> {counts?.["👍"] || 0}</button>
                  <button
                    type="button"
                    disabled={!props.activeRoom}
                    onClick={() => props.onReact?.(message, "ai_response", "👎")}
                    aria-label="Dislike AI response"
                  ><ThumbsDown size={15} /> {counts?.["👎"] || 0}</button>
                </div>
              )}
              {props.activeRoom && !message.is_secret && (message.role === "user" || message.is_group_shared_ai_response) && (
                <div className="message-reaction-bar" aria-label="Message reactions">
                  {["👍", "❤️", "😂", "🎉"].map((emoji) => (
                    <button
                      type="button"
                      key={emoji}
                      onClick={() => props.onReact?.(
                        message,
                        message.role === "user" ? "user_message" : "ai_response",
                        emoji,
                      )}
                      aria-label={`React with ${emoji}`}
                    >
                      {emoji}                       <span>{counts?.[emoji] || 0}</span>
                    </button>
                  ))}
                </div>
              )}
              {props.activeRoom && message.role === "user" && (status === "read_no_ai" || status === "yellow_no_ai") && !hasReview && !message.is_secret && (
                <button className="message-action review-action" onClick={() => props.onReview(message.id)}>
                  <Sparkles size={14} /> Review with AI
                </button>
              )}
              {hasReview && (
                <div className="review-card">
                  <div className="review-card-header"><Sparkles size={15} /> Genie Master review <Tick status={status} /></div>
                  <p>{message.ai_reply}</p>
                  <div className="review-card-footer">
                    {canVerify ? (
                      <>
                        <span>Satisfied?</span>
                        <button className="verify-button" onClick={() => props.onVerify(message.id)}><Check size={14} /> Yes, satisfied</button>
                        <button className="refine-button" onClick={() => props.onRefine(message.id)}><RefreshCw size={13} /> Refine</button>
                      </>
                    ) : (
                      <span>{message.tokens_burned || message.review_cost || 0} review tokens · {message.triggered_by || "Member"}</span>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
        {props.loading && <div className="typing-indicator"><i /><i /><i /> Genie is thinking</div>}
      </section>
      {props.selectionMode && (
        <div className="message-selection-toolbar" role="toolbar" aria-label="Selected message actions">
          <button type="button" onClick={props.onSelectAllMessages}>Select All</button>
          <button
            className="message-selection-delete"
            disabled={!props.selectedMessageIds.length}
            onClick={props.onDeleteSelectedMessages}
            type="button"
          >Delete Selected ({props.selectedMessageIds.length})</button>
          <button type="button" onClick={props.onCancelMessageSelection}>Cancel</button>
        </div>
      )}
      {auditMessage && <MessageInfoLedgerModal message={auditMessage} onClose={() => setAuditMessage(null)} />}
      <div className="composer-wrap pb-[env(safe-area-inset-bottom)]">{props.children}</div>
    </main>
  );
}
