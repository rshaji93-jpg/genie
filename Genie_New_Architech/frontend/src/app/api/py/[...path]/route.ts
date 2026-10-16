const BACKEND_ORIGIN = (process.env.GENIE_BACKEND_ORIGIN || "http://127.0.0.1:8000").replace(/\/+$/, "");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fallbackResponse(path: string, method: string, roomName?: string): Response {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Genie-Local-Fallback": "true",
  };
  const route = path.replace(/^\/api\/?/, "");
  if (route === "profile") {
    return Response.json({
      email: "", user_name: "", display_name: "", registration_complete: false,
      phone: null, bio: "", city_region: null, picture_url: null, custom_picture_data: null,
      profile_visibility: "mutuals", presence_visibility: "mutuals", directory_visibility: "mutuals",
      preview_profile: false, geo_region_hash: null, friend_circle_mode: "mutuals_only",
      lookup_visibility: "mutual_contacts_only", allow_broader_discovery: false,
      default_dialect: "en-IN", presence_override: "online", telemetry_enabled: false, is_vip: false,
      local_fallback: true,
    }, { status: 200, headers });
  }
  if ((["rooms", "social/friends", "social/requests"].includes(route) || route.startsWith("rooms/")) && method === "GET") {
    return Response.json([], { status: 200, headers });
  }
  if (route.startsWith("social/metasync") || route.startsWith("social/directory")) {
    return Response.json([], { status: 200, headers });
  }
  if (route === "rooms" && method === "POST") {
    return Response.json({ id: crypto.randomUUID(), name: roomName || "Private room", member_count: 1, local_fallback: true }, { status: 200, headers });
  }
  if (route === "ai/status") {
    return Response.json({
      genie_pro_configured: false, genie_pro_available: false, genie_pro_retry_seconds: 0,
      genie_master_configured: false, genie_master_available: false, genie_master_retry_seconds: 0,
      local_fallback: true,
    }, { status: 200, headers });
  }
  if (route.startsWith("auth/passkeys/")) {
    return Response.json({
      local_fallback: true,
      unavailable: true,
      detail: "Passkey authentication requires a server-verified WebAuthn challenge.",
    }, { status: 200, headers });
  }
  if (route === "chat" || route === "chat/stream") {
    if (route.endsWith("/stream")) {
      return new Response(
        `event: error\ndata: ${JSON.stringify({ detail: "AI service is unavailable while offline." })}\n\n`,
        { status: 200, headers: { ...headers, "Content-Type": "text/event-stream" } },
      );
    }
    return Response.json({ reply: "", local_fallback: true, unavailable: true }, { status: 200, headers });
  }
  if (route === "auth/register" || route === "profile/details" || route === "profile/preferences") {
    return Response.json({ saved_locally: true, local_fallback: true }, { status: 200, headers });
  }
  if (route.startsWith("rooms/") || route === "rooms" || route.startsWith("social/")) {
    return Response.json({ local_fallback: true, unavailable: true }, { status: 200, headers });
  }
  return Response.json({ local_fallback: true, unavailable: true }, { status: 200, headers });
}

async function handle(request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  const backendPath = incoming.pathname.replace(/^\/api\/py(?=\/|$)/, "/api");
  const upstreamUrl = `${BACKEND_ORIGIN}${backendPath}${incoming.search}`;
  let roomName: string | undefined;
  if (backendPath === "/api/rooms" && request.method === "POST") {
    try {
      const payload = await request.clone().json() as { name?: unknown };
      if (typeof payload.name === "string" && payload.name.trim()) roomName = payload.name.trim();
    } catch {
      roomName = undefined;
    }
  }
  const headers = new Headers();
  for (const name of ["authorization", "content-type", "accept"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const response = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (response.status !== 404 && response.status < 500) return response;
  } catch (error) {
    if (!(error instanceof TypeError) && !(error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name))) {
      throw error;
    }
  }
  return fallbackResponse(backendPath, request.method, roomName);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
