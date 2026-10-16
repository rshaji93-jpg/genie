export interface PresenceMember {
  user_sub: string;
  user_name: string;
  presence?: "online" | "away" | "busy";
  voice?: boolean;
}

export default function PresenceBar({ members }: { members: PresenceMember[] }) {
  return (
    <div aria-label="Room participant presence" className="room-participant-bar">
      {members.map((member) => (
        <span className="room-participant" key={member.user_sub} title={`${member.user_name}: ${member.presence || "online"}`}>
          <b className="room-person-avatar">{member.user_name.slice(0, 1).toLocaleUpperCase()}</b>
          <i className={`presence-light ${member.presence === "busy" ? "red" : member.presence === "away" ? "yellow" : "green"}`} />
          {member.user_name}{member.voice && <span aria-label="Voice active"> · 🎙</span>}
        </span>
      ))}
    </div>
  );
}
