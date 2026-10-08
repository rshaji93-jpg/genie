"use client";

import { Users } from "lucide-react";

export type RoomCapacityMode = "pair" | "squad" | "custom" | "unlimited";

interface DynamicTeamModalProps {
  mode: RoomCapacityMode;
  customCapacity: number;
  activeMembers: number;
  panelClass: string;
  borderClass: string;
  textClass: string;
  mutedTextClass: string;
  surfaceClass: string;
  onModeChange: (mode: RoomCapacityMode) => void;
  onCustomCapacityChange: (capacity: number) => void;
}

const CAPACITY_OPTIONS: {
  mode: RoomCapacityMode;
  title: string;
  detail: string;
}[] = [
  { mode: "pair", title: "Pair", detail: "2 people" },
  { mode: "squad", title: "Squad", detail: "Up to 10 people" },
  { mode: "custom", title: "Custom", detail: "Set a room limit" },
  { mode: "unlimited", title: "Unlimited", detail: "No member cap" },
];

export default function DynamicTeamModal({
  mode,
  customCapacity,
  activeMembers,
  panelClass,
  borderClass,
  textClass,
  mutedTextClass,
  surfaceClass,
  onModeChange,
  onCustomCapacityChange,
}: DynamicTeamModalProps) {
  const capacity = mode === "pair" ? 2 : mode === "squad" ? 10 : mode === "custom" ? customCapacity : null;
  const capacityLabel = capacity === null ? "Unlimited" : capacity.toString();

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
            max={500}
            value={customCapacity}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= 2 && value <= 500) {
                onCustomCapacityChange(value);
              }
            }}
            className={`w-24 rounded-lg border ${borderClass} ${surfaceClass} px-2 py-1 text-right text-xs text-slate-800 outline-none focus:ring-2 focus:ring-slate-200`}
          />
        </label>
      )}
    </section>
  );
}
