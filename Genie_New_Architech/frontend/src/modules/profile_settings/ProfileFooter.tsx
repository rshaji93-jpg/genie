"use client";

import { CircleUserRound } from "lucide-react";

export default function ProfileFooter({ name, picture, onAvatarClick, onProfileTap }: {
  name: string;
  picture?: string;
  onAvatarClick: () => void;
  onProfileTap: () => void;
}) {
  return (
    <span className="profile-footer-module">
      <button className="profile-avatar-upload" onClick={onAvatarClick} aria-label="Upload profile picture" type="button">
        {picture ? <img alt="" src={picture} /> : <CircleUserRound size={18} />}
      </button>
      <button className="profile-footer-details" onClick={onProfileTap} aria-label="Open profile" type="button">
        <strong>{name}</strong>
      </button>
    </span>
  );
}
