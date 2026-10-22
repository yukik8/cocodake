import { Place } from "@/types";
import { fetchAllowed, isTabelogHost } from "./safeFetch";

// Google Takeout "Saved Places" JSON format
interface TakeoutFeature {
  type: "Feature";
  geometry?: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  } | null;
  properties: {
    // 旧フォーマット
    Title?: string;
    "Google Maps URL"?: string;
    Note?: string;
    Location?: {
      "Business Name"?: string;
      Address?: string;
      "Geo Coordinates"?: {
        Latitude?: number;
        Longitude?: number;
      };
    };
    // 新フォーマット（2024年以降）
    google_maps_url?: string;
    date?: string;
    location?: {
      name?: string;
      address?: string;
      country_code?: string;
      "Geo Coordinates"?: {
        Latitude?: number;
        Longitude?: number;
      };
    };
  };
}

interface TakeoutGeoJSON {
  type: "FeatureCollection";
  features: TakeoutFeature[];
}

// CSV row from Takeout (older format)
interface TakeoutCsvRow {
  Title?: string;
  Note?: string;
  URL?: string;
  Comment?: string;
}

// 日本語ヘッダーを英語に正規化
const JP_HEADER_MAP: Record<string, string> = {
  タイトル: "Title",
  メモ: "Note",
  コメント: "Comment",
  タグ: "Tag",
  URL: "URL",
};

function normalizeHeaders(headers: string[]): string[] {
  return headers.map((h) => {
    const t = h.replace(/^﻿/, "").trim();
    return JP_HEADER_MAP[t] ?? t;
  });
}

// Takeout writes [0, 0] for places it has no coordinates for. Those are kept without
// coordinates (the import geocodes them by name / place ID) instead of being dropped.
function validCoords(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function pushTakeoutPlace(
  results: Partial<Place>[],
  p: { name: string | undefined; url: string | null; coords: { lat: number; lng: number } | null; address: string | null; note: string | null }
) {
  const name = p.name || "名称不明";
  // without coordinates, a row is only useful if it can be geocoded
  if (!p.coords && name === "名称不明" && !(p.url && extractPlaceIdFromUrl(p.url))) return;
  results.push({
    name,
    url: p.url,
    lat: p.coords?.lat,
    lng: p.coords?.lng,
    address: p.address,
    note: p.note,
    enriched: false,
  });
}

export function parseTakeoutJson(raw: unknown): Partial<Place>[] {
  const results: Partial<Place>[] = [];

  // Handle FeatureCollection
  if (
    raw &&
    typeof raw === "object" &&
    (raw as TakeoutGeoJSON).type === "FeatureCollection" &&
    Array.isArray((raw as TakeoutGeoJSON).features)
  ) {
    const fc = raw as TakeoutGeoJSON;
    for (const feature of fc.features) {
      const props = feature?.properties ?? {};
      const geo = props.Location?.["Geo Coordinates"] ?? props.location?.["Geo Coordinates"];
      const coords =
        validCoords(feature?.geometry?.coordinates?.[1], feature?.geometry?.coordinates?.[0]) ??
        validCoords(geo?.Latitude, geo?.Longitude);

      pushTakeoutPlace(results, {
        name:
          props.location?.name ||           // 新フォーマット
          props.Location?.["Business Name"] || // 旧フォーマット
          props.Title,
        url: props.google_maps_url || props["Google Maps URL"] || null,
        coords,
        address: props.location?.address || props.Location?.Address || null,
        note: props.Note || null,
      });
    }
    return results;
  }

  // Handle array of items (some Takeout formats)
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const coords =
        validCoords(item.geometry?.coordinates?.[1], item.geometry?.coordinates?.[0]) ??
        validCoords(item.Location?.["Geo Coordinates"]?.Latitude, item.Location?.["Geo Coordinates"]?.Longitude);

      pushTakeoutPlace(results, {
        name: item.properties?.Location?.["Business Name"] || item.properties?.Title || item.name,
        url: item.properties?.["Google Maps URL"] || item.url || null,
        coords,
        address: item.properties?.Location?.Address || item.address || null,
        note: item.properties?.Note || null,
      });
    }
    return results;
  }

  return results;
}

export function parseTakeoutCsv(csv: string): Partial<Place>[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];

  const headers = normalizeHeaders(rows[0]);
  const results: Partial<Place>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] || "").trim();
    });

    const csvRow = row as TakeoutCsvRow;
    const url = csvRow.URL || row["Google Maps URL"] || "";
    if (!url) continue;

    const coords = extractCoordsFromUrl(url);
    const nameFromUrl = extractPlaceNameFromUrl(url);
    const name = csvRow.Title || nameFromUrl || "名称不明";

    results.push({
      name,
      url,
      lat: coords?.lat,
      lng: coords?.lng,
      note: csvRow.Note || csvRow.Comment || null,
      enriched: false,
    });
  }

  return results;
}

// RFC 4180: quoted fields may contain commas, "" (an escaped quote) and line breaks.
// (Splitting on "\n" first broke any row whose note spans several lines.)
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((v) => v !== "")) rows.push(row);
  return rows;
}

export function extractCoordsFromUrl(
  url: string
): { lat: number; lng: number } | null {
  if (!url) return null;

  // Pattern: !3d{lat}!4d{lng} — the place itself. Checked before @lat,lng, which is the
  // viewport centre and can be far from the pin.
  const d3Match = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (d3Match) {
    return { lat: parseFloat(d3Match[1]), lng: parseFloat(d3Match[2]) };
  }

  // Pattern: /maps/search/lat,lng — a dropped pin in Takeout ("48°13'15.9"N 14°14'14.8"E")
  const searchMatch = url.match(/\/maps\/search\/(-?\d+\.\d+),\+?(-?\d+\.\d+)/);
  if (searchMatch) {
    return { lat: parseFloat(searchMatch[1]), lng: parseFloat(searchMatch[2]) };
  }

  // Pattern: @lat,lng
  const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
  }

  // Pattern: ll=lat,lng
  const llMatch = url.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (llMatch) {
    return { lat: parseFloat(llMatch[1]), lng: parseFloat(llMatch[2]) };
  }

  // Pattern: query=lat,lng
  const queryMatch = url.match(/query=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (queryMatch) {
    return {
      lat: parseFloat(queryMatch[1]),
      lng: parseFloat(queryMatch[2]),
    };
  }

  // Pattern: q=lat,lng (例: https://www.google.com/maps?q=35.xxx,139.xxx)
  const qMatch = url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qMatch) {
    return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };
  }

  return null;
}

// Google place IDs (ChIJ…) from query_place_id=, place_id=, place_id: and !1s… URL forms.
// Feature IDs such as !1s0x6018…:0x1234 are not place IDs and give null.
// The native app and the iOS share extension use the same rules (and the same test cases).
export function extractPlaceIdFromUrl(url: string): string | null {
  if (!url) return null;
  const m1 = url.match(/place_id[=:](ChIJ[A-Za-z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = url.match(/!1s(ChIJ[A-Za-z0-9_-]+)/);
  if (m2) return m2[1];
  return null;
}

export function isTabelogUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && isTabelogHost(u) && /\/\d{8}(\/|$)/.test(u.pathname);
  } catch {
    return false;
  }
}

export interface TabelogInfo {
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

// 食べログページを取得して店名・座標を抽出
export async function fetchTabelogInfo(url: string): Promise<TabelogInfo> {
  const empty: TabelogInfo = { name: null, address: null, lat: null, lng: null };
  if (!isTabelogUrl(url)) return empty;

  try {
    const result = await fetchAllowed(url.replace(/^http:/, "https:"), isTabelogHost, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ja,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml",
      },
      timeoutMs: 8000,
    });
    if (!result?.response.ok) return empty;
    return parseTabelogHtml(await result.response.text());
  } catch {
    return empty; // fetch失敗
  }
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export function parseTabelogHtml(html: string): TabelogInfo {
  const result: TabelogInfo = { name: null, address: null, lat: null, lng: null };

  // 1. JSON-LD（最も信頼できる — 座標・店名・住所がある）
  const jsonLdMatches = html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of jsonLdMatches) {
    try {
      const data = JSON.parse(match[1]);
      const entries = Array.isArray(data) ? data : [data];
      for (const entry of entries) {
        if (entry["@type"] === "Restaurant" || entry["@type"] === "FoodEstablishment") {
          result.name = typeof entry.name === "string" ? entry.name : null;
          const lat = parseFloat(entry.geo?.latitude);
          const lng = parseFloat(entry.geo?.longitude);
          result.lat = Number.isFinite(lat) ? lat : null;
          result.lng = Number.isFinite(lng) ? lng : null;
          const addr = entry.address;
          if (addr) {
            result.address = [addr.addressRegion, addr.addressLocality, addr.streetAddress]
              .filter(Boolean).join("");
          }
          if (result.name) return result; // 取れたら確定
        }
      }
    } catch { /* ignore parse errors */ }
  }

  // 2. og:title フォールバック（例: "店名 (最寄り駅 / エリア)"）
  const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1];
  if (ogTitle) {
    result.name = decodeEntities(ogTitle).replace(/\s*[\(（][^)）]*[\)）].*$/, "").trim().replace(/\s*-\s*食べログ.*$/, "").trim() || null;
  }

  // 3. title タグフォールバック
  if (!result.name) {
    const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1];
    if (titleTag) {
      result.name = decodeEntities(titleTag).replace(/\s*[\(（][^)）]*[\)）].*$/, "").trim().replace(/\s*[-|]\s*食べログ.*$/, "").trim() || null;
    }
  }

  return result;
}

// The place name in a Google Maps ?q= that holds a name and an address. Share links put the
// name first ("Cafe Sakura Shiba Branch, 2 Chome-5-1 Shiba, Minato City, …");
// others put it after the street number ("〒150-0002 東京都渋谷区渋谷2丁目10−2 店名").
// Reading the first form by the second rule gave the town ("Shiba") and saved another shop.
export function placeNameFromQuery(q: string): string | null {
  const first = q.split(",")[0].trim();
  if (q.includes(",") && first && !looksLikeAddress(first)) return first;
  const m = q.match(/\d+\s*(?:Chome[-−\d]+|丁目[-\d−-]*)\s+([^,〒]+?)(?:,|$)/i);
  return m?.[1]?.trim() || null;
}

function looksLikeAddress(s: string): boolean {
  return /〒/.test(s) || /\d+\s*(?:Chome|丁目)/i.test(s) || /^[\d０-９]/.test(s);
}

export function extractPlaceNameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    // /maps/place/NAME/... pattern
    const pathMatch = u.pathname.match(/\/maps\/place\/([^/]+)/);
    if (pathMatch) {
      return decodeURIComponent(pathMatch[1].replace(/\+/g, " "));
    }
    // ?q=店名+住所 形式（座標でない場合）
    const q = u.searchParams.get("q");
    if (q && !/^-?\d+\.\d+,-?\d+\.\d+$/.test(q.trim()) && !q.startsWith("place_id:")) {
      return q;
    }
  } catch {
    // ignore
  }
  return null;
}
