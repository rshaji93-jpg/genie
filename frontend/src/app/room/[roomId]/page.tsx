import WorkspaceContainer from "@/components/genie/WorkspaceContainer";

// Server-side static param generation for Cloudflare static export
export function generateStaticParams() {
  return [{ roomId: "default" }];
}

export default function SharedRoomPage() {
  return <WorkspaceContainer />;
}