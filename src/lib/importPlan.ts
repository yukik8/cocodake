import type { Place } from "@/types";
import { extractPlaceIdFromUrl } from "./parseTakeout";
import { googleMapsPlaceUrl, safeHttpUrl } from "./places";
import { photoUrlForPlace, toPublicPhotoUrl } from "./photo";

// Pure planning for a Takeout import, kept apart from the route so it can be tested:
// duplicates (already saved, or repeated in the file) are dropped BEFORE any Google call.
// Before, every row without coordinates was geocoded first and only then deduplicated,
// so re-importing the same file paid the full Google cost again.

export interface ImportCandidate {
  name: string;
  sourceUrl: string | null; // the URL as written in the Takeout file
  urlPlaceId: string | null;
  lat?: number;
  lng?: number;
  address: string | null;
  note: string | null;
}

export interface SeenKeys {
  placeIds: Set<string>;
  urls: Set<string>;
}

export interface ExistingRow {
  place_id: string | null;
  url: string | null;
  source_url: string | null;
}

export function seenKeysFrom(rows: ExistingRow[]): SeenKeys {
  const placeIds = new Set<string>();
  const urls = new Set<string>();
  for (const r of rows) {
    if (r.place_id) placeIds.add(r.place_id);
    if (r.url) urls.add(r.url);
    if (r.source_url) urls.add(r.source_url);
  }
  return { placeIds, urls };
}

function coordsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function planImport(
  parsed: Partial<Place>[],
  seen: SeenKeys
): { withCoords: ImportCandidate[]; withoutCoords: ImportCandidate[]; duplicates: number } {
  const withCoords: ImportCandidate[] = [];
  const withoutCoords: ImportCandidate[] = [];
  let duplicates = 0;

  for (const p of parsed) {
    const rawUrl = typeof p.url === "string" ? p.url : null;
    const sourceUrl = safeHttpUrl(rawUrl);
    const urlPlaceId = sourceUrl ? extractPlaceIdFromUrl(sourceUrl) : null;
    const hasCoords = typeof p.lat === "number" && typeof p.lng === "number";
    const urlKeys = [rawUrl, sourceUrl, !sourceUrl && hasCoords ? coordsUrl(p.lat!, p.lng!) : null].filter(
      (u): u is string => !!u
    );

    if ((urlPlaceId && seen.placeIds.has(urlPlaceId)) || urlKeys.some((u) => seen.urls.has(u))) {
      duplicates++;
      continue;
    }
    if (urlPlaceId) seen.placeIds.add(urlPlaceId);
    urlKeys.forEach((u) => seen.urls.add(u));

    const candidate: ImportCandidate = {
      name: (p.name || "名称不明").slice(0, 200),
      sourceUrl,
      urlPlaceId,
      lat: hasCoords ? p.lat : undefined,
      lng: hasCoords ? p.lng : undefined,
      address: p.address ?? null,
      note: p.note ? p.note.slice(0, 2000) : null,
    };
    (hasCoords ? withCoords : withoutCoords).push(candidate);
  }

  return { withCoords, withoutCoords, duplicates };
}

export interface GeocodeResult {
  place_id: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  category: string | null;
  rating: number | null;
  photo_url: string | null;
}

export type ImportRow = Omit<Place, "id" | "created_at"> & { source_url: string | null };

export function toImportRow(c: ImportCandidate, geo?: GeocodeResult | null): ImportRow | null {
  const lat = geo?.lat ?? c.lat;
  const lng = geo?.lng ?? c.lng;
  if (lat == null || lng == null) return null;
  const placeId = geo?.place_id ?? c.urlPlaceId;
  return {
    place_id: placeId,
    name: c.name,
    url: placeId ? googleMapsPlaceUrl(c.name, placeId) : c.sourceUrl || coordsUrl(lat, lng),
    source_url: c.sourceUrl,
    lat,
    lng,
    address: c.address || geo?.address || null,
    category: geo?.category ?? null,
    rating: geo?.rating ?? null,
    photo_url: photoUrlForPlace(toPublicPhotoUrl(geo?.photo_url), placeId),
    note: c.note,
    enriched: !!geo,
  };
}
