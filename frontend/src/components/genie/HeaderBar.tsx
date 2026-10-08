"use client";

import { useState } from "react";
import {
  Briefcase,
  Building2,
  ChevronDown,
  Info,
  Settings,
  Sparkles,
  User,
  Users,
} from "lucide-react";

type SpaceMode = "personal" | "workspace";

interface HeaderBarProps {
  spaceMode: SpaceMode;
  onSpaceModeChange: (mode: SpaceMode) => void;
  isTeamMode: boolean;
  onToggleTeamMode: () => void;
  isCorporateDomain: boolean;
  workspaceName: string;
  activeMemberCount: number;
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
  onOpenSettings: () => void;
}

export default function HeaderBar({
  spaceMode,
  onSpaceModeChange,
  isTeamMode,
  onToggleTeamMode,
  isCorporateDomain,
  workspaceName,
  activeMemberCount,
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
  onOpenSettings,
}: HeaderBarProps) {
  const [teamGuideOpen, setTeamGuideOpen] = useState(false);

  return (
    <header className={`z-10 flex flex-shrink-0 items-center justify-between gap-2 border-b ${chromeBorderClass} ${chromeClass} px-3 py-2.5 ${chromeTextClass} shadow-lg sm:px-6 sm:py-3`}>
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto pl-10 sm:gap-3 lg:pl-0">
        <span className="inline-flex shrink-0 items-center gap-1.5" aria-label="Personal AI Genie">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-tr from-violet-600 via-pink-500 to-amber-400 text-white shadow-sm sm:h-7 sm:w-7">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="hidden bg-gradient-to-r from-violet-500 via-pink-500 to-amber-500 bg-clip-text text-sm font-extrabold tracking-tight text-transparent sm:inline">
            Personal AI Genie
          </span>
        </span>

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
            <Users className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            {isTeamMode ? "Team Active" : "Team Sync"}
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
            onClick={onOpenRoom}
            className={`shrink-0 rounded-full border ${accentBorderClass} ${chromeSurfaceClass} px-2 py-1 text-[10px] font-semibold ${accentTextClass} transition-colors hover:bg-slate-100 sm:px-2.5 sm:text-[11px]`}
          >
            Roster ({activeMemberCount}/{capacityLabel})
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <span className={`hidden rounded-full border ${chromeBorderClass} ${chromeSurfaceClass} px-3 py-1 text-xs font-bold sm:flex sm:items-center sm:gap-1`}>
          {isCorporateDomain && <Building2 className={`h-3.5 w-3.5 ${accentTextClass}`} />}
          <span className="bg-gradient-to-r from-violet-400 via-pink-400 to-amber-300 bg-clip-text text-transparent">
            {workspaceName}
          </span>
        </span>
        <button
          type="button"
          onClick={onOpenSettings}
          className={`rounded-full border ${accentBorderClass} ${chromeSurfaceClass} p-1.5 ${chromeMutedTextClass} transition-colors hover:bg-slate-100 sm:p-2`}
          title="Workspace Preferences"
          aria-label="Workspace Preferences"
        >
          <Settings className="h-4 w-4" />
        </button>
        <ChevronDown className={`hidden h-3.5 w-3.5 ${accentTextClass} sm:block`} aria-hidden="true" />
      </div>
    </header>
  );
}
