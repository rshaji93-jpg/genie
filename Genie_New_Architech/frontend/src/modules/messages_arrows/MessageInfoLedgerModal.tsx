import type { ChatMessage } from "@/components/genie/ChatCanvas";

interface AuditEntry {
  label: string;
  at?: string | null;
  detail?: string;
  tokens?: number;
  breakdown?: string;
}

export default function MessageInfoLedgerModal({ message, onClose }: { message: ChatMessage; onClose: () => void }) {
  const entries: AuditEntry[] = [
    { label: "Sent", at: message.sent_at },
    { label: "Delivered", at: message.delivered_at },
    { label: "Edited", at: message.updated_at },
    { label: "Read (Yellow)", at: message.read_at },
    {
      label: "AI Review Triggered (Red)",
      at: message.review_at,
      detail: message.review_triggered_by || message.triggered_by
        ? `Triggered by ${message.triggered_by || message.review_triggered_by}`
        : undefined,
      tokens: message.tokens_burned ?? message.review_cost,
      breakdown: message.breakdown || message.review_breakdown,
    },
    {
      label: "Verified (Green)",
      at: message.verified_at,
      detail: message.verified_by ? `Verified by ${message.verified_by}` : undefined,
    },
  ].filter((entry): entry is AuditEntry & { at: string } => Boolean(entry.at))
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
  return (
    <div className="ledger-backdrop" onClick={onClose} role="presentation">
      <section aria-label="Message audit ledger" aria-modal="true" className="ledger-modal" onClick={(event) => event.stopPropagation()} role="dialog">
        <header><h2>Message information</h2><button aria-label="Close ledger" onClick={onClose}>×</button></header>
        {message.ledger_error && <p role="alert">{message.ledger_error}</p>}
        <p>Sender: {message.sender_name || (message.role === "user" ? "You" : "Genie")}</p>
        {entries.map((entry) => {
          if (!entry.at) return null;
          return (
            <div className="ledger-event" key={`${entry.label}-${entry.at}`}>
              <p className="ledger-entry"><span>{entry.label}</span><time>{new Date(entry.at).toLocaleString()}</time></p>
              {(entry.detail || entry.tokens !== undefined || entry.breakdown) && (
                <p className="ledger-event-detail">
                  {[entry.detail, entry.tokens !== undefined ? `${entry.tokens} tokens charged` : undefined, entry.breakdown]
                    .filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          );
        })}
        {message.read_receipts?.map((receipt) => <p className="ledger-entry" key={receipt.user_sub}><span>Read by {receipt.user_name}</span><time>{new Date(receipt.read_at).toLocaleString()}</time></p>)}
        {(message.review_breakdown || message.breakdown) && <p>{message.review_breakdown || message.breakdown}</p>}
      </section>
    </div>
  );
}
