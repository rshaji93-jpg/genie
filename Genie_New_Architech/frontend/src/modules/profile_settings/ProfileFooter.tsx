"use client";

import { CircleUserRound } from "lucide-react";

export default function ProfileFooter({ name, picture, tier, vip = false }: {
  name: string;
  picture?: string;
  tier: string;
  vip?: boolean;
}) {
  return (
    <span className="profile-footer-module">
      {picture ? <img alt="" src={picture} /> : <CircleUserRound size={18} />}
      <span><strong>{name}</strong><small>{tier}{vip && " · ✦ VIP"}</small></span>
    </span>
  );
}
