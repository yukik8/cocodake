import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import {
  extractCoordsFromUrl,
  extractPlaceIdFromUrl,
  extractPlaceNameFromUrl,
  isTabelogUrl,
  fetchTabelogInfo,
} from "@/lib/parseTakeout";
import { enrichPlaceByCoords, enrichPlaceById, enrichPlaceByName } from "@/lib/placesApi";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// 短縮URLを展開する（maps.app.goo.gl など）
// モバイル UA を付けないと Google が座標なしの簡略 URL を返すことがある
async function resolveUrl(url: string): Promise<string> {
  const headers = { "User-Agent": MOBILE_UA };
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", headers });
    if (res.url && res.url !== url) return res.url;
  } catch {}
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers,
      signal: AbortSignal.timeout(5000),
    });
    return res.url || url;
  } catch {
    return url;
  }
}

// Nominatim で座標から場所情報を取得（Places APIがない場合のフォールバック）
async function reverseGeocodeNominatim(
  lat: number,
  lng: number
): Promise<{ name: string | null; address: string | null }> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ja`,
      { headers: { "User-Agent": "MapShare/1.0" } }
    );
    if (!res.ok) return { name: null, address: null };
    const data = await res.json();
    const name =
      data.name ||
      data.namedetails?.name ||
      data.address?.amenity ||
      data.address?.shop ||
      data.address?.tourism ||
      null;
    const address = data.display_name || null;
    return { name, address };
  } catch {
    return { name: null, address: null };
  }
}

// プレビュー（保存しない） — place_id または lat/lng
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const placeId = searchParams.get("place_id");
  const lat = parseFloat(searchParams.get("lat") || "");
  const lng = parseFloat(searchParams.get("lng") || "");

  let name: string | null = null;
  let address: string | null = null;
  let category: string | null = null;
  let rating: number | null = null;
  let photo_url: string | null = null;
  let resolvedLat = lat;
  let resolvedLng = lng;

  // place_id 優先（検索結果から）
  if (placeId) {
    const enrichResult = await enrichPlaceById(placeId);
    if (enrichResult) {
      name = enrichResult.name;
      address = enrichResult.address;
      category = enrichResult.category;
      rating = enrichResult.rating;
      photo_url = enrichResult.photo_url;
    }
    // place_idから座標も取得
    const geoRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry&key=${process.env.GOOGLE_PLACES_API_KEY}`
    ).catch(() => null);
    if (geoRes?.ok) {
      const geoData = await geoRes.json();
      resolvedLat = geoData.result?.geometry?.location?.lat ?? lat;
      resolvedLng = geoData.result?.geometry?.location?.lng ?? lng;
    }
    return NextResponse.json({ name, address, category, rating, photo_url, lat: resolvedLat, lng: resolvedLng, place_id: placeId });
  }

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "place_id or lat/lng required" }, { status: 400 });
  }

  // 座標からの検索（マップタップ）— name があれば Find Place で精度向上
  const nameParam = searchParams.get("name") || null;
  let tapPlaceId: string | null = null;
  const enrichResult = await enrichPlaceByCoords(lat, lng, nameParam);
  if (enrichResult?.name) {
    name = enrichResult.name;
    address = enrichResult.address;
    category = enrichResult.category;
    rating = enrichResult.rating;
    photo_url = enrichResult.photo_url;
    tapPlaceId = enrichResult.place_id;
  } else {
    const nominatim = await reverseGeocodeNominatim(lat, lng);
    name = nominatim.name;
    address = nominatim.address;
  }

  return NextResponse.json({ name, address, category, rating, photo_url, lat, lng, place_id: tapPlaceId });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url: rawUrl, lat: rawLat, lng: rawLng, session,
      place_id: directPlaceId, name: directName, address: directAddress,
      category: directCategory, rating: directRating, photo_url: directPhoto } = body as {
      url?: string;
      lat?: number;
      lng?: number;
      session: string;
      place_id?: string;
      name?: string;
      address?: string;
      category?: string;
      rating?: number;
      photo_url?: string;
    };

    if (!session) {
      return NextResponse.json({ error: "session is required" }, { status: 400 });
    }

    // すべての情報がフロントから渡された場合（検索結果からの追加）
    if (directPlaceId && rawLat != null && rawLng != null) {
      const googleMapsUrl = `https://www.google.com/maps/place/?q=place_id:${directPlaceId}`;
      const supabase = createServerClient();
      const { data: existing } = await supabase
        .from("places").select("id").eq("user_session", session).eq("place_id", directPlaceId).maybeSingle();
      if (existing) {
        return NextResponse.json(
          { error: "already_exists", message: "このスポットはすでにリストに追加されています" },
          { status: 409 }
        );
      }
      const { data, error } = await supabase.from("places").insert({
        user_session: session,
        place_id: directPlaceId,
        name: directName || "名称不明",
        url: googleMapsUrl,
        lat: rawLat,
        lng: rawLng,
        address: directAddress || null,
        category: directCategory || null,
        rating: directRating || null,
        photo_url: directPhoto || null,
        enriched: true,
      }).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ place: data });
    }

    let coords: { lat: number; lng: number } | null = null;
    let resolvedUrl: string | null = null;
    let nameFromUrl: string | null = null;
    let placeId: string | null = null;

    if (rawLat != null && rawLng != null) {
      coords = { lat: rawLat, lng: rawLng };
    } else if (rawUrl && isTabelogUrl(rawUrl.trim())) {
      // 食べログURL処理
      const info = await fetchTabelogInfo(rawUrl.trim());
      if (!info.name) {
        return NextResponse.json(
          { error: "食べログページから店名を取得できませんでした" },
          { status: 422 }
        );
      }
      const enrichResult = await enrichPlaceByName(info.name, info.lat, info.lng);
      if (!enrichResult?.place_id) {
        return NextResponse.json(
          { error: `「${info.name}」をGoogleマップで見つけられませんでした` },
          { status: 422 }
        );
      }
      const googleMapsUrl = `https://www.google.com/maps/place/?q=place_id:${enrichResult.place_id}`;
      const supabase = createServerClient();
      const { data: existing } = await supabase
        .from("places").select("id").eq("user_session", session).eq("place_id", enrichResult.place_id).maybeSingle();
      if (existing) {
        return NextResponse.json({ error: "already_exists", message: "このスポットはすでにリストに追加されています" }, { status: 409 });
      }
      const { data, error } = await supabase.from("places").insert({
        user_session: session,
        place_id: enrichResult.place_id,
        name: enrichResult.name || info.name,
        url: googleMapsUrl,
        lat: info.lat ?? 0,
        lng: info.lng ?? 0,
        address: enrichResult.address || info.address || null,
        category: enrichResult.category || null,
        rating: enrichResult.rating || null,
        photo_url: enrichResult.photo_url || null,
        enriched: true,
      }).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ place: data });
    } else if (rawUrl) {
      resolvedUrl = await resolveUrl(rawUrl.trim());
      coords = extractCoordsFromUrl(resolvedUrl);
      nameFromUrl = extractPlaceNameFromUrl(resolvedUrl);
      placeId = extractPlaceIdFromUrl(resolvedUrl);
      console.log('[add]', JSON.stringify({ rawUrl: rawUrl.trim(), resolvedUrl, coords, placeId, nameFromUrl }));
      if (!coords && !placeId) {
        // 店名がURLにある場合は Places API テキスト検索でフォールバック
        if (nameFromUrl) {
          console.log('[add] fallback enrichPlaceByName:', nameFromUrl);
          const fallback = await enrichPlaceByName(nameFromUrl);
          console.log('[add] fallback result:', JSON.stringify(fallback));
          if (fallback?.place_id) {
            placeId = fallback.place_id;
          } else {
            return NextResponse.json(
              { error: "URLから座標を取得できませんでした。GoogleマップまたはTabelog（食べログ）のURLを貼り付けてください。" },
              { status: 422 }
            );
          }
        } else {
          return NextResponse.json(
            { error: "URLから座標を取得できませんでした。GoogleマップまたはTabelog（食べログ）のURLを貼り付けてください。" },
            { status: 422 }
          );
        }
      }
    } else {
      return NextResponse.json(
        { error: "url or lat/lng are required" },
        { status: 400 }
      );
    }

    // エンリッチ
    let enriched = false;
    let name = nameFromUrl || "名称不明";
    let address = null;
    let category = null;
    let rating = null;
    let photo_url = null;

    const enrichResult = placeId
      ? await enrichPlaceById(placeId)
      : await enrichPlaceByCoords(coords!.lat, coords!.lng, nameFromUrl || undefined);

    if (enrichResult?.name) {
      name = enrichResult.name;
      address = enrichResult.address;
      category = enrichResult.category;
      rating = enrichResult.rating;
      photo_url = enrichResult.photo_url;
      enriched = true;
      // coords が取れていない場合（place_id のみの場合）enrichResult から補完
      if (!coords && enrichResult.lat != null && enrichResult.lng != null) {
        coords = { lat: enrichResult.lat, lng: enrichResult.lng };
      }
    } else if (coords && !nameFromUrl) {
      // Places APIがない or 失敗 → Nominatimフォールバック
      const nominatim = await reverseGeocodeNominatim(coords.lat, coords.lng);
      name = nominatim.name || "名称不明";
      address = nominatim.address;
    }

    if (!coords) {
      return NextResponse.json(
        { error: "場所の座標を取得できませんでした" },
        { status: 422 }
      );
    }

    const resolvedPlaceId = enrichResult?.place_id || placeId;

    const googleMapsUrl = resolvedPlaceId
      ? `https://www.google.com/maps/place/?q=place_id:${resolvedPlaceId}`
      : resolvedUrl && resolvedUrl.includes("google.com/maps")
        ? resolvedUrl
        : `https://www.google.com/maps?q=${coords.lat},${coords.lng}`;

    const supabase = createServerClient();

    // place_id があればそれで重複チェック、なければURL一致
    const dupQuery = resolvedPlaceId
      ? supabase.from("places").select("id").eq("user_session", session).eq("place_id", resolvedPlaceId)
      : supabase.from("places").select("id").eq("user_session", session).eq("url", googleMapsUrl);
    const { data: existing } = await dupQuery.maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: "already_exists", message: "このスポットはすでにリストに追加されています" },
        { status: 409 }
      );
    }

    const { data, error } = await supabase
      .from("places")
      .insert({
        user_session: session,
        place_id: resolvedPlaceId ?? null,
        name,
        url: googleMapsUrl,
        lat: coords.lat,
        lng: coords.lng,
        address,
        category,
        rating,
        photo_url,
        enriched,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ place: data });
  } catch (err) {
    console.error("Add place error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
