"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import GenieBrandAvatar from "./GenieBrandAvatar";
import StealthVipModal from "./StealthVipModal";
import {
  Briefcase,
  Building2,
  ChevronDown,
  Info,
  PhoneCall,
  Mic,
  Activity,
  Settings,
  User,
  Users,
  Users2,
  Zap,
  X,
} from "lucide-react";

type SpaceMode = "personal" | "workspace";

interface HeaderMember {
  id: string;
  name: string;
  role: string;
  isOriginAdmin?: boolean;
  avatarUrl?: string;
  status: "active" | "inactive" | "different_room";
}

interface AdminTelemetry {
  total_registered: number;
  live_active: number;
  active_vips: number;
  vip_pool_remaining: number;
}

interface HeaderBarProps {
  spaceMode: SpaceMode;
  onSpaceModeChange: (mode: SpaceMode) => void;
  isTeamMode: boolean;
  onToggleTeamMode: () => void;
  isCorporateDomain: boolean;
  workspaceName: string;
  profileGender?: string;
  userEmail?: string;
  isPrimaryVip?: boolean;
  isAdmin?: boolean;
  corporateAvatarUrl?: string;
  corporateDisplayName?: string;
  corporateTenantId?: string;
  activeMemberCount: number;
  members: HeaderMember[];
  capacityLabel: string;
  chromeClass: string;
  chromeSurfaceClass: string;
  chromeBorderClass: string;
  chromeTextClass: string;
  chromeMutedTextClass: string;
  accentBorderClass: string;
  accentTextClass: string;
  activeClass: string;
  onOpenRoom: () => void;
  onOpenSocialDrawer: () => void;
  socialNotificationCount: number;
  onStartVoiceCall: () => void;
  onStartRoomCall: () => void;
  isCallActive: boolean;
  callStartedAt: string | null;
  onEndActiveCall: () => void;
  onClaimVip: (code: string, days: number) => Promise<void>;
  canAccessVoiceCall: boolean;
  onOpenSettings: () => void;
  isAuthenticated: boolean;
  isRoomHost: boolean;
  canInviteMembers: boolean;
  onPurgeContext: () => void;
  onCopyInvite: (mode: SpaceMode) => void;
  onLeaveRoom: () => void;
  onEndRoom: () => void;
  isSuperAdmin: boolean;
  adminTelemetry: AdminTelemetry | null;
  adminTelemetryError: string;
}

export default function HeaderBar({
  spaceMode,
  onSpaceModeChange,
  isTeamMode,
  onToggleTeamMode,
  isCorporateDomain,
  workspaceName,
  profileGender,
  userEmail,
  isPrimaryVip,
  isAdmin,
  corporateAvatarUrl,
  corporateDisplayName,
  corporateTenantId,
  activeMemberCount,
  members,
  capacityLabel,
  chromeClass,
  chromeSurfaceClass,
  chromeBorderClass,
  chromeTextClass,
  chromeMutedTextClass,
  accentBorderClass,
  accentTextClass,
  activeClass,
  onOpenRoom,
  onOpenSocialDrawer,
  socialNotificationCount,
  onStartVoiceCall,
  onStartRoomCall,
  isCallActive,
  callStartedAt,
  onEndActiveCall,
  onClaimVip,
  canAccessVoiceCall,
  onOpenSettings,
  isAuthenticated,
  isRoomHost,
  canInviteMembers,
  onPurgeContext,
  onCopyInvite,
  onLeaveRoom,
  onEndRoom,
  isSuperAdmin,
  adminTelemetry,
  adminTelemetryError,
}: HeaderBarProps) {
  const isAdminAvatarLocked =
    userEmail?.trim().toLowerCase() === "rshaji93@gmail.com" ||
    Boolean(isPrimaryVip || isAdmin);
  const [teamGuideOpen, setTeamGuideOpen] = useState(false);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const [vipModalOpen, setVipModalOpen] = useState(false);
  const [clockNow, setClockNow] = useState(0);
  const logoClickTimesRef = useRef<number[]>([]);
  useEffect(() => {
    if (!isCallActive) return;
    const initialTick = window.setTimeout(() => setClockNow(Date.now()), 0);
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(initialTick);
      window.clearInterval(timer);
    };
  }, [isCallActive]);
  const callStartTime = callStartedAt ? Date.parse(callStartedAt) : clockNow;
  const callElapsedSeconds = Number.isFinite(callStartTime)
    ? Math.max(0, Math.floor((clockNow - callStartTime) / 1000))
    : 0;
  const callDuration = `${String(Math.floor(callElapsedSeconds / 60)).padStart(2, "0")}:${String(callElapsedSeconds % 60).padStart(2, "0")}`;
  const handleBrandClick = () => {
    const now = Date.now();
    const clicks = [...logoClickTimesRef.current.filter((timestamp) => now - timestamp <= 2500), now];
    logoClickTimesRef.current = clicks;
    if (clicks.length === 5) {
      logoClickTimesRef.current = [];
      setVipModalOpen(true);
    }
  };
  const presenceCount = isTeamMode ? Math.max(1, activeMemberCount) : 1;
  const presenceDots = {
    active: members.filter((member) => member.status === "active").length,
    differentRoom: members.filter((member) => member.status === "different_room").length,
    inactive: members.filter((member) => member.status === "inactive").length,
  };

  return (
    <>
    <header className={`z-10 flex flex-shrink-0 items-center justify-between gap-2 border-b ${chromeBorderClass} ${chromeClass} px-3 py-2.5 ${chromeTextClass} shadow-lg sm:px-6 sm:py-3`}>
      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto overscroll-x-contain pl-10 sm:gap-3 lg:pl-0">
        <button
          type="button"
          onClick={handleBrandClick}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md text-left"
          aria-label="Personal AI Genie"
          title="Personal AI Genie"
        >
          {isAdminAvatarLocked ? (
            <Image
              src="/admin-avatar.png"
              width={64}
              height={64}
              alt="Admin Avatar"
              className="h-7 w-7 rounded-full border border-purple-500/30 object-cover shadow-lg sm:h-7 sm:w-7"
            />
          ) : (
            <GenieBrandAvatar
              gender={profileGender}
              mode={isCorporateDomain && spaceMode === "workspace" ? "workspace" : "personal"}
              corporatePhotoUrl={corporateAvatarUrl}
              corporateName={corporateDisplayName}
              tenantId={corporateTenantId}
              className="h-6 w-6 rounded-full object-cover sm:h-7 sm:w-7"
              label="Personal AI Genie"
            />
          )}
          <span className="hidden bg-gradient-to-r from-violet-500 via-pink-500 to-amber-500 bg-clip-text text-sm font-extrabold tracking-tight text-transparent sm:inline">
            Personal AI Genie
          </span>
        </button>

        {isCorporateDomain ? (
          <span className={`shrink-0 rounded-full border ${accentBorderClass} ${chromeSurfaceClass} px-3 py-1.5 text-[11px] font-bold ${accentTextClass}`}>
            <Briefcase className="mr-1 inline h-3.5 w-3.5" /> Workspace
          </span>
        ) : (
          <div className={`flex shrink-0 items-center rounded-full border ${accentBorderClass} ${chromeSurfaceClass} p-0.5`}>
            <button
            type="button"
            onClick={() => onSpaceModeChange("personal")}
            aria-pressed={spaceMode === "personal"}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors sm:gap-1.5 sm:px-4 sm:py-1.5 sm:text-xs ${
              spaceMode === "personal"
                ? `${activeClass} text-white shadow-sm`
                : `${chromeMutedTextClass} hover:bg-slate-100`
            }`}
          >
            <User className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            Personal
            </button>
            <button
            type="button"
            onClick={() => onSpaceModeChange("workspace")}
            aria-pressed={spaceMode === "workspace"}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors sm:gap-1.5 sm:px-4 sm:py-1.5 sm:text-xs ${
              spaceMode === "workspace"
                ? `${activeClass} text-white shadow-sm`
                : `${chromeMutedTextClass} hover:bg-slate-100`
            }`}
          >
            <Briefcase className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            Workspace
            </button>
          </div>
        )}

        <div
          className="relative shrink-0"
          onMouseEnter={() => setTeamGuideOpen(true)}
          onMouseLeave={() => setTeamGuideOpen(false)}
        >
          <button
            type="button"
            onClick={onToggleTeamMode}
            aria-pressed={isTeamMode}
            aria-expanded={teamGuideOpen}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-all sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs ${
              isTeamMode
                ? "border-transparent bg-gradient-to-r from-violet-600 via-pink-500 to-amber-400 text-white"
                : `${accentBorderClass} ${chromeSurfaceClass} ${chromeMutedTextClass} hover:bg-slate-100`
            }`}
          >
            {activeMemberCount <= 2 ? (
              <Users2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
            ) : (
              <Users className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
            )}
            {isCorporateDomain
              ? isTeamMode ? "Workspace Active" : "Workspace Room"
              : isTeamMode ? "Team Active" : "Team Sync"}
          </button>

          {teamGuideOpen && (
            <div className={`absolute left-0 top-full z-50 mt-2 w-72 rounded-2xl border ${chromeBorderClass} ${chromeSurfaceClass} p-3 ${chromeTextClass} shadow-2xl`}>
              <div className={`mb-1 flex items-center gap-1.5 border-b ${chromeBorderClass} pb-1 text-xs font-bold ${accentTextClass}`}>
                <Info className="h-3.5 w-3.5" />
                How Genie Team Chat Works
              </div>
              <ul className={`space-y-1 text-[11px] ${chromeMutedTextClass}`}>
                <li>Auto Identity: detects your Google Account dynamically.</li>
                <li>Active Cascade: multi-model failover prevents timeouts.</li>
                <li>Owner Sovereign: API key owner controls admins and passcodes.</li>
                <li>Intervene & Review: hosts can audit observer output.</li>
              </ul>
            </div>
          )}
        </div>

        {isTeamMode && (
          <button
            type="button"
            onClick={spaceMode === "personal" ? onOpenRoom : () => setSessionMenuOpen((open) => !open)}
            className={`shrink-0 rounded-full border ${accentBorderClass} ${chromeSurfaceClass} px-2 py-1 text-[10px] font-semibold ${accentTextClass} transition-colors hover:bg-slate-100 sm:px-2.5 sm:text-[11px]`}
          >
            Roster ({activeMemberCount}/{capacityLabel})
          </button>
        )}
      </div>

      <div className="flex shrink-0 flex-nowrap items-center gap-1.5 sm:gap-2">
        <span className={`hidden rounded-full border ${chromeBorderClass} ${chromeSurfaceClass} px-3 py-1 text-xs font-bold sm:flex sm:items-center sm:gap-1`}>
          {isCorporateDomain && <Building2 className={`h-3.5 w-3.5 ${accentTextClass}`} />}
          <span className="bg-gradient-to-r from-violet-400 via-pink-400 to-amber-300 bg-clip-text text-transparent">
            {workspaceName}
          </span>
        </span>
        <div className="relative">
          <button
            type="button"
            onClick={onOpenRoom}
            aria-label={spaceMode === "personal" ? `Personal room presence: ${presenceCount} of 5` : "Workspace member presence"}
            aria-expanded={sessionMenuOpen}
            className={`flex items-center gap-1 rounded-full border ${chromeBorderClass} ${chromeSurfaceClass} px-2.5 py-1.5 text-[11px] font-semibold ${chromeMutedTextClass}`}
          >
            <Users className="h-3.5 w-3.5" />
            {spaceMode === "personal" ? `${presenceCount}/5 ▾` : `${activeMemberCount} members ▾`}
            {isTeamMode && (
              <span className="ml-1 flex items-center gap-0.5" aria-label="Room presence status">
                {presenceDots.active > 0 && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title={`${presenceDots.active} active in this room`} />}
                {presenceDots.inactive > 0 && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title={`${presenceDots.inactive} offline or idle`} />}
                {presenceDots.differentRoom > 0 && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" title={`${presenceDots.differentRoom} active in another room`} />}
              </span>
            )}
          </button>
        </div>
        {!isCorporateDomain && (
          <button
            type="button"
            onClick={onOpenSocialDrawer}
            aria-label={`Open friend requests and social notifications${socialNotificationCount ? ` (${socialNotificationCount} unread)` : ""}`}
            title="Friend requests and social notifications"
            className={`relative flex shrink-0 items-center gap-1.5 rounded-full border ${chromeBorderClass} ${chromeSurfaceClass} px-2.5 py-1.5 text-[11px] font-semibold ${chromeMutedTextClass} hover:bg-slate-100`}
          >
            <Users className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Friends</span>
            {socialNotificationCount > 0 && (
              <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-rose-600 px-1 text-center text-[9px] font-bold leading-4 text-white">
                {socialNotificationCount > 99 ? "99+" : socialNotificationCount}
              </span>
            )}
          </button>
        )}
        {isCallActive ? (
          <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/50 bg-emerald-950/70 px-2.5 py-1.5 text-[11px] font-bold text-emerald-100 sm:px-3">
            <Activity className="h-3.5 w-3.5 animate-pulse text-emerald-300" />
            <span>In Call ({callDuration})</span>
            <span className="text-emerald-300">|</span>
            <button type="button" onClick={onEndActiveCall} className="text-rose-300 hover:text-rose-100">
              End Call 🔴
            </button>
          </div>
        ) : isTeamMode ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onStartRoomCall}
              className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-emerald-500"
              aria-label="Call Room"
              title="Ring participants in this shared room"
            >
              <PhoneCall className="h-3.5 w-3.5" />
              <span>Call Room</span>
            </button>
            <button
              type="button"
              onClick={onStartVoiceCall}
              className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-emerald-500"
              aria-label="Talk to Genie"
              title={canAccessVoiceCall ? "Talk to Genie without ringing room participants" : "Add a Gemini API key to enable voice"}
            >
              <Mic className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Talk to Genie</span>
              <span className="sm:hidden">Genie</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onStartVoiceCall}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-emerald-500"
            aria-label="Call Genie"
            title={canAccessVoiceCall ? "Start a voice session with Genie" : "Add a Gemini API key to enable voice"}
          >
            <PhoneCall className="h-3.5 w-3.5" />
            <span>Call Genie</span>
          </button>
        )}
        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => setTelemetryOpen(true)}
            className={`flex items-center gap-1 rounded-full border ${accentBorderClass} ${chromeSurfaceClass} px-2.5 py-1.5 text-[11px] font-bold ${accentTextClass}`}
            aria-label="Open live platform telemetry"
          >
            <Zap className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Telemetry</span>
          </button>
        )}
        <div className="relative flex items-center">
          <button
            type="button"
            onClick={isTeamMode ? onOpenRoom : onOpenSettings}
            className={`rounded-l-full border ${accentBorderClass} ${chromeSurfaceClass} p-1.5 ${chromeMutedTextClass} transition-colors hover:bg-slate-100 sm:p-2`}
            title={isTeamMode ? "Room Admin" : "Workspace Preferences"}
            aria-label={isTeamMode ? "Room Admin" : "Workspace Preferences"}
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setSessionMenuOpen((open) => !open)}
            aria-label="Room and sharing options"
            aria-expanded={sessionMenuOpen}
            className={`rounded-r-full border border-l-0 ${accentBorderClass} ${chromeSurfaceClass} px-1.5 py-2 ${accentTextClass} hover:bg-slate-100`}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {sessionMenuOpen && (
            <div className={`absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border ${chromeBorderClass} ${chromeSurfaceClass} p-2 ${chromeTextClass} shadow-2xl`}>
              <p className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${chromeMutedTextClass}`}>
                {isCorporateDomain ? "Organization directory · verified SSO tenant" : spaceMode === "personal" ? "Personal Room · up to 5 people" : "Workspace · member roles"}
              </p>
              {spaceMode === "workspace" && members.map((member) => (
                <div key={member.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px]">
                  <span className="truncate">{member.name}</span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold">
                    {member.isOriginAdmin
                      ? "Origin Admin"
                      : member.role === "delegated_admin" || member.role === "admin"
                        ? "Delegated Admin"
                        : member.role === "guest"
                          ? "Guest"
                          : "Member"}
                  </span>
                </div>
              ))}
              {isAuthenticated && !canInviteMembers ? (
                <p className="px-2.5 py-2 text-xs font-semibold text-slate-500">
                  Only the Room Owner or Workspace Origin Admin can invite members.
                </p>
              ) : isAuthenticated && (
                spaceMode === "personal" && presenceCount >= 5 ? (
                  <p className="px-2.5 py-2 text-xs font-semibold text-rose-600">Personal Room Full (Max 5)</p>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onCopyInvite(spaceMode);
                      setSessionMenuOpen(false);
                    }}
                    className="w-full rounded-xl px-2.5 py-2 text-left text-xs font-semibold hover:bg-slate-100"
                  >
                    {isCorporateDomain
                      ? "Create / copy tenant workspace invite"
                      : spaceMode === "personal" ? "+ Add another user" : "Create / copy workspace invite"}
                  </button>
                )
              )}
              {isTeamMode && (
                <>
                  <p className={`px-2 py-1 text-[10px] ${chromeMutedTextClass}`}>
                    {spaceMode === "personal"
                      ? `${Math.max(0, activeMemberCount - 1)} of 1 guest seats filled`
                      : `${activeMemberCount} of 5 seats filled`}
                  </p>
                  {isRoomHost ? (
                    <button
                      type="button"
                      onClick={() => {
                        onEndRoom();
                        setSessionMenuOpen(false);
                      }}
                      className="w-full rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      End Session
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        onLeaveRoom();
                        setSessionMenuOpen(false);
                      }}
                      className="w-full rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      Leave Room
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  onPurgeContext();
                  setSessionMenuOpen(false);
                }}
                className="w-full rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-rose-700 hover:bg-rose-50"
              >
                Purge Context
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
    {vipModalOpen && (
      <StealthVipModal
        onClose={() => setVipModalOpen(false)}
        onClaim={onClaimVip}
      />
    )}
    {isSuperAdmin && telemetryOpen && (
      <div className="fixed inset-0 z-[120] bg-slate-950/50 sm:flex sm:justify-end" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setTelemetryOpen(false);
      }}>
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-telemetry-title"
          className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-slate-950 p-5 text-slate-100 shadow-2xl sm:relative sm:inset-auto sm:h-full sm:max-h-none sm:w-[min(100vw,28rem)] sm:rounded-none sm:border-l sm:border-cyan-950"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-400">Aggregate-only telemetry</p>
              <h2 id="admin-telemetry-title" className="mt-1 flex items-center gap-2 text-lg font-extrabold">
                <Activity className="h-5 w-5 text-cyan-400" /> Platform Telemetry
              </h2>
            </div>
            <button type="button" onClick={() => setTelemetryOpen(false)} aria-label="Close telemetry" className="rounded-full p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
          {adminTelemetryError ? (
            <p role="status" className="mt-5 rounded-xl border border-rose-900 bg-rose-950/60 p-3 text-sm text-rose-200">{adminTelemetryError}</p>
          ) : !adminTelemetry ? (
            <p role="status" className="mt-5 animate-pulse text-sm text-slate-400">Loading live registry…</p>
          ) : (
            <>
              <div className="mt-5 grid grid-cols-2 gap-2">
                {[
                  ["Registered users", adminTelemetry.total_registered],
                  ["Active WebSockets", adminTelemetry.live_active],
                  ["Active VIP seats", adminTelemetry.active_vips],
                  ["VIP seats remaining", adminTelemetry.vip_pool_remaining],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
                    <p className="mt-1 text-2xl font-bold text-cyan-300">{value}</p>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-[10px] text-slate-500">Refreshes every 10 seconds. No individual identities, room IDs, content, or personal activity are exposed.</p>
            </>
          )}
        </section>
      </div>
    )}
    </>
  );
}
