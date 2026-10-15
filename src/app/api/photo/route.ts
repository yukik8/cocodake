import { NextRequest, NextResponse } from "next/server";
import { isValidPhotoRef } from "@/lib/photo";

// Public on purpose: share pages show photos to people who aren't signed in.
// The key is added here, on the server; Google answers with a redirect to the image
// itself (a URL without the key), which browsers and the CDN then cache.
export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get("ref");
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!isValidPhotoRef(ref) || !key) {
    return new NextResponse(null, { status: 404 });
  }

  const url = new URL("https://maps.googleapis.com/maps/api/place/photo");
  url.searchParams.set("maxwidth", "400");
  url.searchParams.set("photo_reference", ref);
  url.searchParams.set("key", key);

  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location?.startsWith("https://")) {
      return NextResponse.redirect(location, {
        status: 302,
        headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" },
      });
    }
  } catch {
    // fall through
  }
  return new NextResponse(null, { status: 404, headers: { "Cache-Control": "public, max-age=3600" } });
}
