export const API_URL = (process.env.NEXT_PUBLIC_GENIE_API_URL || "").replace(/\/$/, "");

function proxyPath(path: string): string {
  if (path.startsWith("/api/py/")) return path;
  return path.startsWith("/api/") ? `/api/py/${path.slice(5)}` : path;
}

export async function apiFetch<T>(
  path: string,
  credential = "",
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(proxyPath(path), {
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
      const payload = (await response.json()) as { detail?: string };
      message = payload.detail || message;
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
  const url = new URL(API_URL || window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = path;
  return url.toString();
}

export function randomToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
