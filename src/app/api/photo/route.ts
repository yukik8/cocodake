import { NextRequest, NextResponse } from "next/server";
import { isValidPhotoRef } from "@/lib/photo";
import { isGooglePlaceId } from "@/lib/ids";
import { createServerClient } from "@/lib/supabase";
import { NO_PHOTO_RECHECK_MS, fetchCurrentRef, isSavedPlace, readCachedRef, saveRefs } from "@/lib/photoCache";

// Public on purpose: share pages show photos to people who aren't signed in.
// The key is added here, on the server; Google answers with a redirect to the image
// itself (a URL without the key), which browsers and the CDN then cache for a day. After
// that the CDN keeps answering from cache while it refreshes in the background, so only
// the very first view of a photo waits for Google.
//
//   ?place_id=…  a saved place: uses the stored photo reference (one Google call); when
//                there is none, or it has expired, fetches the current one and stores it
//   ?ref=…       a fresh reference (search / tap previews)

const CACHE_OK = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";
const CACHE_MISSING = "public, max-age=3600, s-maxage=3600"; // no photo, or an expired reference
const NO_STORE = "no-store"; // Google unavailable: try again next time

type PhotoResult = { kind: "ok"; location: string } | { kind: "expired" } | { kind: "error" };

function notFound(cache = CACHE_MISSING) {
  return new NextResponse(null, { status: 404, headers: { "Cache-Control": cache } });
}

function upstreamError() {
  return new NextResponse(null, { status: 502, headers: { "Cache-Control": NO_STORE } });
}

function toResponse(result: PhotoResult) {
  if (result.kind === "ok") {
    return NextResponse.redirect(result.location, { status: 302, headers: { "Cache-Control": CACHE_OK } });
  }
  return result.kind === "expired" ? notFound() : upstreamError();
}

async function googlePhoto(ref: string, key: string): Promise<PhotoResult> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/photo");
  url.searchParams.set("maxwidth", "400");
  url.searchParams.set("photo_reference", ref);
  url.searchParams.set("key", key);

  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location?.startsWith("https://")) {
      return { kind: "ok", location };
    }
    // 4xx: an expired or invalid reference
    return res.status >= 400 && res.status < 500 ? { kind: "expired" } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

async function photoForPlace(placeId: string, key: string) {
  const sb = createServerClient();
  const cached = await readCachedRef(sb, placeId);

  if (cached?.ref) {
    const result = await googlePhoto(cached.ref, key);
    if (result.kind !== "expired") return toResponse(result);
    // the stored reference expired: fall through and fetch the current one
  } else if (cached && Date.now() - cached.fetchedAt < NO_PHOTO_RECHECK_MS) {
    return notFound(); // checked recently: the place has no photo
  } else if (!cached && !(await isSavedPlace(sb, placeId))) {
    return notFound(); // nobody saved this place: don't spend Google calls on it
  }

  const ref = await fetchCurrentRef(placeId, key);
  if (ref === undefined) return upstreamError();
  await saveRefs(sb, [{ place_id: placeId, photo_ref: ref }]);
  if (!ref) return notFound();
  return toResponse(await googlePhoto(ref, key));
}

export async function GET(req: NextRequest) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return notFound(NO_STORE);

  const placeId = req.nextUrl.searchParams.get("place_id");
  if (placeId !== null) {
    if (!isGooglePlaceId(placeId)) return notFound();
    return photoForPlace(placeId, key);
  }

  const ref = req.nextUrl.searchParams.get("ref");
  if (!isValidPhotoRef(ref)) return notFound();
  return toResponse(await googlePhoto(ref, key));
}
