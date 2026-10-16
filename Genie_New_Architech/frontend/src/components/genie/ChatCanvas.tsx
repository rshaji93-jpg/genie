"use client";

import { Check, CheckCheck, RefreshCw, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import ArrowActionToolbar from "@/modules/messages_arrows/ArrowActionToolbar";
import InlineMessageEditor from "@/modules/messages_arrows/InlineMessageEditor";
import MessageInfoLedgerModal from "@/modules/messages_arrows/MessageInfoLedgerModal";
import IdealGLogo from "@/modules/brand/IdealGLogo";

export type TickStatus = "sent" | "delivered" | "read_no_ai" | "yellow_no_ai" | "ai_review_active" | "ai_verified";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  is_secret?: boolean;
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
          const canVerify = message.review_triggered_by === props.mySub && status === "ai_review_active";
          return (
            <article
              className={`message-row ${message.role === "user" ? "user-row" : "assistant-row"}`}
              key={message.id}
              onPointerDown={(event) => {
                const { clientX: x, clientY: y } = event;
                longPressTimer.current = window.setTimeout(() => {
                  setActiveActionsId(message.id);
                  setActionsPosition({ x, y });
                }, 500);
              }}
              onPointerUp={() => window.clearTimeout(longPressTimer.current)}
              onPointerLeave={() => window.clearTimeout(longPressTimer.current)}
            >
              <div
                className={`message-bubble ${message.role === "user" ? "user-bubble" : "assistant-bubble"} ${message.is_secret ? "secret-bubble" : ""}`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setActiveActionsId(message.id);
                  setActionsPosition({ x: event.clientX, y: event.clientY });
                }}
              >
                {message.is_secret && <div className="secret-label">🔒 Secret · not sent to AI</div>}
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
                ) : message.content ? <p>{message.content}</p> : null}
                <div className="message-meta">
                  {message.sender_name && <span>{message.sender_name}</span>}
                  <time>{message.sent_at ? new Date(message.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Now"}</time>
                  {message.is_edited && <span>Edited {message.updated_at ? new Date(message.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>}
                  {message.role === "user" && (
                    <button className="tick-button" onClick={() => void openLedger(message)} aria-label="Show timestamp and status audit">
                      <Tick status={status} />
                    </button>
                  )}
                  {message.role === "assistant" && message.tick_status === "yellow_no_ai" && <><span>Local only</span><Tick status="yellow_no_ai" /></>}
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
      {auditMessage && <MessageInfoLedgerModal message={auditMessage} onClose={() => setAuditMessage(null)} />}
      <div className="composer-wrap">{props.children}</div>
    </main>
  );
}
