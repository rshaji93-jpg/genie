"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  getLibrarySection,
  removeLibraryItem,
  type SocialProfile,
  type SocialProfileUpdate,
  type LibraryRecord,
  type LibrarySection,
} from "@/lib/api";
import type { WorkspaceView } from "./Sidebar";

interface SavedItem { id: string; content: string; createdAt: string }
interface ScheduleItem { id: string; title: string; at: string; notified?: boolean }
interface RoomSummary { id: string; name: string; member_count?: number }
interface FriendRequestItem { id: string; sender_name: string; sender_username: string; sender_sub?: string; avatar_data_url?: string | null }
interface OutgoingFriendRequestItem { id: string; receiver_name: string; receiver_username: string; receiver_sub?: string; avatar_data_url?: string | null }
interface FriendItem { user_sub: string; user_name: string; username: string | null; avatar_data_url?: string | null }
interface ActiveRoomMember { user_sub: string; user_name: string; username?: string }

interface WorkspacePanelProps {
  view: Exclude<WorkspaceView, "chat">;
  credential: string;
  savedItems: SavedItem[];
  onRemoveSaved: (id: string) => void;
  rooms: RoomSummary[];
  currentRoomId?: string;
  requests: FriendRequestItem[];
  outgoingRequests: OutgoingFriendRequestItem[];
  friends: FriendItem[];
  activeMembers: ActiveRoomMember[];
  currentUserSub: string;
  profile: SocialProfile;
  onSaveProfile: (profile: SocialProfileUpdate) => Promise<void>;
  onAvatarSelected: (file: File) => Promise<void>;
  onCallFriend: (userSub: string) => void;
  onAcceptRequest: (id: string) => Promise<void>;
  onRejectRequest: (id: string) => Promise<void>;
  onCancelRequest: (id: string) => Promise<void>;
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
  const [friendTab, setFriendTab] = useState<"incoming" | "friends" | "sent" | "discover">("incoming");
  const [profileName, setProfileName] = useState(props.profile.display_name);
  const [profileUsername, setProfileUsername] = useState(props.profile.username || "");
  const [profileDiscoverable, setProfileDiscoverable] = useState(props.profile.discoverable);
  const [profileBio, setProfileBio] = useState(props.profile.bio);
  const [profileSkills, setProfileSkills] = useState(props.profile.skills_offered.join(", "));
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [librarySection, setLibrarySection] = useState<LibrarySection>("living-graph");
  const [libraryRecords, setLibraryRecords] = useState<LibraryRecord[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  const libraryTabs: Array<{ id: LibrarySection; label: string }> = [
    { id: "living-graph", label: "Living Graph & Items" },
    { id: "ai-timeline", label: "AI Timeline" },
    { id: "genie-daily", label: "Genie Daily" },
    { id: "skill-dna", label: "Skill DNA & 10-Min Capsules" },
    { id: "trust-impact", label: "Trust & Impact Center" },
  ];

  useEffect(() => {
    setSchedule(storageRead<ScheduleItem[]>("genie_new_schedule", []));
  }, []);

  useEffect(() => {
    setProfileName(props.profile.display_name);
    setProfileUsername(props.profile.username || "");
    setProfileDiscoverable(props.profile.discoverable);
    setProfileBio(props.profile.bio);
    setProfileSkills(props.profile.skills_offered.join(", "));
  }, [props.profile]);

  useEffect(() => {
    if (props.view !== "library" || !props.credential) return;
    let cancelled = false;
    setLibraryLoading(true);
    setError("");
    void getLibrarySection(librarySection, props.credential)
      .then((result) => {
        if (!cancelled) setLibraryRecords(Array.isArray(result.items) ? result.items : []);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setLibraryRecords([]);
          if (librarySection !== "living-graph") {
            setError(caught instanceof Error ? caught.message : "This library section could not be loaded.");
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLibraryLoading(false);
      });
    return () => { cancelled = true; };
  }, [props.view, props.credential, librarySection]);

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

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await props.onSaveProfile({
        display_name: profileName.trim(),
        username: profileUsername.trim().replace(/^@/, ""),
        avatar_data_url: props.profile.avatar_data_url,
        bio: profileBio.trim(),
        skills_offered: profileSkills.split(",").map((skill) => skill.trim()).filter(Boolean),
        discoverable: profileDiscoverable,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your social profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(file: File) {
    setBusy(true);
    setError("");
    try {
      await props.onAvatarSelected(file);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Profile picture could not be saved.");
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

  async function requestMember(username: string) {
    setBusy(true);
    setError("");
    try {
      await props.onSendFriendRequest(username);
      setDirectoryResults(await props.onSearchDirectory(directoryQuery));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Friend request failed.");
    } finally {
      setBusy(false);
    }
  }

  const titles = {
    library: ["Library", "A private collection of answers you chose to keep."],
    scheduled: ["Scheduled", "Reminders stay in this browser. Genie does not receive them."],
    friends: ["Friends", "Complete your profile, then find and connect with discoverable members."],
  } as const;
  const [title, description] = titles[props.view];

  return (
    <section className="workspace-section">
      <div className="section-title"><span className="eyebrow">YOUR WORKSPACE</span><h1>{title}</h1><p>{description}</p></div>
      {error && <p className="section-error" role="alert">{error}</p>}
      {props.view === "library" && (
        <>
          <div className="library-tabs" role="tablist" aria-label="Genie Library sections">
            {libraryTabs.map((tab) => (
              <button
                aria-selected={librarySection === tab.id}
                className={librarySection === tab.id ? "library-tab library-tab-active" : "library-tab"}
                key={tab.id}
                onClick={() => setLibrarySection(tab.id)}
                role="tab"
                type="button"
              >{tab.label}</button>
            ))}
          </div>
          {libraryLoading && <p className="muted-copy" role="status">Loading {libraryTabs.find((tab) => tab.id === librarySection)?.label}…</p>}
          {librarySection === "living-graph" ? (
            <div className="section-list">
              {props.savedItems.map((item) => (
                <article className="section-card" key={item.id}>
                  <time>{new Date(item.createdAt).toLocaleString()}</time><p>{item.content}</p>
                  <button className="subtle-button" onClick={() => {
                    void removeLibraryItem(item.id, props.credential).catch(() => undefined);
                    props.onRemoveSaved(item.id);
                  }}>Remove</button>
                </article>
              ))}
              {libraryRecords.filter((record) => !props.savedItems.some((saved) => saved.id === record.id)).map((item) => (
                <article className="section-card" key={item.id}>
                  <time>{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</time>
                  {item.title && <strong>{item.title}</strong>}
                  <p>{item.content || item.summary || ""}</p>
                </article>
              ))}
              {!props.savedItems.length && !libraryRecords.length && !libraryLoading && (
                <div className="section-empty">Save any Genie answer from a chat to keep it here.</div>
              )}
            </div>
          ) : (
            <div className="section-list" role="tabpanel">
              {libraryRecords.map((item) => (
                <article className="section-card" key={item.id}>
                  <time>{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</time>
                  {item.title && <strong>{item.title}</strong>}
                  <p>{item.content || item.summary || "No details provided."}</p>
                </article>
              ))}
              {!libraryRecords.length && !libraryLoading && !error && (
                <div className="section-empty">Nothing here yet.</div>
              )}
            </div>
          )}
        </>
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
            <h2>Complete Your Social Profile to Connect with Friends</h2>
            <p className="muted-copy">Your profile is visible in member search only when you opt in to discovery.</p>
            <form className="social-profile-form" onSubmit={(event) => void saveProfile(event)}>
              <div className="social-profile-avatar">
                <button type="button" onClick={() => document.getElementById("social-profile-avatar-input")?.click()} aria-label="Upload profile picture">
                  {props.profile.avatar_data_url
                    ? <img src={props.profile.avatar_data_url} alt="" />
                    : <span>{profileName.slice(0, 1).toUpperCase() || "?"}</span>}
                </button>
                <input
                  id="social-profile-avatar-input"
                  accept="image/*"
                  className="visually-hidden"
                  type="file"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void uploadAvatar(file);
                    event.currentTarget.value = "";
                  }}
                />
                <span>Upload a profile picture</span>
              </div>
              <label>Display name<input value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={100} required /></label>
              <label>@Username<input value={profileUsername} onChange={(event) => setProfileUsername(event.target.value)} maxLength={32} pattern="[A-Za-z0-9_]{2,32}" placeholder="your_username" required /></label>
              <label>Bio<textarea value={profileBio} onChange={(event) => setProfileBio(event.target.value)} maxLength={500} rows={2} /></label>
              <label>Skills offered<input value={profileSkills} onChange={(event) => setProfileSkills(event.target.value)} maxLength={1800} placeholder="Design, tutoring, coding" /></label>
              <label className="discoverability-toggle">
                <input type="checkbox" checked={profileDiscoverable} onChange={(event) => setProfileDiscoverable(event.target.checked)} />
                Allow friends to discover my profile
              </label>
              <button className="primary-button" disabled={busy}>Save social profile</button>
              {props.profile.profile_completed && <span className="profile-complete-label">Profile complete</span>}
            </form>
            {props.profile.profile_completed && (
              <>
                <div className="friend-tabs" role="tablist" aria-label="Friends">
                  <button type="button" role="tab" aria-selected={friendTab === "incoming"} onClick={() => setFriendTab("incoming")}>Incoming Requests ({props.requests.length})</button>
                  <button type="button" role="tab" aria-selected={friendTab === "friends"} onClick={() => setFriendTab("friends")}>My Friends ({props.friends.length})</button>
                  <button type="button" role="tab" aria-selected={friendTab === "sent"} onClick={() => setFriendTab("sent")}>Sent Requests ({props.outgoingRequests.length})</button>
                  <button type="button" role="tab" aria-selected={friendTab === "discover"} onClick={() => {
                    setFriendTab("discover");
                    void props.onSearchDirectory("").then(setDirectoryResults).catch(() => setError("Member directory could not be loaded."));
                  }}>Find &amp; Discover Members</button>
                </div>
                {friendTab === "incoming" && (
                  <div>
                    {props.requests.map((request) => (
                      <div className="request-row" key={request.id}>
                        {request.avatar_data_url && <img className="friend-avatar" src={request.avatar_data_url} alt="" />}
                        <span><strong>{request.sender_name}</strong><small>@{request.sender_username}</small></span>
                        <span><button className="primary-button compact" disabled={busy} onClick={() => void respondToFriendRequest(request.id, true)}>✓ Accept</button><button className="subtle-button" disabled={busy} onClick={() => void respondToFriendRequest(request.id, false)}>✕ Decline</button></span>
                      </div>
                    ))}
                    {!props.requests.length && <p className="muted-copy">No incoming requests.</p>}
                  </div>
                )}
                {friendTab === "friends" && (
                  <div>
                    {props.friends.map((friend) => (
                      <div className="friend-row" key={friend.user_sub}>
                        {friend.avatar_data_url
                          ? <img className="friend-avatar" src={friend.avatar_data_url} alt="" />
                          : <span className="friend-avatar friend-avatar-fallback">{friend.user_name.slice(0, 1).toUpperCase()}</span>}
                        <span className={`presence-light ${props.activeMembers.some((member) => member.user_sub === friend.user_sub) ? "green" : "slate"}`} />
                        <span>{friend.user_name}</span><small>{friend.username ? `@${friend.username}` : "Username unavailable"}</small>
                        <span className="friends-actions">
                          <button className="subtle-button" disabled={!props.rooms.length} onClick={() => props.rooms[0] && props.onOpenRoom(props.rooms[0].id)} type="button">💬 Invite to Group Chat</button>
                          <button className="subtle-button" onClick={() => props.onCallFriend(friend.user_sub)} type="button">📞 Call</button>
                        </span>
                      </div>
                    ))}
                    {!props.friends.length && <p className="muted-copy">Your accepted friends will appear here.</p>}
                  </div>
                )}
                {friendTab === "sent" && (
                  <div>
                    {props.outgoingRequests.map((request) => (
                      <div className="request-row" key={request.id}>
                        <span><strong>{request.receiver_name}</strong><small>@{request.receiver_username}</small></span>
                        <span className="outgoing-request-actions">
                          <span className="request-sent-label">⏳ Waiting for approval</span>
                          <button className="subtle-button" disabled={busy} onClick={() => void props.onCancelRequest(request.id)} type="button">✕ Cancel</button>
                        </span>
                      </div>
                    ))}
                    {!props.outgoingRequests.length && <p className="muted-copy">No sent requests.</p>}
                  </div>
                )}
                {friendTab === "discover" && (
                  <div>
                    <form className="inline-form" onSubmit={(event) => void searchDirectory(event)}>
                      <input value={directoryQuery} onChange={(event) => setDirectoryQuery(event.target.value)} placeholder="Search name, @username, or email" maxLength={254} />
                      <button className="primary-button compact" disabled={busy}>Search</button>
                    </form>
                    <h3>Verified discoverable members</h3>
                    {directoryResults.map((friend) => {
                      const incoming = props.requests.find((item) => item.sender_sub === friend.user_sub);
                      const outgoing = props.outgoingRequests.find((item) => item.receiver_sub === friend.user_sub);
                      const isFriend = props.friends.some((item) => item.user_sub === friend.user_sub);
                      return (
                        <div className="friend-row" key={friend.user_sub}>
                          {friend.avatar_data_url && <img className="friend-avatar" src={friend.avatar_data_url} alt="" />}
                          <span>{friend.user_name}</span><small>{friend.username ? `@${friend.username}` : "Username unavailable"}</small>
                          {isFriend
                            ? <span className="friends-state-badge">✅ Friends</span>
                            : incoming
                              ? <span className="friends-actions">
                                <button className="primary-button compact" disabled={busy} onClick={() => void respondToFriendRequest(incoming.id, true)}>✓ Accept</button>
                                <button className="subtle-button" disabled={busy} onClick={() => void respondToFriendRequest(incoming.id, false)}>✕ Decline</button>
                              </span>
                              : outgoing
                                ? <span className="outgoing-request-actions">
                                  <span className="request-sent-label">⏳ Request Sent</span>
                                  <button className="subtle-button" disabled={busy} onClick={() => void props.onCancelRequest(outgoing.id)} type="button">✕ Cancel</button>
                                </span>
                                : <button className="primary-button compact" disabled={busy || !friend.username} onClick={() => friend.username && void requestMember(friend.username)} type="button">➕ Add Friend</button>}
                        </div>
                      );
                    })}
                    {!directoryResults.length && <p className="muted-copy">No verified discoverable members found.</p>}
                    <form className="inline-form" onSubmit={(event) => void submitFriend(event)}>
                      <input value={friendUsername} onChange={(event) => setFriendUsername(event.target.value)} placeholder="Add by @username" pattern="@?[A-Za-z0-9_]{2,32}" required />
                      <button className="primary-button compact" disabled={busy}>Add Friend</button>
                    </form>
                    {props.activeMembers.length > 0 && (
                      <>
                        <h3>Active room members</h3>
                        {props.activeMembers.filter((member) => member.user_sub !== props.currentUserSub).map((member) => (
                          <div className="request-row" key={member.user_sub}>
                            <span><strong>{member.user_name}</strong><small>{member.username ? `@${member.username}` : "Username unavailable"}</small></span>
                            <button className="primary-button compact" disabled={busy || !member.username || props.friends.some((item) => item.user_sub === member.user_sub)} onClick={() => member.username && void requestRoomMember(member.username)} type="button">➕ Add Friend</button>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="section-card">
            <h2>Rooms</h2>
            <button className="primary-button" onClick={() => void props.onCreateRoom()}>Create encrypted room</button>
            {props.rooms.map((room) => <div className={`room-list-row ${props.currentRoomId === room.id ? "current-room" : ""}`} key={room.id}><button className="room-list-open" onClick={() => props.onOpenRoom(room.id)}><span><strong>{room.name}</strong><small>{room.member_count} member{room.member_count === 1 ? "" : "s"}</small></span><span className="room-open-arrow">Open</span></button></div>)}
            <form className="inline-form" onSubmit={(event) => void joinRoom(event)}>
              <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="Paste room invite code" required />
              <button className="primary-button compact" disabled={busy}>Join</button>
            </form>
            <p className="muted-copy">Room links include an encryption key in the URL fragment. Share them only with intended participants.</p>
          </div>
        </div>
      )}
    </section>
  );
}
