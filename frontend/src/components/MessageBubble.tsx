import { ReactNode } from "react";

export function sanitizeChatText(text: string): string {
  return text
    .replace(/```[\w+-]*\s*/g, "")
    .replace(/`/g, "")
    .replace(/#/g, "")
    .replace(/\*\*(.*?)\*\*|__(.*?)__/g, "$1$2")
    .replace(/(?<!\w)([*_])([^*_]+)\1(?!\w)/g, "$2")
    .replace(/(^|\n)\s*[-*+•]\s+/g, "$1")
    .replace(/(^|\n)\s*\d+[.)]\s+/g, "$1");
}

interface MessageBubbleProps {
  children: ReactNode;
  className?: string;
  imageData?: string;
  imageUrl?: string;
}

export default function MessageBubble({
  children,
  className = "",
  imageData,
  imageUrl,
}: MessageBubbleProps) {
  const imageSource = imageData || imageUrl || "";
  const safeImageSource =
    imageSource.startsWith("data:image/") ||
    /^https?:\/\//i.test(imageSource)
      ? imageSource
      : "";

  return (
    <div className="flex w-full max-w-[min(100%,42rem)] flex-col items-start gap-1.5">
      <div className={className}>
        {safeImageSource && (
          <img
            src={safeImageSource}
            alt="Attached image"
            className="mb-2 max-h-72 max-w-full rounded-xl border border-white/20 object-contain"
          />
        )}
        {children}
      </div>
    </div>
  );
}
