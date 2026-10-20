import { describe, expect, it, vi } from "vitest";
import { locateCandidate, type PlaceLookups } from "../importGeocode";
import type { ImportCandidate } from "../importPlan";
import type { PlacesResult } from "../placesApi";

const SACHER_URL =
  "https://www.google.com/maps/place/Caf%C3%A9+Sacher+Wien/data=!4m2!3m1!1s0x476d079c6e70ce23:0xdb83f04c896f79da";
const SACHER_CID = "15817750527769278938";

const candidate = (over: Partial<ImportCandidate>): ImportCandidate => ({
  name: "Café Sacher Wien",
  sourceUrl: SACHER_URL,
  urlPlaceId: null,
  address: null,
  note: null,
  ...over,
});
const result = (over: Partial<PlacesResult> = {}): PlacesResult => ({
  name: "カフェ ザッハー",
  address: null,
  category: null,
  rating: null,
  photo_url: null,
  place_id: "ChIJsacher",
  lat: 48.2039,
  lng: 16.3697,
  ...over,
});
const lookups = (found: PlacesResult | null, cid: string | null): PlaceLookups => ({
  byId: vi.fn(async () => found),
  byName: vi.fn(async () => found),
  cidOf: vi.fn(async () => cid),
});

describe("locateCandidate", () => {
  it("searches near the feature ID's position and keeps a result with the same CID", async () => {
    const api = lookups(result(), SACHER_CID);
    expect(await locateCandidate(candidate({}), api)).toEqual(result());
    const [name, lat, lng] = vi.mocked(api.byName).mock.calls[0];
    expect(name).toBe("Café Sacher Wien");
    expect(lat).toBeCloseTo(48.2039, 2);
    expect(lng).toBeCloseTo(16.3697, 2);
    expect(api.cidOf).toHaveBeenCalledWith("ChIJsacher");
  });

  it("drops a result that is another place (another shop nearby, the city for 'Munich')", async () => {
    expect(await locateCandidate(candidate({}), lookups(result(), "75637923834337405"))).toBeNull();
  });

  it("keeps the result when the CID can't be read", async () => {
    expect(await locateCandidate(candidate({}), lookups(result(), null))).toEqual(result());
  });

  it("searches by name alone, without a check, when the URL has no feature ID", async () => {
    const api = lookups(result(), null);
    await locateCandidate(candidate({ sourceUrl: "https://example.com/somewhere" }), api);
    expect(api.byName).toHaveBeenCalledWith("Café Sacher Wien", undefined, undefined);
    expect(api.cidOf).not.toHaveBeenCalled();
  });

  it("looks a place ID up directly", async () => {
    const api = lookups(result(), null);
    await locateCandidate(candidate({ urlPlaceId: "ChIJsacher" }), api);
    expect(api.byId).toHaveBeenCalledWith("ChIJsacher");
    expect(api.byName).not.toHaveBeenCalled();
  });

  it("gives null for a result without coordinates, or a row without a name", async () => {
    expect(await locateCandidate(candidate({}), lookups(result({ lat: null }), SACHER_CID))).toBeNull();
    const api = lookups(result(), SACHER_CID);
    expect(await locateCandidate(candidate({ name: "名称不明" }), api)).toBeNull();
    expect(api.byName).not.toHaveBeenCalled();
  });
});
