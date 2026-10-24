"use client";

import { useState } from "react";
import { ShieldCheck, X } from "lucide-react";

export type ProfileVisibility = "public" | "friends" | "private";
export type FriendRequestSetting = "everyone" | "mutuals" | "nobody";

export interface BlockedPrivacyUser {
  id: string;
  name: string;
}

export interface PrivacySecurityModalProps {
  open: boolean;
  profileVisibility: ProfileVisibility;
  friendRequestSetting: FriendRequestSetting;
  friendsOnlyCalls: boolean;
  promptBeforeScreenShare: boolean;
  blockedUsers: BlockedPrivacyUser[];
  onClose: () => void;
  onProfileVisibilityChange: (value: ProfileVisibility) => void;
  onFriendRequestSettingChange: (value: FriendRequestSetting) => void;
  onFriendsOnlyCallsChange: (value: boolean) => void;
  onPromptBeforeScreenShareChange: (value: boolean) => void;
  onBlockUser: (user: BlockedPrivacyUser) => void;
  onUnblockUser: (userId: string) => void;
}

export default function PrivacySecurityModal(props: PrivacySecurityModalProps) {
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [error, setError] = useState("");

  if (!props.open) return null;

  const blockUser = () => {
    const id = userId.trim();
    const name = userName.trim();
    if (!id || !name) {
      setError("Enter both a user ID and display name.");
      return;
    }
    if (props.blockedUsers.some((user) => user.id === id)) {
      setError("That user is already blocked.");
      return;
    }
    props.onBlockUser({ id, name });
    setUserId("");
    setUserName("");
    setError("");
  };

  return (
    <div className="privacy-security-modal-backdrop" onMouseDown={props.onClose} role="presentation">
      <section
        aria-labelledby="privacy-security-title"
        aria-modal="true"
        className="privacy-security-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="privacy-security-modal-header">
          <div>
            <span className="privacy-security-modal-eyebrow"><ShieldCheck aria-hidden="true" size={14} /> PRIVACY & SECURITY</span>
            <h2 id="privacy-security-title">Your privacy controls</h2>
          </div>
          <button aria-label="Close privacy settings" className="privacy-security-modal-close" onClick={props.onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <div className="privacy-security-modal-settings">
          <label className="privacy-security-modal-field">
            Profile visibility
            <select onChange={(event) => props.onProfileVisibilityChange(event.target.value as ProfileVisibility)} value={props.profileVisibility}>
              <option value="public">Everyone</option>
              <option value="friends">Friends only</option>
              <option value="private">Only me</option>
            </select>
          </label>
          <label className="privacy-security-modal-field">
            Friend requests
            <select onChange={(event) => props.onFriendRequestSettingChange(event.target.value as FriendRequestSetting)} value={props.friendRequestSetting}>
              <option value="everyone">Everyone</option>
              <option value="mutuals">Mutual friends</option>
              <option value="nobody">Nobody</option>
            </select>
          </label>
          <label className="privacy-security-modal-toggle">
            <input checked={props.friendsOnlyCalls} onChange={(event) => props.onFriendsOnlyCallsChange(event.target.checked)} type="checkbox" />
            <span><strong>Friends-only calls</strong><small>Only friends can start or join calls with you.</small></span>
          </label>
          <label className="privacy-security-modal-toggle">
            <input checked={props.promptBeforeScreenShare} onChange={(event) => props.onPromptBeforeScreenShareChange(event.target.checked)} type="checkbox" />
            <span><strong>Confirm before screen sharing</strong><small>Ask before a screen is shared in a call.</small></span>
          </label>
        </div>

        <section aria-labelledby="privacy-security-blocked-title" className="privacy-security-modal-blocked">
          <h3 id="privacy-security-blocked-title">Blocked users</h3>
          {props.blockedUsers.length ? (
            <ul>
              {props.blockedUsers.map((user) => (
                <li key={user.id}>
                  <span><strong>{user.name}</strong><small>{user.id}</small></span>
                  <button aria-label={`Unblock ${user.name}`} onClick={() => props.onUnblockUser(user.id)} type="button">Unblock</button>
                </li>
              ))}
            </ul>
          ) : <p className="privacy-security-modal-empty">No blocked users.</p>}
          <div className="privacy-security-modal-block-form">
            <label>
              User ID
              <input autoComplete="off" onChange={(event) => setUserId(event.target.value)} value={userId} />
            </label>
            <label>
              Display name
              <input autoComplete="off" onChange={(event) => setUserName(event.target.value)} value={userName} />
            </label>
            <button className="privacy-security-modal-block-button" onClick={blockUser} type="button">Block user</button>
          </div>
          {error && <p className="privacy-security-modal-error" role="alert">{error}</p>}
        </section>
      </section>
    </div>
  );
}
