import { NextRequest, NextResponse } from "next/server";
import { getVerifiedUserId, unauthorized } from "@/lib/auth";

// Google results carry place_id and no coordinates: the app fetches them once a result
// is chosen (GET /api/places/add?place_id=…). Before, every keystroke pause cost one
// Autocomplete call plus five Place Details calls.
// MapTiler / Nominatim results have coordinates and place_id = null.
export interface SearchResult {
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
}

// Google Places Autocomplete
async function searchWithGoogle(
  q: string,
  lat?: number,
  lng?: number
): Promise<SearchResult[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY!;

  const params = new URLSearchParams({
    input: q,
    language: "ja",
    key,
  });
  if (lat != null && lng != null) {
    params.set("location", `${lat},${lng}`);
    params.set("radius", "10000");
  }

  const acRes = await fetch(
    `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`,
    { signal: AbortSignal.timeout(5000) }
  );
  const acData = await acRes.json();
  if (!acData.predictions?.length) return [];

  return acData.predictions.slice(0, 5).map(
    (p: { place_id: string; description: string; structured_formatting?: { main_text?: string; secondary_text?: string } }) => ({
      id: p.place_id,
      name: p.structured_formatting?.main_text || p.description,
      address: p.structured_formatting?.secondary_text || p.description,
      lat: null,
      lng: null,
      place_id: p.place_id,
    })
  );
}

// MapTiler Geocoding（MapTilerキーがある場合）
async function searchWithMapTiler(
  q: string,
  lat?: number,
  lng?: number
): Promise<SearchResult[]> {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY!;
  const proximity = lat != null && lng != null ? `&proximity=${lng},${lat}` : "";
  const res = await fetch(
    `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${key}&language=ja&limit=5${proximity}`,
    { signal: AbortSignal.timeout(5000) }
  );
  const data = await res.json();
  return (data.features || []).map((f: {
    id: string;
    place_name: string;
    text: string;
    center: [number, number];
  }) => ({
    id: f.id,
    name: f.text,
    address: f.place_name,
    lat: f.center[1],
    lng: f.center[0],
    place_id: null,
  }));
}

// Nominatim（フォールバック・地名のみ）
async function searchWithNominatim(q: string): Promise<SearchResult[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&accept-language=ja&addressdetails=1`,
    { headers: { "User-Agent": "cocodake/1.0" }, signal: AbortSignal.timeout(5000) }
  );
  const data = await res.json();
  return data.map((r: { place_id: number; display_name: string; name: string; lat: string; lon: string }) => ({
    id: String(r.place_id),
    name: r.name || r.display_name.split(",")[0],
    address: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    place_id: null,
  }));
}

export async function GET(req: NextRequest) {
  // Search spends the Google API quota, so it is for signed-in users only
  const userId = await getVerifiedUserId();
  if (!userId) return unauthorized();

  const q = req.nextUrl.searchParams.get("q")?.slice(0, 200);
  const latParam = parseFloat(req.nextUrl.searchParams.get("lat") || "");
  const lngParam = parseFloat(req.nextUrl.searchParams.get("lng") || "");
  const lat = Number.isFinite(latParam) ? latParam : undefined;
  const lng = Number.isFinite(lngParam) ? lngParam : undefined;

  if (!q?.trim()) return NextResponse.json([]);

  try {
    if (process.env.GOOGLE_PLACES_API_KEY) {
      const results = await searchWithGoogle(q, lat, lng);
      if (results.length > 0) return NextResponse.json(results);
    }

    if (process.env.NEXT_PUBLIC_MAPTILER_KEY) {
      const results = await searchWithMapTiler(q, lat, lng);
      if (results.length > 0) return NextResponse.json(results);
    }

    const results = await searchWithNominatim(q);
    return NextResponse.json(results);
  } catch (err) {
    console.error("Search error:", err);
    return NextResponse.json([]);
  }
}
