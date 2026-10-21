import { parseFeatureId } from "./featureId";
import type { ImportCandidate } from "./importPlan";
import type { PlacesResult } from "./placesApi";

// Locating one Takeout row without coordinates, kept apart from the route (and from Google) so
// it can be tested. One lookup per row, plus one to check the result when the URL has a CID.
export interface PlaceLookups {
  byId(placeId: string): Promise<PlacesResult | null>;
  byName(name: string, lat?: number, lng?: number): Promise<PlacesResult | null>;
  cidOf(placeId: string): Promise<string | null>;
}

const located = (r: PlacesResult | null) => (r?.lat != null && r?.lng != null ? r : null);

export async function locateCandidate(c: ImportCandidate, api: PlaceLookups): Promise<PlacesResult | null> {
  if (c.urlPlaceId) return located(await api.byId(c.urlPlaceId));
  if (c.name === "名称不明") return null;

  // Search near where the URL's feature ID points, then keep the result only if it is the
  // saved place itself: a similar name nearby (another shop in the same building, the city for
  // a place called "Munich") is not. When the CID can't be read, keep the result as before.
  const feature = c.sourceUrl ? parseFeatureId(c.sourceUrl) : null;
  const found = located(await api.byName(c.name, feature?.near.lat, feature?.near.lng));
  if (!found?.place_id || !feature) return found;
  const cid = await api.cidOf(found.place_id);
  return cid && cid !== feature.cid ? null : found;
}
