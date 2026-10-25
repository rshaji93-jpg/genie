"use client";

export interface ReactionUser {
  id: string;
  name: string;
}

export interface ReactionAggregate {
  emoji: string;
  count: number;
  users?: ReactionUser[];
  /** Set when the aggregate contains the current user's reaction. */
  currentUserReacted?: boolean;
}

export interface TeamsMessageReactionsProps {
  reactions: ReactionAggregate[];
  currentUserId?: string;
  onToggle: (emoji: string) => void;
  canToggle?: boolean;
  className?: string;
  ariaLabel?: string;
}

export default function TeamsMessageReactions({
  reactions,
  currentUserId,
  onToggle,
  canToggle = true,
  className = "",
  ariaLabel = "Message reactions",
}: TeamsMessageReactionsProps) {
  const byEmoji = new Map(reactions.map((reaction) => [reaction.emoji, reaction]));

  function renderReaction(emoji: string) {
    const reaction = byEmoji.get(emoji);
    const count = Math.max(0, reaction?.count ?? 0);
    const reactedByCurrentUser =
      reaction?.currentUserReacted ?? Boolean(currentUserId && reaction?.users?.some((user) => user.id === currentUserId));
    const names = reaction?.users?.map((user) => user.name).filter(Boolean) ?? [];
    const tooltip = names.length
      ? names.join(", ")
      : count
        ? `${count} ${count === 1 ? "person" : "people"} reacted`
        : `React with ${emoji}`;

    return canToggle ? (
      <button
        aria-label={`React with ${emoji}${count ? `, ${count} reactions` : ""}`}
        aria-pressed={reactedByCurrentUser}
        className={`inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full border px-2 text-sm transition-colors ${
          reactedByCurrentUser
            ? "border-blue-400 bg-blue-50 text-blue-800"
            : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
        }`}
        key={emoji}
        onClick={() => onToggle(emoji)}
        title={tooltip}
        type="button"
      >
        <span aria-hidden="true" className="text-base leading-none">{emoji}</span>
        {count > 0 && <span className="text-xs font-medium leading-none">{count}</span>}
      </button>
    ) : (
      <span
        aria-label={`${tooltip}: ${count} reactions`}
        className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 text-sm text-gray-700"
        key={emoji}
        title={tooltip}
      >
        <span aria-hidden="true" className="text-base leading-none">{emoji}</span>
        <span className="text-xs font-medium leading-none">{count}</span>
      </span>
    );
  }

  return (
    <div aria-label={ariaLabel} className={`message-reactions ${className}`.trim()} role="group">
      <div className="message-reaction-pills">{reactions.filter((reaction) => reaction.count > 0).map((reaction) => renderReaction(reaction.emoji))}</div>
    </div>
  );
}
