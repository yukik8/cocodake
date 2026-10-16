import type { SharedPlace } from "@/types";
import { photoUrlForPlace } from "./photo";

export { isGooglePlaceId, isUuid } from "./ids";

// Columns sent to the owner's apps. user_session and the PostGIS geom column stay in the DB
// (geom alone added ~50 bytes of hex per row to every list response).
export const PLACE_COLUMNS =
  "id, place_id, name, url, lat, lng, address, category, rating, photo_url, note, enriched, created_at";

export function toClientPlace<T extends { photo_url: string | null; place_id?: string | null }>(row: T): T {
  return { ...row, photo_url: photoUrlForPlace(row.photo_url, row.place_id) };
}

// What a share link exposes: no owner id and no private note. Also applied when reading
// shares created before this change, whose snapshots still hold every column.
export function toSharedPlace(row: Record<string, unknown>): SharedPlace {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    id: String(row.id),
    place_id: str(row.place_id),
    name: str(row.name),
    url: safeHttpUrl(row.url),
    lat: num(row.lat) ?? 0,
    lng: num(row.lng) ?? 0,
    address: str(row.address),
    category: str(row.category),
    rating: num(row.rating),
    photo_url: photoUrlForPlace(str(row.photo_url), str(row.place_id)),
  };
}

export const SHARED_PLACE_COLUMNS = "id, place_id, name, url, lat, lng, address, category, rating, photo_url";

// Only http(s) links are stored or rendered (no javascript: or data: URLs from imported files).
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}

export function cleanRating(value: unknown): number | null {
  return typeof value === "number" && value >= 0 && value <= 5 ? value : null;
}

export function googleMapsPlaceUrl(name: string, placeId: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${placeId}`;
}
