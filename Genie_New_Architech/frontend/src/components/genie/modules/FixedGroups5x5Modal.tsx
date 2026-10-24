"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

export interface FixedGroupFriend {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface FixedGroups5x5ModalProps {
  open: boolean;
  friends: FixedGroupFriend[];
  currentMembers: FixedGroupFriend[];
  currentUserId: string;
  roomTitle: string;
  roomIcon: string;
  onClose: () => void;
  onSaveSettings: (name: string, icon: string) => void | Promise<void>;
  onUpdateMembers: (memberIds: string[]) => void | Promise<void>;
}

export default function FixedGroups5x5Modal(props: FixedGroups5x5ModalProps) {
  const [title, setTitle] = useState(props.roomTitle);
  const [icon, setIcon] = useState(props.roomIcon);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTitle(props.roomTitle);
    setIcon(props.roomIcon);
    setSelectedIds([...new Set([props.currentUserId, ...props.currentMembers.map((member) => member.id)])]);
    setError("");
  }, [props.currentMembers, props.open, props.roomIcon, props.roomTitle]);

  const currentMemberIds = useMemo(
    () => new Set(props.currentMembers.map((member) => member.id)),
    [props.currentMembers],
  );
  const selectedMemberCount = selectedIds.length;

  if (!props.open) return null;

  const toggleFriend = (friendId: string) => {
    if (friendId === props.currentUserId) return;
    setSelectedIds((members) => {
      if (members.includes(friendId)) return members.filter((id) => id !== friendId);
      if (members.length >= 5) return members;
      return [...members, friendId];
    });
  };

  const save = async () => {
    const allowedIds = new Set([
      props.currentUserId,
      ...props.friends.map((friend) => friend.id),
      ...props.currentMembers.map((member) => member.id),
    ]);
    const memberIds = [...new Set([props.currentUserId, ...selectedIds])].filter((id) => allowedIds.has(id));
    if (memberIds.length > 5) {
      setError("A fixed group can have no more than five participants.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await props.onSaveSettings(title.trim(), icon.trim());
      await props.onUpdateMembers(memberIds.filter((id) => id !== props.currentUserId));
      props.onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The group could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed-groups-modal-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        aria-labelledby="fixed-groups-title"
        aria-modal="true"
        className="fixed-groups-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="fixed-groups-modal-header">
          <div>
            <span className="fixed-groups-modal-eyebrow">FIXED GROUP</span>
            <h2 id="fixed-groups-title">Edit group</h2>
          </div>
          <button aria-label="Close group editor" className="fixed-groups-modal-close" onClick={props.onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <label className="fixed-groups-modal-field">
          Group name
          <input maxLength={80} onChange={(event) => setTitle(event.target.value)} value={title} />
        </label>
        <label className="fixed-groups-modal-field">
          Group icon or image URL
          <input maxLength={500} onChange={(event) => setIcon(event.target.value)} value={icon} />
        </label>

        <fieldset className="fixed-groups-modal-friends">
          <legend>Members ({selectedMemberCount}/5)</legend>
          <p className="fixed-groups-modal-self" aria-label="You are included in this group">
            You are included
          </p>
          <ul>
            {props.friends.filter((friend) => friend.id !== props.currentUserId).map((friend) => {
              const checked = selectedIds.includes(friend.id);
              const isExisting = currentMemberIds.has(friend.id);
              return (
                <li key={friend.id}>
                  <label className="fixed-groups-modal-friend">
                    <input
                      checked={checked}
                      disabled={!checked && selectedMemberCount >= 5}
                      onChange={() => toggleFriend(friend.id)}
                      type="checkbox"
                    />
                    {friend.avatarUrl ? (
                      <img alt="" className="fixed-groups-modal-avatar" src={friend.avatarUrl} />
                    ) : (
                      <span aria-hidden="true" className="fixed-groups-modal-avatar fixed-groups-modal-avatar-fallback">
                        {friend.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span>{friend.name}</span>
                    {isExisting && <span className="fixed-groups-modal-member-status">Member</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        {error && <p className="fixed-groups-modal-error" role="alert">{error}</p>}
        <footer className="fixed-groups-modal-actions">
          <button className="fixed-groups-modal-secondary" onClick={props.onClose} type="button">Cancel</button>
          <button className="fixed-groups-modal-primary" disabled={saving} onClick={() => void save()} type="button">
            {saving ? "Saving…" : "Save group"}
          </button>
        </footer>
      </section>
    </div>
  );
}
