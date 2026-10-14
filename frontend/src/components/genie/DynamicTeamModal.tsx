"use client";

import { Users } from "lucide-react";

export type RoomCapacityMode = "pair" | "squad" | "custom" | "unlimited";

interface DynamicTeamModalProps {
  mode: RoomCapacityMode;
  spaceMode: "personal" | "workspace";
  customCapacity: number;
  activeMembers: number;
  historyVisibleBeforeJoin: boolean;
  allowMemberExport: boolean;
  canInviteMore: boolean;
  panelClass: string;
  borderClass: string;
  textClass: string;
  mutedTextClass: string;
  surfaceClass: string;
  onModeChange: (mode: RoomCapacityMode) => void;
  onCustomCapacityChange: (capacity: number) => void;
  onHistoryVisibilityChange: (allowed: boolean) => void;
  onMemberExportChange: (allowed: boolean) => void;
  onAddMember: () => void;
}

const CAPACITY_OPTIONS: {
  mode: RoomCapacityMode;
  title: string;
  detail: string;
}[] = [
  { mode: "pair", title: "Pair", detail: "2 people" },
  { mode: "squad", title: "Squad", detail: "Up to 5 people" },
  { mode: "custom", title: "Custom", detail: "Set a 2-5 limit" },
  { mode: "unlimited", title: "Room maximum", detail: "Up to 5 people" },
];

export default function DynamicTeamModal({
  mode,
  spaceMode,
  customCapacity,
  activeMembers,
  historyVisibleBeforeJoin,
  allowMemberExport,
  canInviteMore,
  panelClass,
  borderClass,
  textClass,
  mutedTextClass,
  surfaceClass,
  onModeChange,
  onCustomCapacityChange,
  onHistoryVisibilityChange,
  onMemberExportChange,
  onAddMember,
}: DynamicTeamModalProps) {
  const capacity = mode === "pair" ? 2 : mode === "custom" ? Math.min(5, customCapacity) : 5;
  const capacityLabel = `${capacity} (max 5)`;

  return (
    <section className={`space-y-2 rounded-2xl border ${borderClass} ${panelClass} ${textClass} p-3`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-cyan-300" />
          <div>
            <h4 className="text-xs font-bold">Room capacity</h4>
            <p className={`text-[10px] ${mutedTextClass}`}>
              {activeMembers} active {activeMembers === 1 ? "member" : "members"} · {capacityLabel} capacity
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CAPACITY_OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            onClick={() => onModeChange(option.mode)}
            aria-pressed={mode === option.mode}
            className={`rounded-xl border px-2.5 py-2 text-left transition-colors ${
              mode === option.mode
                ? `${borderClass} ${surfaceClass} ${textClass} shadow-sm`
                : `border-slate-200 ${surfaceClass} ${mutedTextClass} hover:border-slate-400`
            }`}
          >
            <span className="block text-[11px] font-bold">{option.title}</span>
            <span className="block text-[10px] text-slate-400">{option.detail}</span>
          </button>
        ))}
      </div>

      {mode === "custom" && (
        <label className="flex items-center justify-between gap-3 text-[11px] font-semibold text-slate-300">
          Custom member limit
          <input
            type="number"
            min={2}
            max={5}
            value={customCapacity}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= 2 && value <= 5) {
                onCustomCapacityChange(value);
              }
            }}
            className={`w-24 rounded-lg border ${borderClass} ${surfaceClass} px-2 py-1 text-right text-xs text-slate-800 outline-none focus:ring-2 focus:ring-slate-200`}
          />
        </label>
      )}

      <div className="space-y-2 border-t border-slate-200 pt-2">
        <label className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-700">
          <input
            type="checkbox"
            checked={historyVisibleBeforeJoin}
            onChange={(event) => onHistoryVisibilityChange(event.target.checked)}
            className="mt-0.5 accent-indigo-600"
          />
          <span>Allow new user to view past chat history</span>
        </label>
        {spaceMode === "workspace" && (
          <label className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-700">
            <input
              type="checkbox"
              checked={allowMemberExport}
              onChange={(event) => onMemberExportChange(event.target.checked)}
              className="mt-0.5 accent-indigo-600"
            />
            <span>Allow this member to export chat sessions</span>
          </label>
        )}
        <p className={`text-[10px] ${mutedTextClass}`}>
          These default-deny permissions apply to future invitees. Existing members keep their current access.
        </p>
      </div>
      {canInviteMore ? (
        <button
          type="button"
          onClick={onAddMember}
          className={`w-full rounded-xl border ${borderClass} ${surfaceClass} px-3 py-2 text-left text-[11px] font-semibold ${textClass} hover:bg-slate-50`}
        >
          + Add another user
        </button>
      ) : (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
          {spaceMode === "personal" ? "Personal Room Full (Max 5)" : "Workspace Room Full (Max 5)"}
        </p>
      )}
    </section>
  );
}
