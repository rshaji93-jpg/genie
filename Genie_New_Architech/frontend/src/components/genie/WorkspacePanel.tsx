"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { WorkspaceView } from "./Sidebar";

interface SavedItem { id: string; content: string; createdAt: string }
interface ScheduleItem { id: string; title: string; at: string; notified?: boolean }
interface RoomSummary { id: string; name: string; member_count?: number }
interface FriendRequestItem { id: string; sender_name: string; sender_username: string }
interface FriendItem { user_sub: string; user_name: string; username: string }
interface ActiveRoomMember { user_sub: string; user_name: string; username?: string }

interface WorkspacePanelProps {
  view: Exclude<WorkspaceView, "chat">;
  savedItems: SavedItem[];
  onRemoveSaved: (id: string) => void;
  rooms: RoomSummary[];
  archivedRoomIds: string[];
  onArchiveRoom: (id: string) => void;
  onUnarchiveRoom: (id: string) => void;
  currentRoomId?: string;
  requests: FriendRequestItem[];
  friends: FriendItem[];
  activeMembers: ActiveRoomMember[];
  currentUserSub: string;
  onAcceptRequest: (id: string) => Promise<void>;
  onRejectRequest: (id: string) => Promise<void>;
  onSendFriendRequest: (username: string) => Promise<void>;
  onSearchDirectory: (query: string) => Promise<FriendItem[]>;
  onCreateRoom: () => Promise<void>;
  onJoinRoom: (invite: string) => Promise<void>;
  onOpenRoom: (id: string) => void;
}

const storageRead = <T,>(key: string, fallback: T): T => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
};

export default function WorkspacePanel(props: WorkspacePanelProps) {
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [friendUsername, setFriendUsername] = useState("");
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [directoryResults, setDirectoryResults] = useState<FriendItem[]>([]);
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSchedule(storageRead<ScheduleItem[]>("genie_new_schedule", []));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSchedule((items) => {
        let changed = false;
        const next = items.map((item) => {
          if (!item.notified && new Date(item.at).getTime() <= Date.now()) {
            changed = true;
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification("Genie reminder", { body: item.title });
            }
            return { ...item, notified: true };
          }
          return item;
        });
        if (changed) localStorage.setItem("genie_new_schedule", JSON.stringify(next));
        return changed ? next : items;
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function addSchedule(event: FormEvent) {
    event.preventDefault();
    if (!scheduleTitle.trim() || !scheduleAt) return;
    const item = { id: crypto.randomUUID(), title: scheduleTitle.trim(), at: new Date(scheduleAt).toISOString() };
    const next = [...schedule, item].sort((a, b) => a.at.localeCompare(b.at));
    setSchedule(next);
    localStorage.setItem("genie_new_schedule", JSON.stringify(next));
    setScheduleTitle("");
    setScheduleAt("");
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
  }

  async function submitFriend(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await props.onSendFriendRequest(friendUsername);
      setFriendUsername("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Friend request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await props.onJoinRoom(inviteCode);
      setInviteCode("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Room invitation could not be accepted.");
    } finally {
      setBusy(false);
    }
  }

  async function searchDirectory(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setDirectoryResults(await props.onSearchDirectory(directoryQuery));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Friend directory search failed.");
    } finally {
      setBusy(false);
    }
  }

  async function respondToFriendRequest(id: string, accept: boolean) {
    setBusy(true);
    setError("");
    try {
      if (accept) await props.onAcceptRequest(id);
      else await props.onRejectRequest(id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Friend request could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function requestRoomMember(username: string) {
    setBusy(true);
    setError("");
    try {
      await props.onSendFriendRequest(`@${username}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Friend request failed.");
    } finally {
      setBusy(false);
    }
  }

  const titles = {
    library: ["Library", "A private collection of answers you chose to keep."],
    scheduled: ["Scheduled", "Reminders stay in this browser. Genie does not receive them."],
    friends: ["Friends", "Find friends and manage invitations using public @usernames."],
    archive: ["Archived Rooms", "Room shortcuts are hidden from the active list on this device."],
  } as const;
  const [title, description] = titles[props.view];

  return (
    <section className="workspace-section">
      <div className="section-title"><span className="eyebrow">YOUR WORKSPACE</span><h1>{title}</h1><p>{description}</p></div>
      {error && <p className="section-error" role="alert">{error}</p>}
      {props.view === "library" && (
        <div className="section-list">
          {props.savedItems.map((item) => (
            <article className="section-card" key={item.id}>
              <time>{new Date(item.createdAt).toLocaleString()}</time><p>{item.content}</p>
              <button className="subtle-button" onClick={() => props.onRemoveSaved(item.id)}>Remove</button>
            </article>
          ))}
          {!props.savedItems.length && <div className="section-empty">Save any Genie answer from a chat to keep it here.</div>}
        </div>
      )}
      {props.view === "scheduled" && (
        <>
          <form className="section-form schedule-form" onSubmit={addSchedule}>
            <input value={scheduleTitle} onChange={(event) => setScheduleTitle(event.target.value)} maxLength={160} placeholder="Reminder title" required />
            <input type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} min={new Date().toISOString().slice(0, 16)} required />
            <button className="primary-button" type="submit">Schedule reminder</button>
          </form>
          <div className="section-list">
            {schedule.map((item) => (
              <article className="section-card schedule-row" key={item.id}><div><strong>{item.title}</strong><time>{new Date(item.at).toLocaleString()}</time></div><span className={item.notified ? "reminder-done" : "reminder-pending"}>{item.notified ? "Done" : "Pending"}</span></article>
            ))}
          </div>
        </>
      )}
      {props.view === "friends" && (
        <div className="friends-grid">
          <div className="section-card">
            <h2>Friend requests</h2>
            {props.activeMembers.length > 0 && (
              <>
                <h3>Active room members</h3>
                {props.activeMembers
                  .filter((member) => member.user_sub !== props.currentUserSub)
                  .map((member) => {
                    const isFriend = props.friends.some((friend) => friend.user_sub === member.user_sub);
                    return (
                      <div className="request-row" key={member.user_sub}>
                        <span><strong>{member.user_name}</strong><small>{member.username ? `@${member.username}` : "Username unavailable"}</small></span>
                        <button
                          className="primary-button compact"
                          disabled={busy || isFriend || !member.username}
                          onClick={() => member.username && void requestRoomMember(member.username)}
                          type="button"
                        >{isFriend ? "Already friends" : "Send Friend Request"}</button>
                      </div>
                    );
                  })}
              </>
            )}
            {props.requests.map((request) => (
              <div className="request-row" key={request.id}><span><strong>{request.sender_name}</strong><small>@{request.sender_username}</small></span><span><button className="primary-button compact" disabled={busy} onClick={() => void respondToFriendRequest(request.id, true)}>Accept</button><button className="subtle-button" disabled={busy} onClick={() => void respondToFriendRequest(request.id, false)}>Decline</button></span></div>
            ))}
            {!props.requests.length && <p className="muted-copy">No pending requests.</p>}
            <h3>Your friends</h3>
            {props.friends.map((friend) => <div className="friend-row" key={friend.user_sub}><span className="presence-light green" /><span>{friend.user_name}</span><small>@{friend.username}</small></div>)}
            <form className="inline-form" onSubmit={(event) => void submitFriend(event)}>
              <input value={friendUsername} onChange={(event) => setFriendUsername(event.target.value)} placeholder="Send request to @username" pattern="@?[A-Za-z0-9_]{2,32}" required />
              <button className="primary-button compact" disabled={busy}>Send</button>
            </form>
            <h3>Find a Genie username</h3>
            <form className="inline-form" onSubmit={(event) => void searchDirectory(event)}>
              <input value={directoryQuery} onChange={(event) => setDirectoryQuery(event.target.value)} placeholder="Search exact @username" pattern="@?[A-Za-z0-9_]{2,32}" required />
              <button className="primary-button compact" disabled={busy}>Search</button>
            </form>
            {directoryResults.map((friend) => <div className="friend-row" key={friend.user_sub}><span>{friend.user_name}</span><small>@{friend.username}</small><button className="subtle-button" onClick={() => { setFriendUsername(`@${friend.username}`); }}>Invite</button></div>)}
          </div>
          <div className="section-card">
            <h2>Rooms</h2>
            <button className="primary-button" onClick={() => void props.onCreateRoom()}>Create encrypted room</button>
            {props.rooms.filter((room) => !props.archivedRoomIds.includes(room.id)).map((room) => <div className={`room-list-row ${props.currentRoomId === room.id ? "current-room" : ""}`} key={room.id}><button className="room-list-open" onClick={() => props.onOpenRoom(room.id)}><span><strong>{room.name}</strong><small>{room.member_count} member{room.member_count === 1 ? "" : "s"}</small></span><span className="room-open-arrow">Open</span></button><button className="subtle-button room-archive-action" onClick={() => props.onArchiveRoom(room.id)}>Archive</button></div>)}
            <form className="inline-form" onSubmit={(event) => void joinRoom(event)}>
              <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="Paste room invite code" required />
              <button className="primary-button compact" disabled={busy}>Join</button>
            </form>
            <p className="muted-copy">Room links include an encryption key in the URL fragment. Share them only with intended participants.</p>
          </div>
        </div>
      )}
      {props.view === "archive" && (
        <div className="section-list">
          {props.rooms.filter((room) => props.archivedRoomIds.includes(room.id)).map((room) => (
            <article className="section-card archived-room-row" key={room.id}>
              <span><strong>{room.name}</strong><small>{room.member_count} member{room.member_count === 1 ? "" : "s"}</small></span>
              <button className="primary-button compact" onClick={() => props.onOpenRoom(room.id)}>Open</button>
              <button className="subtle-button" onClick={() => props.onUnarchiveRoom(room.id)}>Unarchive</button>
            </article>
          ))}
          {!props.rooms.some((room) => props.archivedRoomIds.includes(room.id)) && <div className="section-empty">No rooms are archived on this device.</div>}
        </div>
      )}
    </section>
  );
}
