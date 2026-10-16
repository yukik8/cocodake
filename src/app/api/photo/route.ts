import { NextRequest, NextResponse } from "next/server";
import { isValidPhotoRef } from "@/lib/photo";
import { isGooglePlaceId } from "@/lib/ids";

// Public on purpose: share pages show photos to people who aren't signed in.
// The key is added here, on the server; Google answers with a redirect to the image
// itself (a URL without the key), which browsers and the CDN then cache for a day. After
// that the CDN keeps answering from cache while it refreshes in the background, so only
// the very first view of a photo waits for Google.
//
//   ?place_id=…  a saved place: looks up the place's current photo first, because stored
//                photo references expire
//   ?ref=…       a fresh reference (search / tap previews)

const CACHE_OK = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";
const CACHE_MISSING = "public, max-age=3600, s-maxage=3600"; // no photo, or an expired reference
const NO_STORE = "no-store"; // Google unavailable: try again next time

function notFound(cache = CACHE_MISSING) {
  return new NextResponse(null, { status: 404, headers: { "Cache-Control": cache } });
}

function upstreamError() {
  return new NextResponse(null, { status: 502, headers: { "Cache-Control": NO_STORE } });
}

// undefined = Google could not answer; null = the place has no photo (or no longer exists)
async function currentPhotoRef(placeId: string, key: string): Promise<string | null | undefined> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "photos");
  url.searchParams.set("key", key);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return undefined;
    const data = await res.json();
    if (data.status === "OK") {
      const ref = data.result?.photos?.[0]?.photo_reference;
      return isValidPhotoRef(ref) ? ref : null;
    }
    return data.status === "NOT_FOUND" || data.status === "ZERO_RESULTS" || data.status === "INVALID_REQUEST"
      ? null
      : undefined;
  } catch {
    return undefined;
  }
}

async function redirectToPhoto(ref: string, key: string) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/photo");
  url.searchParams.set("maxwidth", "400");
  url.searchParams.set("photo_reference", ref);
  url.searchParams.set("key", key);

  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location?.startsWith("https://")) {
      return NextResponse.redirect(location, { status: 302, headers: { "Cache-Control": CACHE_OK } });
    }
    // 4xx: an expired or invalid reference
    return res.status >= 400 && res.status < 500 ? notFound() : upstreamError();
  } catch {
    return upstreamError();
  }
}

export async function GET(req: NextRequest) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return notFound(NO_STORE);

  const placeId = req.nextUrl.searchParams.get("place_id");
  if (placeId !== null) {
    if (!isGooglePlaceId(placeId)) return notFound();
    const ref = await currentPhotoRef(placeId, key);
    if (ref === undefined) return upstreamError();
    if (ref === null) return notFound();
    return redirectToPhoto(ref, key);
  }

  const ref = req.nextUrl.searchParams.get("ref");
  if (!isValidPhotoRef(ref)) return notFound();
  return redirectToPhoto(ref, key);
}
