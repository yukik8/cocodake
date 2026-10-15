// Server-side fetches of user-supplied URLs. Each hop of a redirect chain is checked
// against an allow-list, so a pasted URL can't make the server request internal or
// arbitrary hosts (SSRF).

export type HostCheck = (url: URL) => boolean;

const MAX_HOPS = 5;

export async function fetchAllowed(
  rawUrl: string,
  isAllowed: HostCheck,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ response: Response; finalUrl: string } | null> {
  const { timeoutMs = 5000, ...rest } = init;
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    return null;
  }
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (current.protocol !== "https:" || !isAllowed(current)) return null;
    const response = await fetch(current, {
      ...rest,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (!location) return { response, finalUrl: current.toString() };
    current = new URL(location, current);
  }
  return null;
}

const GOOGLE_HOST = /(^|\.)google\.(com|co\.jp|jp)$/i;

export const isGoogleMapsHost: HostCheck = (u) =>
  u.hostname === "maps.app.goo.gl" ||
  (u.hostname === "goo.gl" && u.pathname.startsWith("/maps")) ||
  (u.hostname === "g.co" && u.pathname.startsWith("/kgs/")) ||
  GOOGLE_HOST.test(u.hostname);

export const isTabelogHost: HostCheck = (u) => u.hostname === "tabelog.com" || u.hostname.endsWith(".tabelog.com");

