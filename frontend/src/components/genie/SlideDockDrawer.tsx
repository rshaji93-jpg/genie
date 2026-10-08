"use client";

import { type ReactNode, useState } from "react";
import { ChevronDown, ChevronUp, Crown, Sparkles } from "lucide-react";

interface SlideDockDrawerProps {
  children: ReactNode;
  statusLabel: string;
  statusTone: "vip" | "byok" | "quota";
  surfaceClass: string;
  borderClass: string;
  textClass: string;
  mutedTextClass: string;
  accentClass: string;
}

export default function SlideDockDrawer({
  children,
  statusLabel,
  statusTone,
  surfaceClass,
  borderClass,
  textClass,
  mutedTextClass,
  accentClass,
}: SlideDockDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const statusClasses = {
    vip: "border-amber-200 bg-amber-50 text-amber-800",
    byok: "border-emerald-200 bg-emerald-50 text-emerald-800",
    quota: "border-sky-200 bg-sky-50 text-sky-800",
  }[statusTone];

  return (
    <section className={`w-full overflow-hidden rounded-xl border ${borderClass} ${surfaceClass} ${textClass} shadow-sm`}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left transition-colors hover:brightness-95"
      >
        <span className="flex min-w-0 flex-col items-start gap-1">
          <span className={`inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusClasses}`}>
            <Crown className="h-3 w-3 shrink-0" />
            <span className="truncate">{statusLabel}</span>
          </span>
          <span className={`flex items-center gap-1 text-[10px] font-bold ${accentClass}`}>
            <Sparkles className="h-3 w-3" />
            Tools
            <span className={`font-medium ${mutedTextClass}`}>VIP · Flashcards · Study · Share</span>
          </span>
        </span>
        <span className={`flex shrink-0 items-center gap-1 text-[10px] font-bold ${accentClass}`}>
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ${
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={`max-h-[35vh] overflow-y-auto border-t ${borderClass} px-1 py-2`}>
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
