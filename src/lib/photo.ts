// Place photos are served through /api/photo so the Google API key never reaches clients
// or the database. Rows saved before this change hold Google URLs with the key embedded;
// toPublicPhotoUrl rewrites them on read.

const PROXY_PREFIX = "/api/photo?ref=";
const REF_PATTERN = /^[A-Za-z0-9_-]{10,1024}$/;

export function isValidPhotoRef(ref: string | null | undefined): ref is string {
  return typeof ref === "string" && REF_PATTERN.test(ref);
}

export function photoProxyUrl(ref: string): string {
  return `${PROXY_PREFIX}${ref}`;
}

// Accepts a stored or client-sent photo_url and returns the proxy form, or null.
export function toPublicPhotoUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith(PROXY_PREFIX)) {
    const ref = value.slice(PROXY_PREFIX.length);
    return isValidPhotoRef(ref) ? value : null;
  }
  try {
    const u = new URL(value);
    if (u.hostname === "maps.googleapis.com" && u.pathname === "/maps/api/place/photo") {
      const ref = u.searchParams.get("photo_reference");
      return isValidPhotoRef(ref) ? photoProxyUrl(ref) : null;
    }
  } catch {
    // not a URL
  }
  return null;
}
