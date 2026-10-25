"use client";

import {
  Check,
  CheckCheck,
  Copy,
  ArrowDown,
  Bookmark,
  Gamepad2,
  Globe2,
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
import TeamsMessageReactions from "@/components/genie/modules/TeamsMessageReactions";
import PinnableChatHeader from "@/components/genie/modules/PinnableChatHeader";
import MessageContextActions from "@/components/genie/modules/MessageContextActions";
import RoomGamesDrawer from "@/components/genie/games/RoomGamesDrawer";
import IdealGLogo from "@/modules/brand/IdealGLogo";
import type { ReactNode } from "react";
import type { ChatMode } from "@/modules/composer/OptionAComposer";

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
  proposed_memory?: { id?: string; proposal_id?: string; content?: string; status?: "pending" | "approved" | "rejected" } | string | boolean;
  proposed_memory_id?: string;
  memory_status?: "pending" | "approved" | "rejected";
  is_live_call_response?: boolean;
  master_quota?: {
    used: number;
    limit: number;
    remaining: number;
    reset_in_seconds: number;
    vip_active: boolean;
    downgraded_to?: string;
    can_request_vip?: boolean;
  };
}

interface ChatCanvasProps {
  messages: ChatMessage[];
  loading: boolean;
  activeRoom: boolean;
  isGroupRoom: boolean;
  isMultiUserRoom?: boolean;
  roomId?: string;
  credential?: string;
  mySub: string;
  chatMode?: ChatMode;
  onChatModeChange?: (mode: ChatMode) => void;
  onShowPeople?: () => void;
  onOpenFriends?: () => void;
  onOpenSettings?: () => void;
  conversationName?: string;
  temporaryChat?: boolean;
  momEmailEnabled?: boolean;
  onTemporaryChatChange?: (enabled: boolean) => void;
  onHeaderSearch?: (query: string) => void;
  onShareConversation?: () => void;
  onClearConversation?: () => void;
  onDownloadTranscript?: () => void;
  onMomEmailChange?: (enabled: boolean) => void;
  onLeaveGroup?: () => void;
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
  onFeedback?: (message: ChatMessage, rating: "up" | "down") => void;
  onReadAloud?: (message: ChatMessage) => void;
  onCopyResponse?: (message: ChatMessage) => void;
  onRegenerateResponse?: (message: ChatMessage) => void;
  onRetryResponse?: (message: ChatMessage) => void;
  onToggleResponseVisibility?: (message: ChatMessage) => void;
  onApproveProposedMemory?: (message: ChatMessage) => Promise<void>;
  onSaveToLibrary?: (message: ChatMessage) => Promise<void>;
  onFutureSelf?: (message: ChatMessage) => Promise<void>;
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

function cleanHumanResponse(text: string): string {
  const parts = text.split(/(```[\w+-]*\r?\n[\s\S]*?(?:\r?\n```|$)|`[^`\n]*`)/g);
  const cleanedParts = parts.map((part) => {
    if (part.startsWith("`")) return part;
    const cleaned = part
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n\\n/g, "\n\n")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\/g, "")
      .replace(/^[ \t]*(?:-{3,}|_{3,}|\*{3,})[ \t]*(?:\r?\n|$)/gm, "");
    return cleaned
      .split("\n")
      .map((line) => {
        const boldMarkers = line.match(/\*\*/g)?.length || 0;
        const underlineMarkers = line.match(/__/g)?.length || 0;
        return line
          .replace(boldMarkers % 2 ? /\*\*/g : /$^/, "")
          .replace(underlineMarkers % 2 ? /__/g : /$^/, "")
          .trimEnd();
      })
      .join("\n");
  });
  return cleanedParts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

function MarkdownContent({ content }: { content: string }) {
  content = cleanHumanResponse(content);
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
  const [gamesOpen, setGamesOpen] = useState(false);
  const [auditMessage, setAuditMessage] = useState<ChatMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeActionsId, setActiveActionsId] = useState<string | null>(null);
  const [actionsPosition, setActionsPosition] = useState<{ x: number; y: number } | null>(null);
  const longPressTimer = useRef<number | undefined>(undefined);
  const longPressTriggered = useRef(false);
  const messageScrollRef = useRef<HTMLElement | null>(null);
  const messageElements = useRef(new Map<string, HTMLElement>());
  const previousMessageContent = useRef<Record<string, string>>({});
  const hasMountedMessages = useRef(false);
  const awayFromBottom = useRef(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingResponseAction, setPendingResponseAction] = useState<string | null>(null);
  const [completedResponseActions, setCompletedResponseActions] = useState<Set<string>>(() => new Set());
  const [messageSearch, setMessageSearch] = useState("");

  async function runResponseAction(
    action: "memory" | "library" | "future-self",
    message: ChatMessage,
    callback?: (message: ChatMessage) => Promise<void>,
  ) {
    if (!callback) return;
    const actionId = `${action}:${message.id}`;
    setPendingResponseAction(actionId);
    try {
      await callback(message);
      setCompletedResponseActions((current) => new Set(current).add(actionId));
    } catch {
      // The parent owns user-facing error messaging.
    } finally {
      setPendingResponseAction(null);
    }
  }

  useEffect(() => {
    const previous = previousMessageContent.current;
    const current: Record<string, string> = {};
    const arrived = props.messages.filter((message) => {
      current[message.id] = message.content;
      return message.role === "assistant"
        && message.content
        && (previous[message.id] === undefined || previous[message.id] === "");
    });
    if (hasMountedMessages.current && arrived.length) {
      if (awayFromBottom.current) setUnreadCount((count) => count + arrived.length);
      const response = arrived[arrived.length - 1];
      messageElements.current.get(response.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    previousMessageContent.current = current;
    hasMountedMessages.current = true;
  }, [props.messages]);

  function updateScrollPosition() {
    const element = messageScrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const away = distance > 150;
    awayFromBottom.current = away;
    setShowJumpToBottom(away);
    if (!away) setUnreadCount(0);
  }

  function jumpToBottom() {
    const element = messageScrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    setUnreadCount(0);
  }

  useEffect(() => {
    const closeOnOutside = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".message-actions-popover, .message-context-actions")) return;
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
      {props.isGroupRoom && <PinnableChatHeader
        group={props.activeRoom}
        chatMode={props.chatMode}
        initial={(props.conversationName || "Genie").trim().slice(0, 1).toLocaleUpperCase()}
        title={props.conversationName || "Genie"}
        momEmailEnabled={props.momEmailEnabled ?? false}
        onClear={props.onClearConversation ?? (() => undefined)}
        onDownloadTranscript={props.onDownloadTranscript ?? (() => undefined)}
        onLeaveGroup={props.onLeaveGroup}
        onMomEmailChange={props.onMomEmailChange ?? (() => undefined)}
        onChatModeChange={props.onChatModeChange}
        onShowPeople={props.onShowPeople}
        onOpenFriends={props.onOpenFriends}
        onOpenSettings={props.onOpenSettings}
        onSearch={setMessageSearch}
        onShare={props.onShareConversation ?? (() => undefined)}
        onTemporaryChange={props.onTemporaryChatChange ?? (() => undefined)}
        temporary={props.temporaryChat ?? false}
      />}
      {props.isMultiUserRoom && props.roomId && props.credential && (
        <div className="px-3 pt-2">
          {gamesOpen ? (
            <RoomGamesDrawer
              credential={props.credential}
              onClose={() => setGamesOpen(false)}
              playerId={props.mySub}
              roomId={props.roomId}
            />
          ) : (
            <button
              aria-label="Play a room game"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              onClick={() => setGamesOpen(true)}
              type="button"
            >
              <Gamepad2 aria-hidden="true" size={15} /> Play Game
            </button>
          )}
        </div>
      )}
      <section className="message-scroll" aria-live="polite" onScroll={updateScrollPosition} ref={messageScrollRef}>
        {!props.messages.length && (
          <div className="welcome-card">
            <div className="welcome-sparkle"><IdealGLogo size={42} /></div>
            <h2>What would you like to work on?</h2>
          </div>
        )}
        {props.messages.filter((message) =>
          !messageSearch.trim() || message.content.toLocaleLowerCase().includes(messageSearch.trim().toLocaleLowerCase()),
        ).map((message) => {
          const status = message.tick_status || "sent";
          const hasReview = Boolean(message.ai_reply);
          const canVerify = message.review_triggered_by === props.mySub && status === "ai_review_active";
          const retryOnly = message.role === "assistant" && /failed to fetch|\b405\b/i.test(message.content);
          const isOwnMessage = message.sender_sub === props.mySub || message.owner_sub === props.mySub;
          const canReactToMessage = Boolean(
            props.activeRoom
            && (props.isGroupRoom || props.isMultiUserRoom)
            && message.role === "user"
            && !isOwnMessage
            && !message.is_secret
            && props.onReact,
          );
          const appliedReactions = Object.entries(
            props.reactionCounts?.[
              `${message.role === "user" ? "user_message" : "ai_response"}:${message.id}`
            ] || {},
          )
            .filter(([, count]) => count > 0)
            .map(([emoji, count]) => ({ emoji, count }));
          return (
            <article
              className={`message-row ${message.role === "user" ? "user-row" : "assistant-row"} ${props.selectionMode ? "message-row-selecting" : ""}`}
              key={message.id}
              ref={(element) => {
                if (element) messageElements.current.set(message.id, element);
                else messageElements.current.delete(message.id);
              }}
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
                onPointerDown={(event) => {
                  if (event.pointerType === "touch" || event.button !== 0) return;
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
                onPointerUp={() => {
                  if (longPressTimer.current !== undefined) window.clearTimeout(longPressTimer.current);
                }}
                onPointerCancel={() => {
                  if (longPressTimer.current !== undefined) window.clearTimeout(longPressTimer.current);
                }}
                onPointerLeave={() => {
                  if (longPressTimer.current !== undefined) window.clearTimeout(longPressTimer.current);
                }}
                onTouchStart={(event) => {
                  if (props.selectionMode) return;
                  const touch = event.touches[0];
                  if (!touch) return;
                  if (longPressTimer.current !== undefined) window.clearTimeout(longPressTimer.current);
                  longPressTriggered.current = false;
                  if (canReactToMessage) {
                    const x = touch.clientX;
                    const y = touch.clientY;
                    longPressTimer.current = window.setTimeout(() => {
                      longPressTriggered.current = true;
                      setActiveActionsId(message.id);
                      setActionsPosition({ x, y });
                    }, 450);
                  } else {
                    longPressTimer.current = window.setTimeout(() => {
                      longPressTriggered.current = true;
                      setActiveActionsId(null);
                      props.onEnterMessageSelection(
                        !props.activeRoom || isOwnMessage ? message.id : undefined,
                      );
                    }, 500);
                  }
                }}
                onTouchMove={() => {
                  if (longPressTimer.current !== undefined) window.clearTimeout(longPressTimer.current);
                }}
                onTouchEnd={() => {
                  if (longPressTimer.current !== undefined) window.clearTimeout(longPressTimer.current);
                }}
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
                {props.activeRoom && message.sender_name && (
                  <div className="message-sender">{message.sender_name}</div>
                )}
                {message.is_secret && <div className="secret-label">🔒 Secret · not sent to AI</div>}
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
                {message.is_live_call_response && (
                  <span className="live-call-response-pill">🎙️ Active call response</span>
                )}
                {message.role === "assistant" && (message.proposed_memory || message.proposed_memory_id) && (
                  <div className="proposed-memory-pill" role="status">
                    <span title={typeof message.proposed_memory === "object" ? message.proposed_memory?.content : undefined}>
                      {message.memory_status === "approved"
                      || (typeof message.proposed_memory === "object" && message.proposed_memory?.status === "approved")
                      ? "✓ Memory saved"
                      : `Suggested memory${typeof message.proposed_memory === "object" && message.proposed_memory?.content
                        ? ` · ${message.proposed_memory.content}`
                        : ""}`}
                    </span>
                    <button
                      type="button"
                      disabled={!props.onApproveProposedMemory
                        || !(message.proposed_memory_id
                          || (typeof message.proposed_memory === "object"
                            && (message.proposed_memory?.id || message.proposed_memory?.proposal_id))
                          || (typeof message.proposed_memory === "string" && /^[\w-]{8,}$/.test(message.proposed_memory)))
                        || pendingResponseAction === `memory:${message.id}`
                        || completedResponseActions.has(`memory:${message.id}`)
                        || message.memory_status === "approved"
                        || (typeof message.proposed_memory === "object" && message.proposed_memory?.status === "approved")}
                      onClick={() => void runResponseAction("memory", message, props.onApproveProposedMemory)}
                    >
                      {pendingResponseAction === `memory:${message.id}` ? "Saving…" : "Approve"}
                    </button>
                  </div>
                )}
                <div className="message-meta">
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
                  className={`message-actions-popover ${activeActionsId === message.id && !canReactToMessage ? "message-actions-visible" : ""}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  style={activeActionsId === message.id && actionsPosition && !canReactToMessage ? {
                    left: Math.max(8, Math.min(actionsPosition.x, window.innerWidth - 300)),
                    top: Math.max(8, Math.min(actionsPosition.y, window.innerHeight - 56)),
                  } : undefined}
                >{!canReactToMessage && (
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
                )}</div>
              </div>
              {retryOnly && (
                <button className="message-retry-button" onClick={() => (props.onRetryResponse || props.onRegenerateResponse)?.(message)} type="button">
                  <RefreshCw size={14} /> Retry
                </button>
              )}
              {message.role === "assistant" && !retryOnly && (
                <>
                <div className="ai-response-toolbar" aria-label="AI response actions">
                  <button type="button" onClick={() => props.onReadAloud?.(message)} title="Read this response aloud" aria-label="Read this response aloud"><Volume2 size={15} /></button>
                  <button type="button" onClick={() => props.onCopyResponse?.(message)} title="Copy response" aria-label="Copy response"><Copy size={15} /></button>
                  <button
                    type="button"
                    disabled={!props.onFutureSelf || pendingResponseAction === `future-self:${message.id}` || completedResponseActions.has(`future-self:${message.id}`)}
                    onClick={() => void runResponseAction("future-self", message, props.onFutureSelf)}
                    title="Save this response for your Future Self"
                  >
                    <Sparkles size={14} />{completedResponseActions.has(`future-self:${message.id}`) ? "Added to Future Self" : "Future Self"}
                  </button>
                  <button
                    type="button"
                    disabled={!props.onSaveToLibrary || pendingResponseAction === `library:${message.id}` || completedResponseActions.has(`library:${message.id}`)}
                    onClick={() => void runResponseAction("library", message, props.onSaveToLibrary)}
                    title="Save this response to your Library"
                  >
                    <Bookmark size={14} />{completedResponseActions.has(`library:${message.id}`) ? "Saved" : "Save to Library"}
                  </button>
                  <button
                    type="button"
                    disabled={props.activeRoom && message.sender_sub !== props.mySub}
                    onClick={() => props.onRegenerateResponse?.(message)}
                    title={!props.activeRoom || message.sender_sub === props.mySub ? "Regenerate response" : "Only the response owner can regenerate it"}
                    aria-label="Regenerate response"
                  ><RefreshCw size={15} /></button>
                  {message.chat_mode === "private_ai" && (
                    <button
                      className={`response-visibility-pill ${message.is_group_shared_ai_response ? "response-shared" : "response-private"}`}
                      type="button"
                      disabled={!props.activeRoom || message.sender_sub !== props.mySub || !props.onToggleResponseVisibility}
                      onClick={() => props.onToggleResponseVisibility?.(message)}
                      title="Share this private AI response with the room"
                      aria-label="Share this private AI response with the room"
                    >
                      <><Globe2 size={14} /> 📤 Share to Group</>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!props.onFeedback && !props.activeRoom}
                    onClick={() => props.onFeedback
                      ? props.onFeedback(message, "up")
                      : props.onReact?.(message, "ai_response", "👍")}
                    aria-label="Like AI response"
                  ><ThumbsUp size={15} /></button>
                  <button
                    type="button"
                    disabled={!props.onFeedback && !props.activeRoom}
                    onClick={() => props.onFeedback
                      ? props.onFeedback(message, "down")
                      : props.onReact?.(message, "ai_response", "👎")}
                    aria-label="Dislike AI response"
                  ><ThumbsDown size={15} /></button>
                </div>
                </>
              )}
              {props.onReact
                && message.role === "user"
                && !isOwnMessage
                && !message.is_secret
                && (props.isGroupRoom || props.isMultiUserRoom)
                && appliedReactions.length > 0 && (
                <div className="message-reaction-bar" aria-label="Message reactions">
                  <TeamsMessageReactions
                    ariaLabel="Message reactions"
                    canToggle={canReactToMessage}
                    onToggle={(emoji) => props.onReact?.(
                      message,
                      message.role === "user" ? "user_message" : "ai_response",
                      emoji,
                    )}
                    currentUserId={props.mySub}
                    reactions={appliedReactions}
                  />
                </div>
              )}
              {activeActionsId === message.id && canReactToMessage && actionsPosition && (
                <MessageContextActions
                  onAIReview={() => props.onReview(message.id)}
                  onClose={() => setActiveActionsId(null)}
                  onForward={() => props.onForward?.(message)}
                  onReact={(emoji) => props.onReact?.(message, "user_message", emoji)}
                  position={actionsPosition}
                />
              )}
              {props.activeRoom && message.role === "user" && (status === "read_no_ai" || status === "yellow_no_ai") && !hasReview && !message.is_secret && (
                <button className="message-action review-action" onClick={() => props.onReview(message.id)}>
                  <Sparkles size={14} /> ✨ Ask Genie
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
      {showJumpToBottom && (
        <button
          aria-label={`Jump to latest messages${unreadCount ? `, ${unreadCount} unread` : ""}`}
          className="jump-to-bottom"
          onClick={jumpToBottom}
          type="button"
        >
          <ArrowDown size={18} />
          {unreadCount > 0 && <span>{unreadCount > 99 ? "99+" : unreadCount}</span>}
        </button>
      )}
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
      <div className="composer-wrap pb-[env(safe-area-inset-bottom)]">
        {props.children}
      </div>
    </main>
  );
}
