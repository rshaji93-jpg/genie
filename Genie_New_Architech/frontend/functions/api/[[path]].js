const DEFAULT_BACKEND_ORIGIN = "https://personalaigenie-767453349146.asia-south1.run.app";

export async function onRequest({ request, env }) {
  const incomingUrl = new URL(request.url);
  const backendUrl = new URL(env.BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN);
  backendUrl.pathname = `${backendUrl.pathname.replace(/\/$/, "")}${incomingUrl.pathname}`;
  backendUrl.search = incomingUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  const proxyRequest = new Request(backendUrl, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });

  return fetch(proxyRequest);
}
