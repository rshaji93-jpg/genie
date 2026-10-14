"use client";

import React, { useEffect, useState } from "react";
import {
  Briefcase,
  Phone,
  PhoneOff,
  Settings,
  ShieldCheck,
  Sparkles,
  User,
  Users,
  ChevronDown,
  Trash2,
  Copy,
  LogOut,
} from "lucide-react";
import GenieBrandAvatar from "./GenieBrandAvatar";

export interface HeaderBarMember {
  id: string;
  name: string;
  role?: string;
  isOriginAdmin?: boolean;
  avatarUrl?: string;
  status?: "active" | "inactive" | "different_room";
}

export interface HeaderBarProps {
  spaceMode: "personal" | "workspace";
  onSpaceModeChange: (mode: "personal" | "workspace") => void;
  isTeamMode: boolean;
  onToggleTeamMode: () => void;
  isCorporateDomain?: boolean;
  workspaceName?: string;
  profileGender?: string;
  userEmail?: string;
  isPrimaryVip?: boolean;
  isAdmin?: boolean;
  corporateAvatarUrl?: string;
  corporateDisplayName?: string;
  corporateTenantId?: string;
  activeMemberCount: number;
  members: HeaderBarMember[];
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
  socialNotificationCount?: number;
  onStartVoiceCall: () => void;
  onStartRoomCall: () => void;
  isCallActive: boolean;
  callStartedAt: string | null;
  onEndActiveCall: () => void;
  onRequestVip?: (message: string) => Promise<void> | void;
  canAccessVoiceCall?: boolean;
  onOpenSettings: () => void;
  isAuthenticated: boolean;
  isRoomHost?: boolean;
  canInviteMembers?: boolean;
  onPurgeContext?: () => void;
  onCopyInvite?: (mode: "personal" | "workspace") => void;
  onLeaveRoom?: () => void;
  onEndRoom?: () => void;
  canSeeAdminTelemetry?: boolean;
  onOpenAdminDrawer?: () => void;
  onVerifyAdminKnock?: (code: string) => Promise<void>;
}

export default function HeaderBar({
  spaceMode,
  onSpaceModeChange,
  isTeamMode,
  onToggleTeamMode,
  isCorporateDomain = false,
  workspaceName = "Personal",
  profileGender = "",
  activeMemberCount,
  chromeClass,
  chromeBorderClass,
  onOpenRoom,
  onStartVoiceCall,
  onStartRoomCall,
  isCallActive,
  callStartedAt,
  onEndActiveCall,
  onOpenSettings,
  isRoomHost = false,
  onPurgeContext,
  onCopyInvite,
  onLeaveRoom,
  onEndRoom,
}: HeaderBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isCallActive || !callStartedAt) {
      setElapsedSeconds(0);
      return;
    }
    const startMs = Date.parse(callStartedAt) || Date.now();
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isCallActive, callStartedAt]);

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <header
      className={`relative z-30 flex min-h-16 w-full flex-nowrap items-center justify-between gap-3 border-b px-4 py-2.5 sm:px-6 ${chromeClass} ${chromeBorderClass}`}
    >
      {/* Left Brand + Mode Switcher */}
      <div className="flex shrink-0 items-center gap-3 pl-9 md:pl-0">
        <div className="flex items-center gap-2 pr-1">
          <GenieBrandAvatar
            gender={profileGender}
            label="Personal AI Genie"
            className="h-8 w-8 rounded-full shadow-sm"
          />
          <span className="hidden sm:inline font-extrabold text-sm tracking-tight bg-gradient-to-r from-violet-600 via-pink-500 to-amber-500 bg-clip-text text-transparent">
            Personal AI Genie
          </span>
        </div>

        {/* Personal / Workspace Pill */}
        <div className="inline-flex items-center rounded-full border border-slate-200 bg-white p-0.5 shadow-2xs">
          <button
            type="button"
            disabled={isCorporateDomain}
            onClick={() => onSpaceModeChange("personal")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-all ${
              spaceMode === "personal"
                ? "bg-sky-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 disabled:opacity-40"
            }`}
          >
            <User className="h-3.5 w-3.5" />
            <span>Personal</span>
          </button>
          <button
            type="button"
            onClick={() => onSpaceModeChange("workspace")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-all ${
              spaceMode === "workspace"
                ? "bg-sky-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Briefcase className="h-3.5 w-3.5" />
            <span>Workspace</span>
          </button>
        </div>

        {/* Team Sync Toggle */}
        <button
          type="button"
          onClick={onToggleTeamMode}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-all ${
            isTeamMode
              ? "border-violet-300 bg-violet-600 text-white shadow-xs"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          <span>Team Sync</span>
        </button>
      </div>

      {/* Right Controls: Friends & Telemetry removed from header per user specifications */}
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden xl:inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold bg-gradient-to-r from-violet-600 via-pink-500 to-amber-500 bg-clip-text text-transparent">
          {workspaceName}
        </span>

        <button
          type="button"
          onClick={onOpenRoom}
          title="Room members & capacity"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          <Users className="h-3.5 w-3.5 text-slate-500" />
          <span>{Math.max(1, activeMemberCount)}/5</span>
          <ChevronDown className="h-3 w-3 text-slate-400" />
        </button>

        {isCallActive ? (
          <button
            type="button"
            onClick={onEndActiveCall}
            className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-rose-700"
          >
            <PhoneOff className="h-3.5 w-3.5" />
            <span>End Call ({formatTimer(elapsedSeconds)})</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onStartRoomCall}
              title="Start a peer-to-peer call with your friends"
              className="inline-flex items-center gap-1.5 rounded-full bg-teal-700 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-teal-800"
            >
              <Phone className="h-3.5 w-3.5" />
              <span>Start Call</span>
            </button>

            {/* Call Genie with Sparkles icon */}
            <button
              type="button"
              onClick={onStartVoiceCall}
              title="Call Genie AI Agent"
              className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-white px-3.5 py-1.5 text-xs font-bold text-sky-700 shadow-2xs transition hover:bg-sky-50"
            >
              <Sparkles className="h-3.5 w-3.5 text-sky-600" />
              <span>Call Genie</span>
            </button>
          </>
        )}

        {/* Settings + Room Quick Actions Menu */}
        <div className="relative flex items-center rounded-full border border-slate-200 bg-white p-0.5">
          <button
            type="button"
            onClick={onOpenSettings}
            title="Workspace Preferences"
            aria-label="Workspace Preferences"
            className="rounded-full p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Session actions"
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>

          {menuOpen && (
            <div
              onMouseLeave={() => setMenuOpen(false)}
              className="absolute right-0 top-full z-50 mt-2 w-52 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl"
            >
              {onCopyInvite && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onCopyInvite(spaceMode);
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Copy className="h-3.5 w-3.5 text-sky-600" />
                  <span>Copy Room Invite Link</span>
                </button>
              )}
              {onPurgeContext && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onPurgeContext();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Trash2 className="h-3.5 w-3.5 text-amber-600" />
                  <span>Clear Local Chat Context</span>
                </button>
              )}
              {isTeamMode && onLeaveRoom && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onLeaveRoom();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-rose-700 hover:bg-rose-50"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Leave Room</span>
                </button>
              )}
              {isTeamMode && isRoomHost && onEndRoom && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onEndRoom();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold text-rose-700 hover:bg-rose-50"
                >
                  <PhoneOff className="h-3.5 w-3.5" />
                  <span>End Room for All</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
