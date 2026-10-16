"use client";

import { BarChart3, LockKeyhole, Users, X } from "lucide-react";

interface AdminStats {
  rooms: number;
  users: number;
  reviews: number;
  review_tokens: number;
  expires_at: number;
}

interface AdminDashboardProps {
  stats: AdminStats | null;
  onClose: () => void;
}

export default function AdminDashboard(props: AdminDashboardProps) {
  if (!props.stats) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="admin-modal dashboard-modal" role="dialog" aria-modal="true" aria-labelledby="dashboard-title">
        <button className="icon-button modal-close" onClick={props.onClose} aria-label="Close admin dashboard"><X size={17} /></button>
        <div className="admin-lock"><BarChart3 size={22} /></div>
        <span className="eyebrow">PASSKEY-VERIFIED · EXPIRES {new Date(props.stats.expires_at * 1000).toLocaleTimeString()}</span>
        <h2 id="dashboard-title">Admin Dashboard</h2>
        <p>Operational aggregate only. Encrypted room content is not accessible here.</p>
        <div className="admin-stats-grid">
          <div><Users size={16} /><strong>{props.stats.users}</strong><small>Registered users</small></div>
          <div><LockKeyhole size={16} /><strong>{props.stats.rooms}</strong><small>Encrypted rooms</small></div>
          <div><BarChart3 size={16} /><strong>{props.stats.reviews}</strong><small>AI reviews</small></div>
          <div><BarChart3 size={16} /><strong>{props.stats.review_tokens}</strong><small>Review tokens metered</small></div>
        </div>
        <button className="passkey-secondary" onClick={props.onClose}>Lock dashboard</button>
      </section>
    </div>
  );
}
