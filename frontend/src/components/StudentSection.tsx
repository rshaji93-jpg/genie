"use client";

import React, { useState, useEffect } from "react";

export interface StudyQuote {
  id: string;
  quote: string;
  author: string;
  category: "study" | "coding" | "grit" | "team";
}

export const STUDENT_STUDY_QUOTES: StudyQuote[] = [
  { id: "q1", quote: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier", category: "study" },
  { id: "q2", quote: "First, solve the problem. Then, write the code.", author: "John Johnson", category: "coding" },
  { id: "q3", quote: "Live as if you were to die tomorrow. Learn as if you were to live forever.", author: "Mahatma Gandhi", category: "study" },
  { id: "q4", quote: "If you get tired, learn to rest, not to quit.", author: "Banksy", category: "grit" },
  { id: "q5", quote: "Education is the most powerful weapon which you can use to change the world.", author: "Nelson Mandela", category: "study" },
  { id: "q6", quote: "A person who never made a mistake never tried anything new.", author: "Albert Einstein", category: "coding" },
  { id: "q7", quote: "Alone we can do so little; together we can do so much.", author: "Helen Keller", category: "team" },
  { id: "q8", quote: "Procrastination is the thief of time.", author: "Edward Young", category: "grit" },
];

export interface StudyRoomPreset {
  id: string;
  title: string;
  description: string;
  suggestedPrompt: string;
  badge: string;
  iconColor: string;
}

export const STUDY_ROOM_PRESETS: StudyRoomPreset[] = [
  {
    id: "exam-prep",
    title: "Exam & Revision Lounge",
    description: "Generate flashcards, test key concepts, and summarize lecture handouts.",
    suggestedPrompt: "Act as my study buddy. Quiz me on the core concepts of this subject one question at a time.",
    badge: "Exams",
    iconColor: "text-amber-600 bg-amber-50 border-amber-200",
  },
  {
    id: "code-lab",
    title: "Coding & Algorithm Lab",
    description: "Debug code snippets, analyze time complexity, and build data structures.",
    suggestedPrompt: "Review this algorithm, identify any edge-case bugs, and explain its Big-O time and space complexity.",
    badge: "Computer Science",
    iconColor: "text-sky-600 bg-sky-50 border-sky-200",
  },
  {
    id: "paper-review",
    title: "Research & Essay Review",
    description: "Refine thesis statements, review citations, and improve academic prose.",
    suggestedPrompt: "Critique this essay draft for logical flow, clarity, and strong academic argumentation.",
    badge: "Writing",
    iconColor: "text-purple-600 bg-purple-50 border-purple-200",
  },
  {
    id: "hackathon-sync",
    title: "Hackathon Team Hub",
    description: "Brainstorm project architectures, API specifications, and task assignments.",
    suggestedPrompt: "Help our team structure a clean Next.js and Python FastAPI project architecture.",
    badge: "Group Project",
    iconColor: "text-emerald-600 bg-emerald-50 border-emerald-200",
  },
];

export function StudentQuotesTicker({ onSelectQuote }: { onSelectQuote?: (quote: StudyQuote) => void }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % STUDENT_STUDY_QUOTES.length);
    }, 9000);
    return () => clearInterval(timer);
  }, []);

  const active = STUDENT_STUDY_QUOTES[currentIndex];

  return (
    <div className="w-full max-w-xl mx-auto my-2 px-3 py-1.5 bg-gradient-to-r from-violet-50/90 via-purple-50/70 to-pink-50/80 border border-purple-100 rounded-2xl shadow-xs flex items-center justify-between text-xs text-slate-700 select-none">
      <div className="flex items-center gap-2 min-w-0 pr-2">
        <span className="p-0.5 px-1.5 bg-white text-purple-600 rounded-lg border border-purple-200 shadow-xs shrink-0 font-bold text-[9px]">
          QUOTE
        </span>
        <p className="truncate italic text-[11px] text-slate-700">
          "{active.quote}" <span className="font-semibold text-purple-800 not-italic ml-1">— {active.author}</span>
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" onClick={() => setCurrentIndex((prev) => (prev - 1 + STUDENT_STUDY_QUOTES.length) % STUDENT_STUDY_QUOTES.length)} className="p-1 text-slate-400 hover:text-purple-700 text-[10px] font-bold">❮</button>
        <button type="button" onClick={() => setCurrentIndex((prev) => (prev + 1) % STUDENT_STUDY_QUOTES.length)} className="p-1 text-slate-400 hover:text-purple-700 text-[10px] font-bold">❯</button>
        {onSelectQuote && (
          <button type="button" onClick={() => onSelectQuote(active)} className="ml-1 text-[10px] font-bold text-purple-700 bg-white px-2 py-0.5 rounded-md border border-purple-200">Use</button>
        )}
      </div>
    </div>
  );
}

export function StudyRoomPresetGrid({ onSelectPreset }: { onSelectPreset: (preset: StudyRoomPreset) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl mx-auto my-2 text-left">
      {STUDY_ROOM_PRESETS.map((preset) => (
        <div key={preset.id} onClick={() => onSelectPreset(preset)} className="p-2.5 bg-white hover:bg-slate-50 border border-slate-200 hover:border-purple-300 rounded-xl shadow-xs transition-all cursor-pointer flex flex-col justify-between group">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-xs text-slate-800 group-hover:text-purple-700 transition-colors truncate">{preset.title}</span>
              <span className={`text-[8px] font-bold px-1.5 py-0.2 rounded-full border ${preset.iconColor}`}>{preset.badge}</span>
            </div>
            <p className="text-[10px] text-slate-500 line-clamp-2 leading-tight">{preset.description}</p>
          </div>
          <span className="mt-1.5 text-[10px] font-semibold text-purple-600 group-hover:underline">Load Template ➔</span>
        </div>
      ))}
    </div>
  );
}
