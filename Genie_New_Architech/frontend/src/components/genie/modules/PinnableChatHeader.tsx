"use client";

import { MoreHorizontal, Pin, Search, Share2, UsersRound, X } from "lucide-react";
import { useState } from "react";
import type { ChatMode } from "@/components/genie/OmniComposer";

const iconButtonStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  minWidth: 34,
  borderRadius: 10,
  border: "1px solid rgba(0,0,0,0.10)",
  background: "rgba(255,255,255,0.88)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  cursor: "pointer",
};

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
  chatMode?: ChatMode;
  onChatModeChange?: (mode: ChatMode) => void;
  onShowPeople?: () => void;
  onOpenFriends?: () => void;
  onOpenSettings?: () => void;
  onLeaveGroup?: () => void;
}

export default function PinnableChatHeader(props: PinnableChatHeaderProps) {
  const [pinned, setPinned] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    padding: "10px 16px",
    borderBottom: "1px solid rgba(0,0,0,0.08)",
    background: "rgba(255,255,255,0.92)",
    backdropFilter: "blur(8px)",
    position: pinned ? "sticky" : "relative",
    top: 0,
    zIndex: 20,
    boxSizing: "border-box",
    flexWrap: "nowrap",
    gap: 8,
    overflowX: "auto",
  };

  return (
    <header className={`pinnable-chat-header ${pinned ? "pinned" : "auto-collapse"}`} style={headerStyle}>
      <div className="pinnable-chat-header-identity" style={{ display: "flex", alignItems: "center", minWidth: 0, flex: "1 1 auto" }}>
        <span
          aria-hidden="true"
          className="pinnable-chat-header-avatar"
          style={{
            width: 32,
            height: 32,
            minWidth: 32,
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginRight: 10,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >{props.initial}</span>
        <span className="pinnable-chat-header-title" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{props.title || "Genie"}</span>
      </div>
      <div aria-label="Conversation actions" className="pinnable-chat-header-actions" style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
        {props.chatMode && props.onChatModeChange && (
          <select
            aria-label="Conversation privacy mode"
            onChange={(event) => props.onChatModeChange?.(event.target.value as ChatMode)}
            style={{ height: 34, maxWidth: 150, borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)", background: "white", padding: "0 8px" }}
            value={props.chatMode}
          >
            <option value="ai_room">AI + Room</option>
            <option value="friends_only">AI Standby</option>
            <option value="private_ai">AI Private</option>
          </select>
        )}
        {props.group && <button aria-label="Show conversation people" onClick={props.onShowPeople} style={iconButtonStyle} title="People" type="button"><UsersRound size={17} /></button>}
        <button aria-label="Search messages" aria-pressed={searchOpen} onClick={() => setSearchOpen((open) => !open)} style={iconButtonStyle} title="Search messages" type="button"><Search size={17} /></button>
        <button aria-label="Temporary chat" aria-pressed={props.temporary} className={props.temporary ? "active" : ""} onClick={() => props.onTemporaryChange(!props.temporary)} style={iconButtonStyle} title="Temporary chat" type="button">◌</button>
        <button aria-label={pinned ? "Unpin header" : "Pin header"} aria-pressed={pinned} onClick={() => setPinned((value) => !value)} style={iconButtonStyle} title={pinned ? "Unpin header" : "Pin header"} type="button"><Pin size={16} /></button>
        <button aria-label="Share conversation" onClick={props.onShare} style={iconButtonStyle} title="Share conversation" type="button"><Share2 size={16} /></button>
        <div className="pinnable-chat-header-menu-wrap" style={{ position: "relative" }}>
          <button aria-expanded={menuOpen} aria-label="More conversation actions" onClick={() => setMenuOpen((open) => !open)} style={iconButtonStyle} title="More actions" type="button"><MoreHorizontal size={18} /></button>
          {menuOpen && (
            <div className="pinnable-chat-header-menu" role="menu">
              <button onClick={() => { setConfirmClear(true); setMenuOpen(false); }} role="menuitem" type="button">Delete / Clear Chat</button>
              <button onClick={() => { props.onDownloadTranscript(); setMenuOpen(false); }} role="menuitem" type="button">Download Transcript &amp; MOM</button>
              <button onClick={() => props.onMomEmailChange(!props.momEmailEnabled)} role="menuitem" type="button">
                MOM Email: {props.momEmailEnabled ? "ON" : "OFF"}
              </button>
              {props.onOpenFriends && <button onClick={props.onOpenFriends} role="menuitem" type="button">Friends</button>}
              {props.onOpenSettings && <button onClick={props.onOpenSettings} role="menuitem" type="button">Settings</button>}
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
