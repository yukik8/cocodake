import type { BoundingBox } from "@/types";

function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

// MapLibre reports bounds with unwrapped longitudes (east can be > 180 when the view
// crosses the antimeridian). Normalise to -180..180; minLng > maxLng then means "crosses".
export function normalizeBounds(west: number, south: number, east: number, north: number): BoundingBox {
  if (east - west >= 360) return { minLng: -180, minLat: south, maxLng: 180, maxLat: north };
  return { minLng: wrapLng(west), minLat: south, maxLng: wrapLng(east), maxLat: north };
}

export function inBounds(p: { lat: number; lng: number }, b: BoundingBox): boolean {
  if (p.lat < b.minLat || p.lat > b.maxLat) return false;
  return b.minLng <= b.maxLng
    ? p.lng >= b.minLng && p.lng <= b.maxLng
    : p.lng >= b.minLng || p.lng <= b.maxLng;
}

// Great-circle distance in metres (haversine)
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function sameIdSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
