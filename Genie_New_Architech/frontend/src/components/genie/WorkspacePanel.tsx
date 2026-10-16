"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { WorkspaceView } from "./Sidebar";

interface SavedItem { id: string; content: string; createdAt: string }
interface ScheduleItem { id: string; title: string; at: string; notified?: boolean }
interface RoomSummary { id: string; name: string; member_count?: number }
interface FriendRequestItem { id: string; sender_name: string; email: string }
interface FriendItem { user_sub: string; user_name: string; email: string }

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
  onAcceptRequest: (id: string) => Promise<void>;
  onRejectRequest: (id: string) => Promise<void>;
  onSendFriendRequest: (email: string) => Promise<void>;
  onRegisterPhone: (phone: string) => Promise<void>;
  onMetaSync: (phoneNumbers: string[]) => Promise<FriendItem[]>;
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
  const [friendEmail, setFriendEmail] = useState("");
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [directoryResults, setDirectoryResults] = useState<FriendItem[]>([]);
  const [registeredPhone, setRegisteredPhone] = useState("");
  const [contactPhones, setContactPhones] = useState("");
  const [mutualContacts, setMutualContacts] = useState<FriendItem[]>([]);
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
      await props.onSendFriendRequest(friendEmail);
      setFriendEmail("");
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

  async function registerPhone(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await props.onRegisterPhone(registeredPhone);
      setRegisteredPhone("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Phone registration failed.");
    } finally {
      setBusy(false);
    }
  }

  async function syncContacts(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const contacts = contactPhones.split(/[\n,;]+/).map((phone) => phone.trim()).filter(Boolean);
      setMutualContacts(await props.onMetaSync(contacts));
      setContactPhones("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "MetaSync could not check contacts.");
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

  const titles = {
    library: ["Library", "A private collection of answers you chose to keep."],
    scheduled: ["Scheduled", "Reminders stay in this browser. Genie does not receive them."],
    friends: ["Friends", "Friend requests, contact discovery, and encrypted room invitations."],
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
            {props.requests.map((request) => (
              <div className="request-row" key={request.id}><span><strong>{request.sender_name}</strong><small>{request.email}</small></span><span><button className="primary-button compact" disabled={busy} onClick={() => void respondToFriendRequest(request.id, true)}>Accept</button><button className="subtle-button" disabled={busy} onClick={() => void respondToFriendRequest(request.id, false)}>Decline</button></span></div>
            ))}
            {!props.requests.length && <p className="muted-copy">No pending requests.</p>}
            <h3>Your friends</h3>
            {props.friends.map((friend) => <div className="friend-row" key={friend.user_sub}><span className="presence-light green" /><span>{friend.user_name}</span><small>{friend.email}</small></div>)}
            <form className="inline-form" onSubmit={(event) => void submitFriend(event)}>
              <input type="email" value={friendEmail} onChange={(event) => setFriendEmail(event.target.value)} placeholder="Invite by Google email" required />
              <button className="primary-button compact" disabled={busy}>Send</button>
            </form>
            <h3>Find a Genie contact</h3>
            <form className="inline-form" onSubmit={(event) => void searchDirectory(event)}>
              <input value={directoryQuery} onChange={(event) => setDirectoryQuery(event.target.value)} placeholder="Search name or email" minLength={2} required />
              <button className="primary-button compact" disabled={busy}>Search</button>
            </form>
            {directoryResults.map((friend) => <div className="friend-row" key={friend.user_sub}><span>{friend.user_name}</span><small>{friend.email}</small><button className="subtle-button" onClick={() => { setFriendEmail(friend.email); }}>Invite</button></div>)}
          </div>
          <div className="section-card">
            <h2>MetaSync mutual contacts</h2>
            <p className="muted-copy">Your phone number is stored for account discovery; uploaded contacts are normalized and keyed-hashed before storage. Only mutual matches are returned.</p>
            <form className="inline-form" onSubmit={(event) => void registerPhone(event)}>
              <input type="tel" value={registeredPhone} onChange={(event) => setRegisteredPhone(event.target.value)} placeholder="Register your phone (+country code)" required />
              <button className="primary-button compact" disabled={busy}>Register</button>
            </form>
            <form className="section-form" onSubmit={(event) => void syncContacts(event)}>
              <textarea value={contactPhones} onChange={(event) => setContactPhones(event.target.value)} placeholder="Paste phone contacts, separated by commas or new lines" rows={3} required />
              <button className="primary-button" disabled={busy}>Find mutual contacts</button>
            </form>
            {mutualContacts.map((friend) => <div className="friend-row" key={friend.user_sub}><span>{friend.user_name}</span><small>{friend.email}</small></div>)}
            {!mutualContacts.length && <p className="muted-copy">No mutual matches shown yet.</p>}
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
