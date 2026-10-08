"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp, GraduationCap } from "lucide-react";
import {
  StudentQuotesTicker,
  StudyRoomPresetGrid,
  StudyRoomPreset,
  StudyQuote,
} from "./StudentSection";

export default function StudentBanner({
  onSelectPrompt,
  compact = false,
}: {
  onSelectPrompt: (promptText: string) => void;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`w-full mx-auto mb-1.5 transition-all ${compact ? "" : "max-w-2xl px-2"}`}>
      {/* One-Touch Compact Toggle Bar */}
      <div className="flex items-center justify-between bg-white/90 border border-purple-100 rounded-full px-3 py-1 shadow-xs backdrop-blur-xs">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 text-left text-[11px] font-bold text-purple-700 hover:text-purple-900 transition-colors"
        >
          <GraduationCap className="w-3.5 h-3.5 text-purple-600" />
          <span>{compact ? "Study Engine" : "Study Lounge & Presets"}</span>
          {isOpen ? (
            <ChevronUp className="w-3 h-3 text-purple-500" />
          ) : (
            <ChevronDown className="w-3 h-3 text-purple-500" />
          )}
        </button>

        <span className="text-[10px] text-slate-400 font-medium">
          {isOpen ? "Tap to hide" : "Tap to show presets"}
        </span>
      </div>

      {/* Expandable Section */}
      {isOpen && (
        <div className="mt-2 space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <StudentQuotesTicker
            onSelectQuote={(q: StudyQuote) =>
              onSelectPrompt(`Let's reflect on this quote: "${q.quote}"`)
            }
          />
          <StudyRoomPresetGrid
            onSelectPreset={(p: StudyRoomPreset) => onSelectPrompt(p.suggestedPrompt)}
          />
        </div>
      )}
    </div>
  );
}
