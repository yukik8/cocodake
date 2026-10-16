import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase";
import { getVerifiedUserId, unauthorized } from "@/lib/auth";
import { badRequest, readJson, serverError } from "@/lib/http";
import {
  extractCoordsFromUrl,
  extractPlaceIdFromUrl,
  extractPlaceNameFromUrl,
  isTabelogUrl,
  fetchTabelogInfo,
} from "@/lib/parseTakeout";
import { enrichPlaceByCoords, enrichPlaceById, enrichPlaceByName, geocodeAddress } from "@/lib/placesApi";
import { fetchAllowed, isGoogleMapsHost } from "@/lib/safeFetch";
import {
  PLACE_COLUMNS,
  cleanRating,
  cleanText,
  googleMapsPlaceUrl,
  isGooglePlaceId,
  safeHttpUrl,
  toClientPlace,
} from "@/lib/places";
import { placePhotoUrl, refFromPhotoUrl, toPublicPhotoUrl } from "@/lib/photo";
import { saveRefs } from "@/lib/photoCache";
import { distanceMeters } from "@/lib/geo";
import type { Place } from "@/types";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const TAP_MATCH_RADIUS_M = 300;

const URL_ERROR ="URLから座標を取得できませんでした。GoogleマップまたはTabelog（食べログ）のURLを貼り付けてください。";

// 短縮URLを展開する（maps.app.goo.gl など）
// モバイル UA を付けないと Google が座標なしの簡略 URL を返すことがある。
// 取りに行くのは Google のホストだけ（リダイレクト先も含む）。座標か place_id が
// すでに URL にあれば取りに行かない
async function resolveUrl(url: string): Promise<string> {
  if (extractCoordsFromUrl(url) || extractPlaceIdFromUrl(url)) return url;
  try {
    const parsed = new URL(url);
    if (!isGoogleMapsHost(parsed)) return url;
    parsed.protocol = "https:";
    const headers = { "User-Agent": MOBILE_UA };
    const head = await fetchAllowed(parsed.toString(), isGoogleMapsHost, { method: "HEAD", headers });
    if (head && head.response.status !== 405) return head.finalUrl;
    const get = await fetchAllowed(parsed.toString(), isGoogleMapsHost, { headers });
    await get?.response.body?.cancel();
    return get?.finalUrl ?? url;
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
      { headers: { "User-Agent": "cocodake/1.0" }, signal: AbortSignal.timeout(5000) }
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

function readCoord(value: unknown, limit: number): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

function alreadyExists() {
  return NextResponse.json(
    { error: "already_exists", message: "このスポットはすでにリストに追加されています" },
    { status: 409 }
  );
}

type NewPlace = Omit<Place, "id" | "note" | "created_at">;

// place_id があればそれで重複チェック、なければURL一致。同時に2回押されても
// DB のユニーク制約（user_session, place_id）が2件目を弾く。
// 写真は場所の ID で表示し（写真の ID は期限切れになる）、手元の新しい写真の ID を
// place_photos に入れておく（最初の表示でも Google の呼び出しが1回で済む）
async function insertPlace(supabase: SupabaseClient, userId: string, input: NewPlace) {
  const freshRef = input.place_id ? refFromPhotoUrl(input.photo_url) : null;
  const row = input.place_id && input.photo_url ? { ...input, photo_url: placePhotoUrl(input.place_id) } : input;

  const dupQuery = row.place_id
    ? supabase.from("places").select("id").eq("user_session", userId).eq("place_id", row.place_id)
    : supabase.from("places").select("id").eq("user_session", userId).eq("url", row.url ?? "");
  const { data: existing } = await dupQuery.limit(1).maybeSingle();
  if (existing) return alreadyExists();

  const { data, error } = await supabase
    .from("places")
    .insert({ user_session: userId, ...row })
    .select(PLACE_COLUMNS)
    .single();
  if (error?.code === "23505") return alreadyExists();
  if (error || !data) return serverError("places insert", error);
  if (row.place_id && freshRef) await saveRefs(supabase, [{ place_id: row.place_id, photo_ref: freshRef }]);
  return NextResponse.json({ place: toClientPlace(data as unknown as Place) });
}

// プレビュー（保存しない） — place_id または lat/lng
export async function GET(req: NextRequest) {
  const userId = await getVerifiedUserId();
  if (!userId) return unauthorized();

  const { searchParams } = req.nextUrl;
  const placeId = searchParams.get("place_id");
  const lat = readCoord(searchParams.get("lat"), 90);
  const lng = readCoord(searchParams.get("lng"), 180);

  // place_id 優先（検索結果から）— Details 1回で座標も取れる
  if (placeId) {
    if (!isGooglePlaceId(placeId)) return badRequest("invalid place_id");
    const r = await enrichPlaceById(placeId);
    return NextResponse.json({
      name: r?.name ?? null,
      address: r?.address ?? null,
      category: r?.category ?? null,
      rating: r?.rating ?? null,
      photo_url: r?.photo_url ?? null,
      lat: r?.lat ?? lat,
      lng: r?.lng ?? lng,
      place_id: placeId,
    });
  }

  if (lat == null || lng == null) {
    return badRequest("place_id or lat/lng required");
  }

  // 座標からの検索（マップタップ）— name があれば Find Place で精度向上
  const nameParam = cleanText(searchParams.get("name"), 200);
  const enrichResult = await enrichPlaceByCoords(lat, lng, nameParam);
  if (enrichResult?.name) {
    // The place's own coordinates, when Google's match is near the tap; a far-away match
    // (same name elsewhere) keeps the tapped point so the pin doesn't jump across the city
    const near =
      enrichResult.lat != null &&
      enrichResult.lng != null &&
      distanceMeters({ lat, lng }, { lat: enrichResult.lat, lng: enrichResult.lng }) <= TAP_MATCH_RADIUS_M;
    return NextResponse.json({
      name: enrichResult.name,
      address: enrichResult.address,
      category: enrichResult.category,
      rating: enrichResult.rating,
      photo_url: enrichResult.photo_url,
      lat: near ? enrichResult.lat : lat,
      lng: near ? enrichResult.lng : lng,
      place_id: enrichResult.place_id,
    });
  }
  const nominatim = await reverseGeocodeNominatim(lat, lng);
  return NextResponse.json({
    name: nominatim.name,
    address: nominatim.address,
    category: null,
    rating: null,
    photo_url: null,
    lat,
    lng,
    place_id: null,
  });
}

export async function POST(req: NextRequest) {
  const userId = await getVerifiedUserId();
  if (!userId) return unauthorized();

  try {
    const body = await readJson(req);
    if (!body) return badRequest("invalid body");

    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
    const rawLat = readCoord(body.lat, 90);
    const rawLng = readCoord(body.lng, 180);
    const directPlaceId = isGooglePlaceId(body.place_id) ? body.place_id : null;
    const supabase = createServerClient();

    // すべての情報がフロントから渡された場合（検索結果・プレビューからの追加）
    if (directPlaceId && rawLat != null && rawLng != null) {
      const name = cleanText(body.name, 200) || "名称不明";
      return insertPlace(supabase, userId, {
        place_id: directPlaceId,
        name,
        url: googleMapsPlaceUrl(name, directPlaceId),
        lat: rawLat,
        lng: rawLng,
        address: cleanText(body.address, 500),
        category: cleanText(body.category, 100),
        rating: cleanRating(body.rating),
        photo_url: toPublicPhotoUrl(typeof body.photo_url === "string" ? body.photo_url : null),
        enriched: true,
      });
    }

    if (rawUrl && !safeHttpUrl(rawUrl)) {
      return badRequest("http(s) の URL を貼り付けてください");
    }

    let coords: { lat: number; lng: number } | null = null;
    let resolvedUrl: string | null = null;
    let nameFromUrl: string | null = null;
    let placeId: string | null = null;

    if (rawLat != null && rawLng != null) {
      coords = { lat: rawLat, lng: rawLng };
    } else if (rawUrl && isTabelogUrl(rawUrl)) {
      // 食べログURL処理
      const info = await fetchTabelogInfo(rawUrl);
      if (!info.name) {
        return NextResponse.json(
          { error: "食べログページから店名を取得できませんでした" },
          { status: 422 }
        );
      }
      const tabelogName = info.name.slice(0, 100);
      const enrichResult = await enrichPlaceByName(tabelogName, info.lat, info.lng);
      if (!enrichResult?.place_id) {
        return NextResponse.json(
          { error: `「${tabelogName}」をGoogleマップで見つけられませんでした` },
          { status: 422 }
        );
      }
      // 食べログに座標がなければ Google の座標（以前は 0,0 で保存されていた）
      const lat = info.lat ?? enrichResult.lat;
      const lng = info.lng ?? enrichResult.lng;
      if (lat == null || lng == null) {
        return NextResponse.json({ error: "場所の座標を取得できませんでした" }, { status: 422 });
      }
      const name = enrichResult.name || tabelogName;
      return insertPlace(supabase, userId, {
        place_id: enrichResult.place_id,
        name,
        url: googleMapsPlaceUrl(name, enrichResult.place_id),
        lat,
        lng,
        address: enrichResult.address || info.address || null,
        category: enrichResult.category || null,
        rating: enrichResult.rating || null,
        photo_url: enrichResult.photo_url || null,
        enriched: true,
      });
    } else if (rawUrl) {
      resolvedUrl = await resolveUrl(rawUrl);
      coords = extractCoordsFromUrl(resolvedUrl);
      nameFromUrl = extractPlaceNameFromUrl(resolvedUrl);
      placeId = extractPlaceIdFromUrl(resolvedUrl);
      if (!coords && !placeId) {
        // /maps?q=住所+店名&ftid=... 形式（short URL展開後）
        // → 住所をジオコードして座標を取得し、座標+店名で正確に検索する
        try {
          const parsedResolved = new URL(resolvedUrl);
          const qParam = parsedResolved.searchParams.get("q");
          if (qParam && (/〒\d{3}-\d{4}/.test(qParam) || /\d+\s*(?:Chome|丁目)/i.test(qParam))) {
            // 住所内の店名を抽出（"2 Chome−10−2 店名" → "店名"）
            const nameMatch = qParam.match(/\d+\s*(?:Chome[-−\d]+|丁目[-\d−-]*)\s+([^,〒]+?)(?:,|$)/i);
            if (nameMatch?.[1]) nameFromUrl = nameMatch[1].trim();
            // 住所全体をジオコードして座標を取得
            const geocoded = await geocodeAddress(qParam);
            if (geocoded) coords = geocoded;
          }
        } catch { /* ignore */ }

        if (!coords && !placeId) {
          // 店名がURLにある場合は名前のみで検索（最終フォールバック）
          const fallback = nameFromUrl ? await enrichPlaceByName(nameFromUrl) : null;
          if (!fallback?.place_id) {
            return NextResponse.json({ error: URL_ERROR }, { status: 422 });
          }
          placeId = fallback.place_id;
        }
      }
    } else {
      return badRequest("url or lat/lng are required");
    }

    // エンリッチ
    let enriched = false;
    let name = nameFromUrl || "名称不明";
    let address: string | null = null;
    let category: string | null = null;
    let rating: number | null = null;
    let photo_url: string | null = null;

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
      ? googleMapsPlaceUrl(name, resolvedPlaceId)
      : resolvedUrl && resolvedUrl.includes("google.com/maps")
        ? safeHttpUrl(resolvedUrl) ?? `https://www.google.com/maps?q=${coords.lat},${coords.lng}`
        : `https://www.google.com/maps?q=${coords.lat},${coords.lng}`;

    return insertPlace(supabase, userId, {
      place_id: resolvedPlaceId ?? null,
      name: name.slice(0, 200),
      url: googleMapsUrl,
      lat: coords.lat,
      lng: coords.lng,
      address,
      category,
      rating,
      photo_url,
      enriched,
    });
  } catch (err) {
    return serverError("Add place error:", err);
  }
}
