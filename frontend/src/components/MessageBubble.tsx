import { ReactNode } from "react";

interface MessageBubbleProps {
  children: ReactNode;
  className?: string;
}

export default function MessageBubble({ children, className = "" }: MessageBubbleProps) {
  return (
    <div className="flex w-full max-w-[min(100%,42rem)] flex-col items-start gap-1.5">
      <div className={className}>{children}</div>
    </div>
  );
}
