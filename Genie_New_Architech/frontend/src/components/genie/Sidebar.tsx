"use client";

import {
  Archive,
  CalendarClock,
  ChevronLeft,
  Library,
  MessageCircle,
  Plus,
  Search,
  Share2,
  Settings,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import IdealGLogo from "@/modules/brand/IdealGLogo";
import ProfileFooter from "@/modules/profile_settings/ProfileFooter";

export type WorkspaceView = "chat" | "library" | "scheduled" | "friends" | "archive";

export interface ThreadItem {
  id: string;
  title: string;
}

interface SidebarProps {
  collapsed: boolean;
  view: WorkspaceView;
  threads: ThreadItem[];
  selectedThreadId: string;
  onlineMembers: string[];
  displayName: string;
  pictureUrl?: string;
  activeModel: string;
  onToggle: () => void;
  onViewChange: (view: WorkspaceView) => void;
  onNewChat: () => void;
  onThreadSelect: (id: string) => void;
  onInviteRoom: () => void;
  onSearch: () => void;
  onOpenSettings: () => void;
  onProfileTap: () => void;
}

const navigation = [
  { id: "library", label: "Library", icon: Library },
  { id: "scheduled", label: "Scheduled", icon: CalendarClock },
  { id: "friends", label: "Friends", icon: UsersRound },
  { id: "archive", label: "Archived Rooms", icon: Archive },
] as const;

export default function Sidebar(props: SidebarProps) {
  const [presenceOpen, setPresenceOpen] = useState(false);
  const width = props.collapsed ? "sidebar collapsed" : "sidebar";
  return (
    <aside className={width} aria-label="Workspace navigation">
      <div className="sidebar-brand">
        <IdealGLogo className="brand-mark-svg" size={30} />
        {!props.collapsed && <span>Genie</span>}
        <button className="icon-button sidebar-collapse" onClick={props.onToggle} aria-label="Toggle sidebar">
          <ChevronLeft size={17} />
        </button>
      </div>
      <button className="new-chat-button" onClick={props.onNewChat}>
        <Plus size={17} /> {!props.collapsed && "New chat"}
      </button>
      <button className="nav-item room-invite-shortcut" onClick={props.onInviteRoom} title="Invite to a room" aria-label="Invite to a room">
        <Share2 size={17} /> {!props.collapsed && "Invite to a room"}
      </button>
      <button
        className={`nav-item ${props.view === "chat" ? "active" : ""}`}
        onClick={() => props.onViewChange("chat")}
        title="Chats"
      >
        <MessageCircle size={17} /> {!props.collapsed && "Chats"}
      </button>
      {navigation.map(({ id, label, icon: Icon }) => (
        <button
          className={`nav-item ${props.view === id ? "active" : ""}`}
          key={id}
          onClick={() => props.onViewChange(id)}
          title={label}
        >
          <Icon size={17} /> {!props.collapsed && label}
        </button>
      ))}
      {!props.collapsed && (
        <>
          <div className="sidebar-section-heading">
            <span>Recent threads</span>
            <button className="sidebar-search-button" onClick={props.onSearch} aria-label="Search chats" title="Search chats (Ctrl+K)"><Search size={14} /></button>
          </div>
          <div className="thread-list">
            {props.threads.map((thread) => (
              <button
                key={thread.id}
                className={`thread-item ${props.selectedThreadId === thread.id ? "selected" : ""}`}
                onClick={() => props.onThreadSelect(thread.id)}
                title={thread.title}
              >
                <MessageCircle size={14} /><span>{thread.title}</span>
              </button>
            ))}
            {!props.threads.length && <p className="sidebar-empty">Your recent chats will appear here.</p>}
          </div>
          <div className="sidebar-footer">
            <button className="profile-footer-button" onClick={props.onProfileTap} aria-label="Open profile">
              <ProfileFooter name={props.displayName} picture={props.pictureUrl} tier={props.activeModel} />
            </button>
            <button className="icon-button" onClick={() => setPresenceOpen((open) => !open)} aria-label="MetaSync online presence" title="MetaSync online presence">
              <span className="presence-badge"><UsersRound size={15} /></span>
            </button>
            <button className="icon-button" onClick={props.onOpenSettings} aria-label="Settings" title="Settings"><Settings size={16} /></button>
          </div>
          {presenceOpen && <div className="presence-popover" role="status">
            <strong>MetaSync presence</strong>
            {props.onlineMembers.length ? props.onlineMembers.map((member) => (
              <span className="presence-popover-person" key={member}><i className="presence-light green" />{member}</span>
            )) : <p>Join a room to see active members.</p>}
          </div>}
        </>
      )}
      {props.collapsed && (
        <div className="collapsed-sidebar-actions">
          <button className="icon-button" onClick={props.onSearch} aria-label="Search chats" title="Search chats"><Search size={16} /></button>
          <button className="icon-button" onClick={() => setPresenceOpen((open) => !open)} aria-label={`MetaSync presence, ${props.onlineMembers.length} online`} title={`${props.onlineMembers.length} room members online`}><span className="presence-badge"><UsersRound size={15} /></span></button>
          <button className="icon-button" onClick={props.onOpenSettings} aria-label="Settings" title="Settings"><Settings size={16} /></button>
          <button className="collapsed-profile" onClick={props.onProfileTap} aria-label="Open profile">
            {props.pictureUrl ? <img src={props.pictureUrl} alt="" /> : props.displayName.slice(0, 1).toUpperCase()}
          </button>
          {presenceOpen && <div className="presence-popover collapsed-presence-popover" role="status">
            <strong>MetaSync presence</strong>
            {props.onlineMembers.length ? props.onlineMembers.map((member) => (
              <span className="presence-popover-person" key={member}><i className="presence-light green" />{member}</span>
            )) : <p>Join a room to see active members.</p>}
          </div>}
        </div>
      )}
    </aside>
  );
}
