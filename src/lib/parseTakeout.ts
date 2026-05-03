import { Place } from "@/types";

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
  return headers.map((h) => JP_HEADER_MAP[h] ?? h);
}

export function parseTakeoutJson(raw: unknown): Partial<Place>[] {
  const results: Partial<Place>[] = [];

  // Handle FeatureCollection
  if (
    raw &&
    typeof raw === "object" &&
    (raw as TakeoutGeoJSON).type === "FeatureCollection"
  ) {
    const fc = raw as TakeoutGeoJSON;
    for (const feature of fc.features) {
      const props = feature.properties;
      let lat: number | undefined;
      let lng: number | undefined;

      if (feature.geometry?.coordinates) {
        [lng, lat] = feature.geometry.coordinates;
      } else if (props.Location?.["Geo Coordinates"]) {
        lat = props.Location["Geo Coordinates"].Latitude;
        lng = props.Location["Geo Coordinates"].Longitude;
      } else if (props.location?.["Geo Coordinates"]) {
        lat = props.location["Geo Coordinates"].Latitude;
        lng = props.location["Geo Coordinates"].Longitude;
      }

      if (!lat || !lng) continue;

      results.push({
        name:
          props.location?.name ||           // 新フォーマット
          props.Location?.["Business Name"] || // 旧フォーマット
          props.Title ||
          "名称不明",
        url: props.google_maps_url || props["Google Maps URL"] || null,
        lat,
        lng,
        address: props.location?.address || props.Location?.Address || null,
        note: props.Note || null,
        enriched: false,
      });
    }
    return results;
  }

  // Handle array of items (some Takeout formats)
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const lat =
        item.geometry?.coordinates?.[1] ??
        item.Location?.["Geo Coordinates"]?.Latitude;
      const lng =
        item.geometry?.coordinates?.[0] ??
        item.Location?.["Geo Coordinates"]?.Longitude;

      if (!lat || !lng) continue;

      results.push({
        name:
          item.properties?.Location?.["Business Name"] ||
          item.properties?.Title ||
          item.name ||
          "名称不明",
        url:
          item.properties?.["Google Maps URL"] || item.url || null,
        lat,
        lng,
        address:
          item.properties?.Location?.Address ||
          item.address ||
          null,
        note: item.properties?.Note || null,
        enriched: false,
      });
    }
    return results;
  }

  return results;
}

export function parseTakeoutCsv(csv: string): Partial<Place>[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  const rawHeaders = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
  const headers = normalizeHeaders(rawHeaders);
  const results: Partial<Place>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] || "").trim().replace(/"/g, "");
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

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export function extractCoordsFromUrl(
  url: string
): { lat: number; lng: number } | null {
  if (!url) return null;

  // Pattern: @lat,lng or !3dlat!4dlng
  const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
  }

  // Pattern: ll=lat,lng
  const llMatch = url.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (llMatch) {
    return { lat: parseFloat(llMatch[1]), lng: parseFloat(llMatch[2]) };
  }

  // Pattern: !3d{lat}!4d{lng}
  const d3Match = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (d3Match) {
    return { lat: parseFloat(d3Match[1]), lng: parseFloat(d3Match[2]) };
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

export function extractPlaceIdFromUrl(url: string): string | null {
  const m1 = url.match(/place_id=([^&/\s]+)/);
  if (m1) return m1[1];
  const m2 = url.match(/!1s(ChIJ[^!]+)/);
  if (m2) return m2[1];
  return null;
}

export function isTabelogUrl(url: string): boolean {
  return /tabelog\.com\/.+\/\d{8}/.test(url);
}

export interface TabelogInfo {
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

// 食べログページを取得して店名・座標を抽出
export async function fetchTabelogInfo(url: string): Promise<TabelogInfo> {
  const result: TabelogInfo = { name: null, address: null, lat: null, lng: null };

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ja,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return result;

    const html = await res.text();

    // 1. JSON-LD（最も信頼できる — 座標・店名・住所がある）
    const jsonLdMatches = html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    for (const match of jsonLdMatches) {
      try {
        const data = JSON.parse(match[1]);
        const entries = Array.isArray(data) ? data : [data];
        for (const entry of entries) {
          if (entry["@type"] === "Restaurant" || entry["@type"] === "FoodEstablishment") {
            result.name = entry.name || null;
            result.lat = entry.geo?.latitude ? parseFloat(entry.geo.latitude) : null;
            result.lng = entry.geo?.longitude ? parseFloat(entry.geo.longitude) : null;
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
      result.name = ogTitle.replace(/\s*[\(（][^)）]*[\)）].*$/, "").trim().replace(/\s*-\s*食べログ.*$/, "").trim() || null;
    }

    // 3. title タグフォールバック
    if (!result.name) {
      const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1];
      if (titleTag) {
        result.name = titleTag.replace(/\s*[\(（][^)）]*[\)）].*$/, "").trim().replace(/\s*[-|]\s*食べログ.*$/, "").trim() || null;
      }
    }
  } catch { /* fetch失敗 */ }

  return result;
}

export function extractPlaceNameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    // /maps/place/NAME/... pattern
    const pathMatch = u.pathname.match(/\/maps\/place\/([^/]+)/);
    if (pathMatch) {
      return decodeURIComponent(pathMatch[1].replace(/\+/g, " "));
    }
  } catch {
    // ignore
  }
  return null;
}
