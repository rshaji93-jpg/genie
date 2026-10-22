export default function MultiUserTypingBar({ activities }: { activities: string[] }) {
  if (!activities.length) return null;
  return <div aria-live="polite" className="multi-user-typing">{activities.join(" · ")}</div>;
}
