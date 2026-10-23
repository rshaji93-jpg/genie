const CLOUD_API_URL = (
  process.env.NEXT_PUBLIC_API_URL
  || "https://genie-backend-481849166496.asia-south1.run.app"
).replace(/\/$/, "");
const API_URL_OVERRIDE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
const LEGACY_API_URL = (process.env.NEXT_PUBLIC_GENIE_API_URL || "").replace(/\/$/, "");
let localBackendUnavailable = false;

function isLocalApiUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function proxyPath(path: string): string {
  if (path.startsWith("/api/py/")) return path;
  return path.startsWith("/api/") ? `/api/py/${path.slice(5)}` : path;
}

export function apiUrl(path: string): string {
  const requestPath = proxyPath(path);
  if (typeof window === "undefined") return requestPath;
  const isLocalhost = window.location.hostname === "localhost";
  if (!isLocalhost) return `${CLOUD_API_URL}${requestPath}`;
  if (API_URL_OVERRIDE && !(localBackendUnavailable && isLocalApiUrl(API_URL_OVERRIDE))) {
    return `${API_URL_OVERRIDE}${requestPath}`;
  }
  if (LEGACY_API_URL && !(localBackendUnavailable && isLocalApiUrl(LEGACY_API_URL))) {
    return `${LEGACY_API_URL}${requestPath}`;
  }
  if (localBackendUnavailable) return `${CLOUD_API_URL}${requestPath}`;
  return `http://localhost:8000${requestPath}`;
}

export async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(apiUrl(path), init);
  } catch (error) {
    if (
      !(error instanceof TypeError)
      || typeof window === "undefined"
      || window.location.hostname !== "localhost"
      || (API_URL_OVERRIDE && !isLocalApiUrl(API_URL_OVERRIDE))
      || (LEGACY_API_URL && !isLocalApiUrl(LEGACY_API_URL))
      || localBackendUnavailable
    ) {
      throw error;
    }
    localBackendUnavailable = true;
    return fetch(`${CLOUD_API_URL}${proxyPath(path)}`, init);
  }
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
    throw new Error(message);
  }
  return (await response.json()) as T;
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
  const baseUrl = window.location.hostname !== "localhost"
    ? CLOUD_API_URL
    : localBackendUnavailable && (isLocalApiUrl(API_URL_OVERRIDE) || isLocalApiUrl(LEGACY_API_URL))
      ? CLOUD_API_URL
      : API_URL_OVERRIDE || LEGACY_API_URL || "http://localhost:8000";
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = path;
  return url.toString();
}

export function randomToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
