"use client";

import { BarChart3, LockKeyhole, RefreshCw, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface AdminStats {
  rooms: number;
  users: number;
  reviews: number;
  review_tokens: number;
  expires_at: number;
}

interface Telemetry {
  daily_token_limit: number;
  daily_tokens_burned: number;
  free_keys_configured: number;
  free_keys_active: number;
  free_pool_capacity_estimate: number;
  estimated_dau_capacity: number;
  master_key_isolated: boolean;
  master_key_configured: boolean;
  gemini_free_pool_enabled: boolean;
  vip_pass_limit: number;
  vip_passes_allocated: number;
  vip_passes_claimed: number;
  vip_passes_active: number;
  vip_passes_paused: number;
}

interface VipPass {
  id: string;
  status: "active" | "paused" | "revoked" | "claimed";
  created_at: string;
  claimed_at: string | null;
}

interface OverflowRequest {
  id: string;
  requester: string;
  created_at: number;
}

interface PoolStatus {
  master_pool_enabled: boolean;
  master_key_configured: boolean;
  requests: OverflowRequest[];
}

interface AdminDashboardProps {
  stats: AdminStats | null;
  credential: string;
  adminToken: string;
  onClose: () => void;
}

export default function AdminDashboard(props: AdminDashboardProps) {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [passes, setPasses] = useState<VipPass[]>([]);
  const [poolStatus, setPoolStatus] = useState<PoolStatus | null>(null);
  const [dailyLimit, setDailyLimit] = useState("25");
  const [totpCode, setTotpCode] = useState("");
  const [oneTimeCode, setOneTimeCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!props.credential || !props.adminToken) return;
    const [nextTelemetry, nextPasses, nextPoolStatus] = await Promise.all([
      apiFetch<Telemetry>("/api/admin/telemetry", props.credential, {
        headers: { "X-Genie-Admin-Session": props.adminToken },
      }),
      apiFetch<VipPass[]>("/api/admin/vip-passes", props.credential, {
        headers: { "X-Genie-Admin-Session": props.adminToken },
      }),
      apiFetch<PoolStatus>("/api/admin/pool/overflow", props.credential, {
        headers: { "X-Genie-Admin-Session": props.adminToken },
      }),
    ]);
    setTelemetry(nextTelemetry);
    setDailyLimit(String(nextTelemetry.daily_token_limit));
    setPasses(nextPasses);
    setPoolStatus(nextPoolStatus);
  }, [props.adminToken, props.credential]);

  const refreshPool = useCallback(async () => {
    if (!props.credential || !props.adminToken) return;
    const nextPoolStatus = await apiFetch<PoolStatus>("/api/admin/pool/overflow", props.credential, {
      headers: { "X-Genie-Admin-Session": props.adminToken },
    });
    setPoolStatus(nextPoolStatus);
  }, [props.adminToken, props.credential]);

  useEffect(() => {
    if (!props.stats) return;
    const timer = window.setInterval(() => {
      void refreshPool().catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Pool status could not be refreshed.");
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [props.stats, refreshPool]);

  useEffect(() => {
    if (!props.stats) return;
    setError("");
    void refresh().catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "Admin telemetry could not be loaded.");
    });
  }, [props.stats, refresh]);

  if (!props.stats) return null;

  async function saveLimit() {
    setBusy(true);
    setError("");
    try {
      await apiFetch("/api/admin/telemetry/config", props.credential, {
        method: "POST",
        headers: { "X-Genie-Admin-Session": props.adminToken },
        body: JSON.stringify({ daily_limit: Number(dailyLimit) }),
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Daily allowance could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function updateVipPass(action: "mint" | "pause" | "resume" | "revoke" | "recycle", passId?: string) {
    setBusy(true);
    setError("");
    setOneTimeCode("");
    try {
      const result = await apiFetch<{ code?: string }>("/api/admin/vip-passes", props.credential, {
        method: "POST",
        headers: { "X-Genie-Admin-Session": props.adminToken },
        body: JSON.stringify({ action, pass_id: passId, totp_code: totpCode }),
      });
      if (result.code) setOneTimeCode(result.code);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "VIP pass could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleMasterPooling(enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      await apiFetch("/api/admin/pool/master-pooling", props.credential, {
        method: "POST",
        headers: { "X-Genie-Admin-Session": props.adminToken },
        body: JSON.stringify({ enabled }),
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Master-key pool setting could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleTelemetryGeminiPool(enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      await apiFetch("/api/admin/telemetry/gemini-pool", props.credential, {
        method: "POST",
        headers: { "X-Genie-Admin-Session": props.adminToken },
        body: JSON.stringify({ enabled }),
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gemini telemetry routing could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function decideOverflow(requestId: string, accept: boolean) {
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/admin/pool/overflow/${encodeURIComponent(requestId)}`, props.credential, {
        method: "POST",
        headers: { "X-Genie-Admin-Session": props.adminToken },
        body: JSON.stringify({ accept }),
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Overflow request could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="admin-modal dashboard-modal" role="dialog" aria-modal="true" aria-labelledby="dashboard-title">
        <button className="icon-button modal-close" onClick={props.onClose} aria-label="Close admin dashboard"><X size={17} /></button>
        <div className="admin-lock"><BarChart3 size={22} /></div>
        <span className="eyebrow">PASSKEY-VERIFIED · EXPIRES {new Date(props.stats.expires_at * 1000).toLocaleTimeString()}</span>
        <h2 id="dashboard-title">Admin Telemetry</h2>
        <p>Operational aggregates only. Encrypted room content and provider credentials are never shown.</p>
        <div className="admin-stats-grid">
          <div><Users size={16} /><strong>{props.stats.users}</strong><small>Registered users</small></div>
          <div><LockKeyhole size={16} /><strong>{props.stats.rooms}</strong><small>Encrypted rooms</small></div>
          <div><BarChart3 size={16} /><strong>{props.stats.reviews}</strong><small>AI reviews</small></div>
          <div><BarChart3 size={16} /><strong>{props.stats.review_tokens}</strong><small>Review tokens metered</small></div>
        </div>

        {telemetry && (
          <>
            <div className="admin-stats-grid">
              <div><BarChart3 size={16} /><strong>{telemetry.daily_tokens_burned}</strong><small>AI tokens charged · rolling 24h</small></div>
              <div><BarChart3 size={16} /><strong>{telemetry.free_keys_active}/{telemetry.free_keys_configured}</strong><small>Free keys currently available</small></div>
              <div><LockKeyhole size={16} /><strong>{telemetry.master_key_isolated ? "Isolated" : "Check configuration"}</strong><small>Master key access boundary</small></div>
              <div><Users size={16} /><strong>{telemetry.estimated_dau_capacity.toLocaleString()}</strong><small>Estimated DAU at current limit (pool estimate)</small></div>
            </div>
            <p className="admin-telemetry-note">
              Free pool capacity estimate: {telemetry.free_pool_capacity_estimate.toLocaleString()} requests/day ·
              Master key {telemetry.master_key_configured ? "configured" : "not configured"}.
            </p>
            <section className="admin-vip-section" aria-label="Admin telemetry model routing">
              <h3>Telemetry-gated Gemini routing</h3>
              <p>When enabled, complex reasoning requests may use the Gemini free pool. Standard requests stay on the primary provider chain.</p>
              <label className="settings-checkbox">
                <input
                  checked={telemetry.gemini_free_pool_enabled}
                  disabled={busy}
                  onChange={(event) => void toggleTelemetryGeminiPool(event.target.checked)}
                  type="checkbox"
                />
                Gemini free pool: {telemetry.gemini_free_pool_enabled ? "ON" : "OFF"}
              </label>
            </section>
            {poolStatus && (
              <section className="admin-vip-section" aria-label="Free pool overflow controls">
                <h3>Pool Master Key with 9 Free Keys: {poolStatus.master_pool_enabled ? "ON" : "OFF"}</h3>
                <p>The pay-as-you-go key remains isolated unless you enable it here and approve a staged request.</p>
                <label className="settings-checkbox">
                  <input
                    checked={poolStatus.master_pool_enabled}
                    disabled={busy || !poolStatus.master_key_configured}
                    onChange={(event) => void toggleMasterPooling(event.target.checked)}
                    type="checkbox"
                  />
                  Pool Master Key with 9 Free Keys: {poolStatus.master_pool_enabled ? "ON" : "OFF"}
                </label>
                {!poolStatus.master_key_configured && <p role="status">Master key is not configured.</p>}
                {poolStatus.requests.map((request) => (
                  <div className="admin-vip-row" key={request.id} role="alert">
                    <span>Free pool exhausted · {request.requester} · {new Date(request.created_at * 1000).toLocaleTimeString()}</span>
                    <button disabled={busy || !poolStatus.master_pool_enabled} onClick={() => void decideOverflow(request.id, true)}>Accept</button>
                    <button disabled={busy} onClick={() => void decideOverflow(request.id, false)}>Reject</button>
                  </div>
                ))}
                {!poolStatus.requests.length && <p>No overflow requests are waiting.</p>}
              </section>
            )}
            <div className="admin-config-row">
              <label htmlFor="daily-token-limit">Hidden daily allowance</label>
              <select id="daily-token-limit" value={dailyLimit} onChange={(event) => setDailyLimit(event.target.value)}>
                {[10, 15, 20, 25].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <button className="passkey-secondary" disabled={busy} onClick={() => void saveLimit()}>
                Apply live
              </button>
            </div>
            <section className="admin-vip-section">
              <h3>Master-key VIP passes · {telemetry.vip_passes_allocated}/{telemetry.vip_pass_limit} allocated</h3>
              <p>{telemetry.vip_passes_claimed} claimed · {telemetry.vip_passes_active} active · {telemetry.vip_passes_paused} paused</p>
              <label htmlFor="vip-totp">Genesis authenticator code</label>
              <input
                id="vip-totp"
                inputMode="numeric"
                maxLength={6}
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ""))}
                placeholder="6-digit code"
              />
              <button
                className="passkey-secondary"
                disabled={busy || telemetry.vip_passes_allocated >= telemetry.vip_pass_limit}
                onClick={() => void updateVipPass("mint")}
              >
                Mint VIP pass
              </button>
              {passes.map((pass) => (
                <div className="admin-vip-row" key={pass.id}>
                  <strong>{pass.id}</strong><span>{pass.status}</span>
                  {(pass.status === "active" || pass.status === "claimed") && <button disabled={busy} onClick={() => void updateVipPass("pause", pass.id)}>Pause</button>}
                  {pass.status === "paused" && <button disabled={busy} onClick={() => void updateVipPass("resume", pass.id)}>Resume</button>}
                  {pass.status !== "revoked" && <button disabled={busy} onClick={() => void updateVipPass("revoke", pass.id)}>Revoke</button>}
                  {(pass.status === "revoked" || pass.status === "claimed") && <button disabled={busy} onClick={() => void updateVipPass("recycle", pass.id)}>Recycle</button>}
                </div>
              ))}
              {oneTimeCode && <p className="admin-one-time-code" role="status">Copy this pass code now; it is shown once: <code>{oneTimeCode}</code></p>}
            </section>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <button className="passkey-secondary" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw size={14} /> Refresh telemetry
        </button>
        <button className="passkey-secondary" onClick={props.onClose}>Lock dashboard</button>
      </section>
    </div>
  );
}
