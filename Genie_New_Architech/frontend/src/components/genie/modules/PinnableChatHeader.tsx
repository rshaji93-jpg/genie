"use client";

import { MoreHorizontal, Pin, Search, Share2, X } from "lucide-react";
import { useState } from "react";

export interface PinnableChatHeaderProps {
  title: string;
  initial: string;
  group: boolean;
  temporary: boolean;
  momEmailEnabled: boolean;
  onSearch: (query: string) => void;
  onTemporaryChange: (enabled: boolean) => void;
  onShare: () => void;
  onClear: () => void;
  onDownloadTranscript: () => void;
  onMomEmailChange: (enabled: boolean) => void;
  onLeaveGroup?: () => void;
}

export default function PinnableChatHeader(props: PinnableChatHeaderProps) {
  const [pinned, setPinned] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <header className={`pinnable-chat-header ${pinned ? "pinned" : "auto-collapse"}`}>
      <div className="pinnable-chat-header-identity">
        <span aria-hidden="true" className="pinnable-chat-header-avatar">{props.initial}</span>
        <span className="pinnable-chat-header-title">{props.title || "Genie"}</span>
      </div>
      <div aria-label="Conversation actions" className="pinnable-chat-header-actions">
        <button aria-label="Search messages" aria-pressed={searchOpen} onClick={() => setSearchOpen((open) => !open)} title="Search messages" type="button"><Search size={17} /></button>
        <button aria-label="Temporary chat" aria-pressed={props.temporary} className={props.temporary ? "active" : ""} onClick={() => props.onTemporaryChange(!props.temporary)} title="Temporary chat" type="button">◌</button>
        <button aria-label={pinned ? "Unpin header" : "Pin header"} aria-pressed={pinned} onClick={() => setPinned((value) => !value)} title={pinned ? "Unpin header" : "Pin header"} type="button"><Pin size={16} /></button>
        <button aria-label="Share conversation" onClick={props.onShare} title="Share conversation" type="button"><Share2 size={16} /></button>
        <div className="pinnable-chat-header-menu-wrap">
          <button aria-expanded={menuOpen} aria-label="More conversation actions" onClick={() => setMenuOpen((open) => !open)} title="More actions" type="button"><MoreHorizontal size={18} /></button>
          {menuOpen && (
            <div className="pinnable-chat-header-menu" role="menu">
              <button onClick={() => { setConfirmClear(true); setMenuOpen(false); }} role="menuitem" type="button">Delete / Clear Chat</button>
              <button onClick={() => { props.onDownloadTranscript(); setMenuOpen(false); }} role="menuitem" type="button">Download Transcript &amp; MOM</button>
              <button onClick={() => props.onMomEmailChange(!props.momEmailEnabled)} role="menuitem" type="button">
                MOM Email: {props.momEmailEnabled ? "ON" : "OFF"}
              </button>
              {props.group && props.onLeaveGroup && (
                <button onClick={() => { props.onLeaveGroup?.(); setMenuOpen(false); }} role="menuitem" type="button">Leave Group</button>
              )}
            </div>
          )}
        </div>
      </div>
      {searchOpen && (
        <div className="pinnable-chat-header-search">
          <Search aria-hidden="true" size={16} />
          <input
            aria-label="Filter messages"
            onChange={(event) => { setSearchText(event.target.value); props.onSearch(event.target.value); }}
            placeholder="Search this conversation"
            value={searchText}
          />
          <button aria-label="Close message search" onClick={() => { setSearchText(""); props.onSearch(""); setSearchOpen(false); }} type="button"><X size={15} /></button>
        </div>
      )}
      {confirmClear && (
        <div className="pinnable-chat-confirm-backdrop" role="presentation">
          <section aria-label="Confirm clear chat" aria-modal="true" className="pinnable-chat-confirm" role="dialog">
            <strong>Clear this conversation?</strong>
            <p>This action cannot be undone.</p>
            <div>
              <button onClick={() => setConfirmClear(false)} type="button">Cancel</button>
              <button onClick={() => { props.onClear(); setConfirmClear(false); }} type="button">Clear chat</button>
            </div>
          </section>
        </div>
      )}
    </header>
  );
}
