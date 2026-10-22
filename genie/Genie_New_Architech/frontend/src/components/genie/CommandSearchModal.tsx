"use client";

import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ThreadItem } from "./Sidebar";

interface CommandSearchModalProps {
  open: boolean;
  threads: ThreadItem[];
  onClose: () => void;
  onSelect: (id: string) => void;
}

export default function CommandSearchModal(props: CommandSearchModalProps) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return props.threads.filter((thread) => !normalized || thread.title.toLocaleLowerCase().includes(normalized));
  }, [props.threads, query]);

  useEffect(() => {
    if (props.open) setQuery("");
  }, [props.open]);

  if (!props.open) return null;
  return (
    <div className="modal-backdrop command-search-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        className="command-search"
        role="dialog"
        aria-modal="true"
        aria-label="Search chats"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-search-input">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats and threads…"
            aria-label="Search chats and threads"
          />
          <button className="icon-button" onClick={props.onClose} aria-label="Close search"><X size={17} /></button>
        </div>
        <div className="command-search-results">
          {results.map((thread) => (
            <button key={thread.id} onClick={() => props.onSelect(thread.id)}>
              <span>{thread.title}</span><kbd>↵</kbd>
            </button>
          ))}
          {!results.length && <p>No matching chats.</p>}
        </div>
        <div className="command-search-hint"><kbd>⌘ K</kbd><kbd>Ctrl K</kbd><span>Search recent chat history</span></div>
      </section>
    </div>
  );
}
