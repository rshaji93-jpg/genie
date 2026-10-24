"use client";

import {
  CalendarClock,
  ChevronLeft,
  ChevronDown,
  Library,
  MessageCircle,
  MoreHorizontal,
  Pin,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Settings,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import IdealGLogo from "@/modules/brand/IdealGLogo";
import ProfileFooter from "@/modules/profile_settings/ProfileFooter";

export type WorkspaceView = "chat" | "library" | "scheduled" | "friends";

export interface ThreadItem {
  id: string;
  title: string;
  pinned?: boolean;
}

export interface SidebarRoom {
  id: string;
  name: string;
  group_slot?: number | null;
  member_count?: number;
  auto_saved?: boolean;
}

export interface DeletedThreadItem extends ThreadItem {
  deleted_at: string;
}

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  view: WorkspaceView;
  threads: ThreadItem[];
  deletedThreads: DeletedThreadItem[];
  selectedThreadId: string;
  onlineMembers: string[];
  rooms: SidebarRoom[];
  currentRoomId?: string;
  displayName: string;
  pictureUrl?: string;
  incomingRequestCount: number;
  activeModel: string;
  onToggle: () => void;
  onViewChange: (view: WorkspaceView) => void;
  onNewChat: () => void;
  onThreadSelect: (id: string) => void;
  onDeleteThread: (id: string) => void;
  onRenameThread: (id: string) => void;
  onPinThread: (id: string) => void;
  onClearCurrentChat: () => void;
  onRestoreThread: (id: string) => void;
  onPermanentlyDeleteThread: (id: string) => void;
  onInviteRoom: () => void;
  onSearch: () => void;
  onOpenSettings: () => void;
  onProfileTap: () => void;
  onAvatarSelected: (file: File) => void;
  onOpenRoom: (id: string) => void;
  onCreateGroupSlot: (slot: number) => void;
}

interface GovernanceMenuState {
  key: string;
  top: number;
  left: number;
}

const navigation = [
  { id: "library", label: "Library", icon: Library },
  { id: "scheduled", label: "Scheduled", icon: CalendarClock },
  { id: "friends", label: "Friends", icon: UsersRound },
] as const;

export default function Sidebar(props: SidebarProps) {
  const [presenceOpen, setPresenceOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [groupChatsOpen, setGroupChatsOpen] = useState(true);
  const [governanceMenu, setGovernanceMenu] = useState<GovernanceMenuState | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const width = props.collapsed ? "sidebar collapsed" : "sidebar";

  function closeMenu() {
    setGovernanceMenu(null);
  }

  useEffect(() => {
    const closeFromOutside = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".sidebar-menu-anchor, .sidebar-governance-menu")) return;
      closeMenu();
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
      if (event.target instanceof Element && event.target.closest(".omni-composer")) closeMenu();
    };
    const closeOnComposerFocus = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.closest(".omni-composer")) closeMenu();
    };
    const closeOnHeaderMenu = () => closeMenu();
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("mousedown", closeFromOutside);
    document.addEventListener("touchstart", closeFromOutside);
    document.addEventListener("keydown", closeForEscape);
    document.addEventListener("focusin", closeOnComposerFocus);
    window.addEventListener("genie:close-sidebar-menu", closeOnHeaderMenu);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("mousedown", closeFromOutside);
      document.removeEventListener("touchstart", closeFromOutside);
      document.removeEventListener("keydown", closeForEscape);
      document.removeEventListener("focusin", closeOnComposerFocus);
      window.removeEventListener("genie:close-sidebar-menu", closeOnHeaderMenu);
    };
  }, []);

  function toggleGovernanceMenu(key: string, event: React.MouseEvent<HTMLButtonElement>) {
    if (governanceMenu?.key === key) {
      closeMenu();
      return;
    }
    window.dispatchEvent(new Event("genie:close-header-menu"));
    const rect = event.currentTarget.getBoundingClientRect();
    setGovernanceMenu({
      key,
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 300)),
      left: Math.max(8, Math.min(rect.right - 208, window.innerWidth - 216)),
    });
  }

  function renderGovernanceMenu(thread?: ThreadItem) {
    return (
      <div
        className="sidebar-governance-menu"
        role="menu"
        aria-label="Chat governance"
        style={governanceMenu ? { top: governanceMenu.top, left: governanceMenu.left } : undefined}
      >
        {thread ? (
          <>
            <button role="menuitem" onClick={() => { props.onDeleteThread(thread.id); closeMenu(); }} className="sidebar-danger-menu-item">
              <Trash2 size={16} /> Move to Trash
            </button>
            <button role="menuitem" onClick={() => { props.onRenameThread(thread.id); closeMenu(); }}>
              <Pencil size={15} /> Rename chat
            </button>
            <button role="menuitem" onClick={() => { props.onPinThread(thread.id); closeMenu(); }}>
              <Pin size={15} /> {thread.pinned ? "Unpin chat" : "Pin chat"}
            </button>
          </>
        ) : (
          <>
            <button role="menuitem" onClick={() => { props.onSearch(); closeMenu(); }}><Search size={15} /> Search chats</button>
            <button role="menuitem" className="sidebar-danger-menu-item" onClick={() => { props.onClearCurrentChat(); closeMenu(); }}>
              <Trash2 size={16} /> Clear / Delete Chat
            </button>
            <button role="menuitem" onClick={() => { props.onOpenSettings(); closeMenu(); }}><span aria-hidden="true">☁</span> User Cloud Backup Vault</button>
            <button role="menuitem" onClick={() => { props.onViewChange("friends"); closeMenu(); }}><UsersRound size={15} /> @Username Friend Requests</button>
            <button role="menuitem" onClick={() => { props.onOpenSettings(); closeMenu(); }}><span aria-hidden="true">🔒</span> Per-User Privacy Governance</button>
          </>
        )}
      </div>
    );
  }

  return (
    <aside
      className={`${width} mobile-sidebar ${props.mobileOpen ? "mobile-sidebar-open" : ""}`}
      aria-label="Workspace navigation"
      onClick={(event) => {
        if (
          props.mobileOpen
          && event.target instanceof Element
          && event.target.closest("button")
          && !event.target.closest(".sidebar-menu-trigger, .thread-menu-trigger")
        ) {
          props.onToggle();
        }
      }}
    >
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
          {id === "friends" && props.incomingRequestCount > 0 && (
            <span className="sidebar-notification-badge" aria-label={`${props.incomingRequestCount} incoming requests`}>
              {props.incomingRequestCount}
            </span>
          )}
        </button>
      ))}
      {!props.collapsed && (
        <>
          <div className="sidebar-section-heading">
            <span>Recent threads</span>
            <div className="sidebar-menu-anchor">
              <button
                className="sidebar-menu-trigger"
                onClick={(event) => toggleGovernanceMenu("recent", event)}
                aria-label="Recent threads menu"
                aria-expanded={governanceMenu?.key === "recent"}
                title="Recent threads menu"
                type="button"
              ><MoreHorizontal size={18} /></button>
              {governanceMenu?.key === "recent" && renderGovernanceMenu()}
            </div>
          </div>
          <section className="group-chat-slots">
            <button
              className="group-chat-heading"
              aria-expanded={groupChatsOpen}
              onClick={() => setGroupChatsOpen((open) => !open)}
              type="button"
            >
              <UsersRound size={14} />
              <span>Group Chats</span>
              <ChevronDown className={groupChatsOpen ? "" : "group-chat-chevron-collapsed"} size={14} />
            </button>
            {groupChatsOpen && Array.from({ length: 5 }, (_, index) => {
              const slot = index + 1;
              const room = props.rooms.find((item) => item.group_slot === slot);
              return (
                <button
                  className={`group-chat-slot ${room?.id === props.currentRoomId ? "selected" : ""}`}
                  key={slot}
                  onClick={() => room ? props.onOpenRoom(room.id) : props.onCreateGroupSlot(slot)}
                  title={room ? `Open ${room.name}` : `Create Group ${slot}`}
                  type="button"
                >
                  <span className="group-chat-slot-name">{room?.name || `Group ${slot}`}</span>
                  {room
                    ? <span className="group-chat-seat-badge">{Math.min(room.member_count || 1, 5)}/5</span>
                    : <span className="group-chat-seat-badge">1/5</span>}
                  {room?.auto_saved && <span className="group-chat-saved" title="Auto-saved">●</span>}
                </button>
              );
            })}
          </section>
          <div className="thread-list">
            {props.threads.map((thread) => (
              <div className="sidebar-thread-row" key={thread.id}>
                <button
                  className={`thread-item ${props.selectedThreadId === thread.id ? "selected" : ""}`}
                  onClick={() => props.onThreadSelect(thread.id)}
                  title={thread.title}
                >
                  <MessageCircle size={14} /><span>{thread.title}</span>
                </button>
                <div className="sidebar-menu-anchor">
                  <button
                    className="thread-menu-trigger"
                    onClick={(event) => toggleGovernanceMenu(thread.id, event)}
                    aria-label={`Menu for ${thread.title}`}
                    aria-expanded={governanceMenu?.key === thread.id}
                    title="Chat actions"
                    type="button"
                  ><MoreHorizontal size={17} /></button>
                  {governanceMenu?.key === thread.id && renderGovernanceMenu(thread)}
                </div>
              </div>
            ))}
            {!props.threads.length && <p className="sidebar-empty">Your recent chats will appear here.</p>}
          </div>
          <section className="sidebar-trash">
            <button
              aria-expanded={trashOpen}
              className="sidebar-trash-trigger"
              onClick={() => setTrashOpen((open) => !open)}
              type="button"
            >
              <Trash2 size={15} /><span>Trash / Recently Deleted</span>
            </button>
            {trashOpen && (
              <div className="sidebar-trash-list">
                {props.deletedThreads.map((thread) => (
                  <div className="sidebar-trash-row" key={thread.id} title={thread.title}>
                    <span>{thread.title}</span>
                    <button onClick={() => props.onRestoreThread(thread.id)} aria-label={`Restore ${thread.title}`} title="Restore"><RotateCcw size={13} /></button>
                    <button onClick={() => props.onPermanentlyDeleteThread(thread.id)} aria-label={`Permanently delete ${thread.title}`} title="Permanently delete"><Trash2 size={13} /></button>
                  </div>
                ))}
                {!props.deletedThreads.length && <p className="sidebar-empty">Nothing in Trash.</p>}
              </div>
            )}
          </section>
          <div className="sidebar-footer">
            <ProfileFooter
              name={props.displayName}
              picture={props.pictureUrl}
              tier={props.activeModel}
              onAvatarClick={() => avatarInput.current?.click()}
              onProfileTap={props.onProfileTap}
            />
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
          <button className="collapsed-profile" onClick={() => avatarInput.current?.click()} aria-label="Upload profile picture">
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
      <input
        ref={avatarInput}
        accept="image/*"
        className="visually-hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) props.onAvatarSelected(file);
          event.currentTarget.value = "";
        }}
        type="file"
      />
    </aside>
  );
}
