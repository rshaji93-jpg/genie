"use client";

import { BarChart3, LockKeyhole, RefreshCw, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch, apiFetchAdminTelemetry } from "@/lib/api";

function isBackendUnavailable(error: unknown): boolean {
  return error instanceof TypeError
    || (error instanceof ApiError && (error.status === 401 || error.status === 404));
}

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
  provider_waterfall: string;
  vip_pass_limit: number;
  vip_passes_allocated: number;
  vip_passes_claimed: number;
  vip_passes_active: number;
  vip_passes_paused: number;
  cache_hits: number;
  cache_lookups: number;
  cache_hit_rate_pct: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  pool_metrics: PoolMetric[];
  vip_pass_rows?: VipPass[];
  investor_impact: {
    library_items: number;
    completed_skill_capsules: number;
    non_cash_time_credits_earned: number;
  };
}

interface PoolMetric {
  id: string;
  name: string;
  requests: number;
  configured: boolean;
}

const BASELINE_TELEMETRY: Telemetry = {
  daily_token_limit: 25,
  daily_tokens_burned: 0,
  provider_waterfall: "Gemini-Free Argon Brain Waterfall",
  vip_pass_limit: 20,
  vip_passes_allocated: 0,
  vip_passes_claimed: 0,
  vip_passes_active: 0,
  vip_passes_paused: 0,
  cache_hits: 0,
  cache_lookups: 0,
  cache_hit_rate_pct: 0,
  latency_p50_ms: 0,
  latency_p95_ms: 0,
  pool_metrics: [
    { id: "pool0", name: "Pool 0 · Local Cache", requests: 0, configured: true },
    { id: "pool1", name: "Pool 1 · Groq / Cerebras 70B", requests: 0, configured: false },
    { id: "pool2", name: "Pool 2 · OpenRouter / GitHub Models 70B", requests: 0, configured: false },
    { id: "pool3", name: "Pool 3 · Mistral", requests: 0, configured: false },
    { id: "pool4", name: "Pool 4 · OpenAI Zero-Key Gateway", requests: 0, configured: true },
    { id: "pool5", name: "Pool 5 · Cloudflare Utility", requests: 0, configured: false },
  ],
  investor_impact: {
    library_items: 0,
    completed_skill_capsules: 0,
    non_cash_time_credits_earned: 0,
  },
};

interface VipPass {
  id: string;
  status: "active" | "paused" | "revoked" | "claimed";
  created_at: string;
  claimed_at: string | null;
}

interface AdminDashboardProps {
  stats: AdminStats | null;
  credential: string;
  adminToken: string;
  localOnly?: boolean;
  onLocalFallback: () => boolean;
  onClose: () => void;
}

export default function AdminDashboard(props: AdminDashboardProps) {
  const [telemetry, setTelemetry] = useState<Telemetry>(BASELINE_TELEMETRY);
  const [passes, setPasses] = useState<VipPass[]>([]);
  const [dailyLimit, setDailyLimit] = useState("25");
  const [totpCode, setTotpCode] = useState("");
  const [oneTimeCode, setOneTimeCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (props.localOnly) return;
    const [telemetryResult, passesResult] = await Promise.allSettled([
      apiFetchAdminTelemetry<Telemetry>(props.credential, props.adminToken),
      apiFetch<VipPass[]>("/api/admin/vip-passes", props.credential, {
        headers: { "X-Genie-Admin-Session": props.adminToken },
      }),
    ]);

    if (telemetryResult.status === "fulfilled") {
      const nextTelemetry = telemetryResult.value;
      setTelemetry({
        ...BASELINE_TELEMETRY,
        ...nextTelemetry,
        pool_metrics: nextTelemetry.pool_metrics?.length
          ? nextTelemetry.pool_metrics
          : BASELINE_TELEMETRY.pool_metrics,
        investor_impact: {
          ...BASELINE_TELEMETRY.investor_impact,
          ...nextTelemetry.investor_impact,
        },
      });
      setDailyLimit(String(telemetryResult.value.daily_token_limit));
      setError("");
      if (passesResult.status === "rejected" && nextTelemetry.vip_pass_rows) {
        setPasses(nextTelemetry.vip_pass_rows);
      }
    } else {
      if (isBackendUnavailable(telemetryResult.reason) && props.onLocalFallback()) return;
      setError(telemetryResult.reason instanceof Error
        ? telemetryResult.reason.message
        : "Admin telemetry could not be loaded; showing baseline metrics.");
    }
    if (passesResult.status === "fulfilled") setPasses(passesResult.value);
  }, [props.adminToken, props.credential, props.localOnly, props.onLocalFallback]);

  useEffect(() => {
    if (!props.stats) return;
    setError("");
    void refresh().catch((caught: unknown) => {
      if (isBackendUnavailable(caught) && props.onLocalFallback()) return;
      setError(caught instanceof Error ? caught.message : "Admin telemetry could not be loaded.");
    });
  }, [props.localOnly, props.onLocalFallback, props.stats, refresh]);

  if (!props.stats) return null;
  const hasConfiguredProvider = telemetry.pool_metrics.some((pool) => pool.configured);
  const systemStatus = error
    ? "Error"
    : hasConfiguredProvider
      ? "Operational"
      : "Fallback";
  const fallbackReason = "No AI providers are currently configured.";

  async function saveLimit() {
    if (props.localOnly) return;
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
    if (props.localOnly) return;
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

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="admin-modal dashboard-modal" role="dialog" aria-modal="true" aria-labelledby="dashboard-title">
        <button className="icon-button modal-close" onClick={props.onClose} aria-label="Close admin dashboard"><X size={17} /></button>
        <div className="admin-lock"><BarChart3 size={22} /></div>
        <span className="eyebrow">PASSKEY-VERIFIED · EXPIRES {new Date(props.stats.expires_at * 1000).toLocaleTimeString()}</span>
        <h2 id="dashboard-title">Admin Telemetry</h2>
        <p>{telemetry.provider_waterfall}</p>
        <p>Operational aggregates only. Encrypted room content and provider credentials are never shown.</p>
        {systemStatus && (
          <div className="admin-system-status" role="status">
            <span className={`admin-status-badge admin-status-${systemStatus.toLowerCase()}`}>
              {systemStatus === "Operational" ? "🟢 Operational" : systemStatus === "Fallback" ? "🟡 Fallback" : "🔴 Error"}
            </span>
            {systemStatus === "Fallback" && <span>{fallbackReason}</span>}
            {error && <details className="admin-diagnostic">
              <summary>View diagnostic trace</summary>
              <pre>{error}</pre>
            </details>}
          </div>
        )}
        <div className="admin-stats-grid">
          <div><Users size={16} /><strong>{props.stats.users}</strong><small>Registered users</small></div>
          <div><LockKeyhole size={16} /><strong>{props.stats.rooms}</strong><small>Encrypted rooms</small></div>
          <div><BarChart3 size={16} /><strong>{props.stats.reviews}</strong><small>AI reviews</small></div>
          <div><BarChart3 size={16} /><strong>{props.stats.review_tokens}</strong><small>Review tokens metered</small></div>
        </div>

        <section className="admin-vip-section" aria-label="Global AI pool telemetry">
          <h3>Gemini-Free Argon Brain Waterfall</h3>
          {(props.localOnly || error) && (
            <p role="status">Showing baseline metrics; live values update when the authenticated backend responds.</p>
          )}
          <div className="admin-vip-row"><strong>Pool</strong><strong>Requests</strong><strong>State</strong></div>
          {telemetry.pool_metrics.map((pool) => (
            <div className="admin-vip-row" key={pool.id}>
              <span>{pool.name}</span>
              <span>{pool.requests.toLocaleString()}</span>
              <span>{pool.configured ? "Configured" : "Not configured"}</span>
            </div>
          ))}
          <div className="admin-stats-grid">
            <div><BarChart3 size={16} /><strong>{telemetry.cache_hit_rate_pct.toFixed(2)}%</strong><small>Global cache hit rate · {telemetry.cache_hits}/{telemetry.cache_lookups} lookups</small></div>
            <div><BarChart3 size={16} /><strong>{telemetry.latency_p50_ms.toFixed(2)} ms</strong><small>Provider p50 latency</small></div>
            <div><BarChart3 size={16} /><strong>{telemetry.latency_p95_ms.toFixed(2)} ms</strong><small>Provider p95 latency</small></div>
            <div><Users size={16} /><strong>{telemetry.vip_pass_limit}</strong><small>VIP pass allocation limit</small></div>
          </div>
          <h3>Investor Impact Metrics</h3>
          <div className="admin-stats-grid">
            <div><BarChart3 size={16} /><strong>{telemetry.investor_impact.library_items}</strong><small>Ready Library items</small></div>
            <div><BarChart3 size={16} /><strong>{telemetry.investor_impact.completed_skill_capsules}</strong><small>Completed skill capsules</small></div>
            <div><BarChart3 size={16} /><strong>{telemetry.investor_impact.non_cash_time_credits_earned}</strong><small>Non-cash time credits earned</small></div>
          </div>
        </section>

        {!props.localOnly && (
          <>
            <div className="admin-stats-grid">
              <div><BarChart3 size={16} /><strong>{telemetry.daily_tokens_burned}</strong><small>AI tokens charged · rolling 24h</small></div>
              <div><Users size={16} /><strong>{telemetry.vip_passes_active}</strong><small>Active VIP passes</small></div>
            </div>
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
