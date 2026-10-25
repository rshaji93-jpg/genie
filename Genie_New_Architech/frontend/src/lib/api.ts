const CLOUD_API_URL = (
  process.env.NEXT_PUBLIC_API_URL
  || "https://genie-backend-481849166496.asia-south1.run.app"
).replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export interface MasterQuota {
  used: number;
  limit: number;
  remaining: number;
  reset_in_seconds: number;
  vip_active: boolean;
  downgraded_to?: "genie-pro";
  can_request_vip?: boolean;
  unlimited?: boolean;
}

export interface VipRequest {
  id: string;
  user_email: string;
  user_name: string;
  reason: string;
  created_at: string;
}

export interface VipAllocation {
  id: string;
  status: "active" | "claimed";
  user_email: string | null;
  user_name: string | null;
  created_at: string;
  claimed_at: string | null;
}

export interface VipQueue {
  active_count: number;
  limit: number;
  active: VipAllocation[];
  pending: VipRequest[];
}

export interface SocialProfile {
  user_id: string;
  email: string;
  username: string | null;
  display_name: string;
  avatar_data_url: string | null;
  bio: string;
  skills_offered: string[];
  discoverable: boolean;
  profile_completed: boolean;
}

export interface SocialProfileUpdate {
  display_name: string;
  username: string;
  avatar_data_url: string | null;
  bio: string;
  skills_offered: string[];
  discoverable: boolean;
}

export async function compressProfileAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/") || file.size > 10_000_000) {
    throw new Error("Choose an image smaller than 10 MB.");
  }
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The selected image could not be read."));
      image.src = objectUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 160;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable in this browser.");
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - side) / 2;
    const sourceY = (image.naturalHeight - side) / 2;
    context.drawImage(image, sourceX, sourceY, side, side, 0, 0, 160, 160);
    let quality = 0.82;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > 11_000 && quality > 0.35) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function saveSocialProfile(
  profile: SocialProfileUpdate,
  credential: string,
): Promise<SocialProfile> {
  return apiFetch<SocialProfile>("/api/profile", credential, {
    method: "POST",
    body: JSON.stringify(profile),
  });
}

function getUserProfileHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};

  let userId = "";
  let userEmail = "";
  try {
    const credential = sessionStorage.getItem("genie_user_session")
      || sessionStorage.getItem("genie_google_credential")
      || "";
    const payload = credential.split(".")[1];
    if (payload) {
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const claims = JSON.parse(
        atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4)),
      ) as { sub?: unknown; email?: unknown };
      if (typeof claims.sub === "string") userId = claims.sub;
      if (typeof claims.email === "string") userEmail = claims.email;
    }

    if (userId) {
      const profile = localStorage.getItem(`genie_local_profile_${encodeURIComponent(userId)}`);
      if (profile) {
        const parsed = JSON.parse(profile) as { email?: unknown };
        if (typeof parsed.email === "string") userEmail = parsed.email;
      }
    }
    userEmail = userEmail || localStorage.getItem("genie_returning_email") || "";
  } catch {
    userId = "";
  }

  return {
    "X-User-Email": userEmail || "rshaji93@gmail.com",
    ...(userId ? { "X-User-Id": userId } : {}),
  };
}

function proxyPath(path: string): string {
  if (path.startsWith("/api/py/")) return path;
  return path.startsWith("/api/") ? `/api/py/${path.slice(5)}` : path;
}

export function apiUrl(path: string): string {
  const requestPath = proxyPath(path);
  return `${CLOUD_API_URL}${requestPath}`;
}

export async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  Object.entries(getUserProfileHeaders()).forEach(([name, value]) => headers.set(name, value));
  const requestInit = { ...init, headers };
  return fetch(apiUrl(path), requestInit);
}

export async function apiFetch<T>(
  path: string,
  credential = "",
  init: RequestInit = {},
): Promise<T> {
  const response = await apiRequest(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (typeof payload.detail === "string") {
        message = payload.detail;
      } else if (
        payload.detail
        && typeof payload.detail === "object"
        && "message" in payload.detail
        && typeof payload.detail.message === "string"
      ) {
        message = payload.detail.message;
      }
    } catch {
      // Keep the HTTP status message when the response is not JSON.
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

export async function apiFetchAdminTelemetry<T>(
  credential: string,
  adminSession: string,
): Promise<T> {
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-User-Email": "rshaji93@gmail.com",
    "X-Admin-Passkey": "verified",
    "X-Genie-Admin-Session": adminSession,
  });
  Object.entries(getUserProfileHeaders()).forEach(([name, value]) => headers.set(name, value));
  headers.set("X-User-Email", "rshaji93@gmail.com");
  if (credential) headers.set("Authorization", `Bearer ${credential}`);

  const paths = ["/api/admin/telemetry", "/api/py/admin/telemetry"];
  let response: Response | undefined;
  for (const path of paths) {
    response = await fetch(`${CLOUD_API_URL}${path}`, {
      headers,
      cache: "no-store",
    });
    if (response.status !== 404) break;
  }
  if (!response) throw new Error("Admin telemetry endpoint could not be reached.");
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (typeof payload.detail === "string") message = payload.detail;
    } catch {
      // Keep the HTTP status message when the response is not JSON.
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

export function getVipQueue(credential: string, adminSession: string): Promise<VipQueue> {
  return apiFetch<VipQueue>("/api/admin/vip", credential, {
    headers: {
      "X-Admin-Passkey": "verified",
      "X-Genie-Admin-Session": adminSession,
    },
  });
}

export function approveVipPass(
  credential: string,
  adminSession: string,
  request: { request_id?: string; identifier?: string },
): Promise<{ pass_id: string; user_email: string; status: string }> {
  return apiFetch("/api/admin/vip/approve", credential, {
    method: "POST",
    headers: {
      "X-Admin-Passkey": "verified",
      "X-Genie-Admin-Session": adminSession,
    },
    body: JSON.stringify(request),
  });
}

export function revokeVipPass(
  credential: string,
  adminSession: string,
  passId: string,
): Promise<{ revoked: boolean }> {
  return apiFetch("/api/admin/vip/revoke", credential, {
    method: "POST",
    headers: {
      "X-Admin-Passkey": "verified",
      "X-Genie-Admin-Session": adminSession,
    },
    body: JSON.stringify({ pass_id: passId }),
  });
}

export function requestVipPass(
  credential: string,
  userName: string,
  reason: string,
): Promise<{ request_id: string; status: string }> {
  const userEmail = getUserProfileHeaders()["X-User-Email"] || "rshaji93@gmail.com";
  return apiFetch("/api/admin/vip/request", credential, {
    method: "POST",
    body: JSON.stringify({ user_email: userEmail, user_name: userName, reason }),
  });
}

export async function apiFetchWithFallback<T>(
  path: string,
  credential: string,
  init: RequestInit,
  createFallback: (error: unknown) => T,
  onFallback?: (error: unknown) => void,
): Promise<T> {
  try {
    return await apiFetch<T>(path, credential, init);
  } catch (error) {
    onFallback?.(error);
    return createFallback(error);
  }
}

export type LibrarySection =
  | "living-graph"
  | "ai-timeline"
  | "genie-daily"
  | "skill-dna"
  | "trust-impact";

export interface LibraryRecord {
  id: string;
  title?: string;
  content?: string;
  summary?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
}

export interface LibrarySectionResponse {
  items: LibraryRecord[];
  next_cursor?: string | null;
}

export interface ProposedMemory {
  id: string;
  content?: string;
  status?: "pending" | "approved" | "rejected";
}

export interface VoiceTtsResponse {
  audio_base64?: string;
  mime_type?: string;
}

export function getLibrarySection(
  section: LibrarySection,
  credential: string,
): Promise<LibrarySectionResponse> {
  return apiFetch<LibrarySectionResponse>(`/api/library/${section}`, credential);
}

export function saveLibraryItem(
  content: string,
  credential: string,
  metadata: Record<string, unknown> = {},
): Promise<LibraryRecord> {
  return apiFetch<LibraryRecord>("/api/library/items", credential, {
    method: "POST",
    body: JSON.stringify({ content, metadata }),
  });
}

export function removeLibraryItem(id: string, credential: string): Promise<{ deleted?: boolean }> {
  return apiFetch<{ deleted?: boolean }>(`/api/library/items/${encodeURIComponent(id)}`, credential, {
    method: "DELETE",
  });
}

export function approveProposedMemory(
  proposalId: string,
  credential: string,
): Promise<{ approved: boolean; id: string }> {
  return apiFetch<{ approved: boolean; id: string }>(
    `/api/memory/proposals/${encodeURIComponent(proposalId)}/approve`,
    credential,
    { method: "POST", body: "{}" },
  );
}

export function createFutureSelfEntry(
  content: string,
  credential: string,
  sourceMessageId: string,
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>("/api/future-self", credential, {
    method: "POST",
    body: JSON.stringify({ content, source_message_id: sourceMessageId }),
  });
}

export function requestVoiceTts(
  text: string,
  dialect: string,
  model: string,
  credential: string,
): Promise<VoiceTtsResponse> {
  return apiFetch<VoiceTtsResponse>("/api/voice/tts", credential, {
    method: "POST",
    body: JSON.stringify({ text: text.slice(0, 12_000), dialect, model }),
  });
}

export function websocketUrl(path: string): string {
  const url = new URL(CLOUD_API_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = path;
  return url.toString();
}

export function randomToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
