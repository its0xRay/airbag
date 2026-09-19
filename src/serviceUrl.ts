const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i;

/**
 * Vite bakes this URL into the frontend. Hosting dashboards make it easy to
 * paste a bare Railway hostname, so normalize that safely instead of turning it
 * into a relative request against the Vercel origin.
 */
export function normalizeServiceUrl(rawValue?: string): string {
  const raw = (rawValue || "http://127.0.0.1:8787").trim();
  const withScheme = /^https?:\/\//i.test(raw)
    ? raw
    : `${LOCAL_HOST.test(raw) ? "http" : "https"}://${raw}`;
  const url = new URL(withScheme);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("VITE_QUOTE_SVC must be an HTTP(S) URL");
  }
  return url.toString().replace(/\/$/, "");
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Service returned ${contentType || "a non-JSON response"} (${response.status})`);
  }
  const body = await response.json() as T & { error?: string };
  if (!response.ok || body?.error) {
    throw new Error(body?.error || `Service request failed (${response.status})`);
  }
  return body;
}
