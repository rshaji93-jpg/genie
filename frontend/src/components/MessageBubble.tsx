import { ReactNode } from "react";

interface MessageBubbleProps {
  children: ReactNode;
  className?: string;
  provider?: string;
  model?: string;
  autoFallback?: boolean;
}

const PROVIDER_STYLES: Record<string, string> = {
  "google gemini": "bg-blue-950/60 text-blue-300 border-blue-500/40",
  "groq cloud": "bg-orange-950/60 text-orange-300 border-orange-500/40",
  "mistral ai": "bg-amber-950/60 text-amber-300 border-amber-500/40",
  "github models": "bg-purple-950/60 text-purple-300 border-purple-500/40",
  openrouter: "bg-emerald-950/60 text-emerald-300 border-emerald-500/40",
};

export default function MessageBubble({
  children,
  className = "",
  provider = "Personal AI Genie",
  model = "platform engine",
  autoFallback = false,
}: MessageBubbleProps) {
  const style =
    PROVIDER_STYLES[provider.toLowerCase()] ||
    "border-slate-500/40 bg-slate-900/70 text-slate-300";

  return (
    <div className="flex w-full max-w-[min(100%,42rem)] flex-col items-start gap-1.5">
      <div className={`inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] leading-tight sm:text-[11px] ${style}`}>
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current" aria-hidden="true" />
        <span className="min-w-0 break-words font-semibold">{provider}</span>
        <span aria-hidden="true" className="opacity-60">·</span>
        <span className="min-w-0 break-all">{model}</span>
        {autoFallback && (
          <span className="ml-0.5 whitespace-nowrap rounded-full bg-black/20 px-1.5 py-0.5 font-semibold">
            ⚡ auto-fallback
          </span>
        )}
      </div>
      <div className={className}>{children}</div>
    </div>
  );
}
