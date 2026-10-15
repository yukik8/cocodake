// Place photos are served through /api/photo so the Google API key never reaches clients
// or the database. Rows saved before the proxy hold Google URLs with the key embedded;
// they are rewritten on read.
//
// Google photo references expire (Google issues new ones for the same place), so a saved
// place with a Google place ID is shown as /api/photo?place_id=…, which looks up the
// current photo when it is requested. The stored photo_url then only records that the
// place has a photo. A reference (/api/photo?ref=…) is used only for a fresh preview and
// for the few places without a place ID.
import { isGooglePlaceId } from "./ids";

const REF_PREFIX = "/api/photo?ref=";
const PLACE_PREFIX = "/api/photo?place_id=";
const REF_PATTERN = /^[A-Za-z0-9_-]{10,1024}$/;

export function isValidPhotoRef(ref: string | null | undefined): ref is string {
  return typeof ref === "string" && REF_PATTERN.test(ref);
}

export function photoProxyUrl(ref: string): string {
  return `${REF_PREFIX}${ref}`;
}

// Accepts a stored or client-sent photo_url and returns a proxy path, or null.
export function toPublicPhotoUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith(REF_PREFIX)) {
    return isValidPhotoRef(value.slice(REF_PREFIX.length)) ? value : null;
  }
  if (value.startsWith(PLACE_PREFIX)) {
    return isGooglePlaceId(value.slice(PLACE_PREFIX.length)) ? value : null;
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

// The photo URL to show for a saved place
export function photoUrlForPlace(stored: string | null | undefined, placeId: string | null | undefined): string | null {
  if (!stored) return null;
  if (isGooglePlaceId(placeId)) return `${PLACE_PREFIX}${placeId}`;
  return toPublicPhotoUrl(stored);
}
