const CLOUD_API_URL = (
  process.env.NEXT_PUBLIC_API_URL
  || "https://personalaigenie-767453349146.asia-south1.run.app"
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
