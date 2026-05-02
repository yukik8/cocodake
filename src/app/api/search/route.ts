import { NextRequest, NextResponse } from "next/server";

export interface SearchResult {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

// Google Places Autocomplete → Place Details で座標取得
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
  if (lat && lng) {
    params.set("location", `${lat},${lng}`);
    params.set("radius", "10000");
  }

  const acRes = await fetch(
    `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`
  );
  const acData = await acRes.json();
  if (!acData.predictions?.length) return [];

  // 最大5件のPlace Detailsを並列取得
  const results = await Promise.all(
    acData.predictions.slice(0, 5).map(
      async (p: { place_id: string; description: string; structured_formatting: { main_text: string; secondary_text: string } }) => {
        const detailRes = await fetch(
          `https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=geometry,name,formatted_address&language=ja&key=${key}`
        );
        const detailData = await detailRes.json();
        const loc = detailData.result?.geometry?.location;
        if (!loc) return null;
        return {
          id: p.place_id,
          name: p.structured_formatting.main_text,
          address: p.structured_formatting.secondary_text || p.description,
          lat: loc.lat,
          lng: loc.lng,
        } as SearchResult;
      }
    )
  );

  return results.filter(Boolean) as SearchResult[];
}

// MapTiler Geocoding（MapTilerキーがある場合）
async function searchWithMapTiler(
  q: string,
  lat?: number,
  lng?: number
): Promise<SearchResult[]> {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY!;
  const proximity = lat && lng ? `&proximity=${lng},${lat}` : "";
  const res = await fetch(
    `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${key}&language=ja&limit=5${proximity}`
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
  }));
}

// Nominatim（フォールバック・地名のみ）
async function searchWithNominatim(q: string): Promise<SearchResult[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&accept-language=ja&addressdetails=1`,
    { headers: { "User-Agent": "MapShare/1.0" } }
  );
  const data = await res.json();
  return data.map((r: { place_id: number; display_name: string; name: string; lat: string; lon: string }) => ({
    id: String(r.place_id),
    name: r.name || r.display_name.split(",")[0],
    address: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  const lat = parseFloat(req.nextUrl.searchParams.get("lat") || "");
  const lng = parseFloat(req.nextUrl.searchParams.get("lng") || "");

  if (!q?.trim()) return NextResponse.json([]);

  try {
    if (process.env.GOOGLE_PLACES_API_KEY) {
      const results = await searchWithGoogle(q, isNaN(lat) ? undefined : lat, isNaN(lng) ? undefined : lng);
      if (results.length > 0) return NextResponse.json(results);
    }

    if (process.env.NEXT_PUBLIC_MAPTILER_KEY) {
      const results = await searchWithMapTiler(q, isNaN(lat) ? undefined : lat, isNaN(lng) ? undefined : lng);
      if (results.length > 0) return NextResponse.json(results);
    }

    const results = await searchWithNominatim(q);
    return NextResponse.json(results);
  } catch (err) {
    console.error("Search error:", err);
    return NextResponse.json([]);
  }
}
