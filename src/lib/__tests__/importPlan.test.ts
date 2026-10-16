import { describe, expect, it } from "vitest";
import { planImport, seenKeysFrom, toImportRow } from "../importPlan";

const PID_URL = "https://www.google.com/maps/search/?api=1&query=A&query_place_id=ChIJsaved0001";
const FEATURE_URL = "https://www.google.com/maps/place/B/data=!4m2!3m1!1s0x6018:0x1234";

describe("planImport", () => {
  it("drops places that are already saved — by place ID, by stored URL or by the Takeout source URL — before any geocoding", () => {
    const seen = seenKeysFrom([
      { place_id: "ChIJsaved0001", url: "https://www.google.com/maps/search/?api=1&query=A&query_place_id=ChIJsaved0001", source_url: null },
      { place_id: "ChIJother0002", url: "https://www.google.com/maps/search/?api=1&query=B&query_place_id=ChIJother0002", source_url: FEATURE_URL },
    ]);
    const plan = planImport(
      [
        { name: "A", url: "https://maps.google.com/?q=place_id:ChIJsaved0001" }, // same place ID
        { name: "B", url: FEATURE_URL }, // same Takeout URL as a saved row
        { name: "C", url: "https://www.google.com/maps/place/C/data=!1s0x1:0x2" }, // new, no coordinates
        { name: "D", url: "https://www.google.com/maps/place/D", lat: 35, lng: 139 }, // new, with coordinates
      ],
      seen
    );
    expect(plan.duplicates).toBe(2);
    expect(plan.withoutCoords.map((c) => c.name)).toEqual(["C"]);
    expect(plan.withCoords.map((c) => c.name)).toEqual(["D"]);
  });

  it("drops a place repeated within the same file", () => {
    const plan = planImport(
      [
        { name: "X", url: PID_URL },
        { name: "X again", url: PID_URL },
        { name: "pin", lat: 1, lng: 2 },
        { name: "pin again", lat: 1, lng: 2 },
      ],
      seenKeysFrom([])
    );
    expect(plan.duplicates).toBe(2);
    expect(plan.withoutCoords).toHaveLength(1);
    expect(plan.withCoords).toHaveLength(1);
  });

  it("ignores a javascript: URL from the file", () => {
    const plan = planImport([{ name: "bad", url: "javascript:alert(1)", lat: 1, lng: 2 }], seenKeysFrom([]));
    expect(plan.withCoords[0].sourceUrl).toBeNull();
    expect(toImportRow(plan.withCoords[0])!.url).toBe("https://www.google.com/maps?q=1,2");
  });
});

describe("toImportRow", () => {
  const candidate = { name: "Cafe", sourceUrl: FEATURE_URL, urlPlaceId: null, address: null, note: "memo" };

  it("uses the geocoded place and stores the canonical URL and the source URL", () => {
    const row = toImportRow(candidate, {
      place_id: "ChIJnew00003",
      lat: 35.6,
      lng: 139.7,
      address: "Tokyo",
      category: "カフェ",
      rating: 4,
      photo_url: "https://maps.googleapis.com/maps/api/place/photo?photo_reference=Ref_ABCDEFGHIJ&key=SECRET",
    });
    expect(row).toMatchObject({
      place_id: "ChIJnew00003",
      url: "https://www.google.com/maps/search/?api=1&query=Cafe&query_place_id=ChIJnew00003",
      source_url: FEATURE_URL,
      lat: 35.6,
      lng: 139.7,
      photo_url: "/api/photo?place_id=ChIJnew00003", // the reference itself goes to place_photos
      note: "memo",
      enriched: true,
    });
  });

  it("returns null when there are still no coordinates", () => {
    expect(toImportRow(candidate, null)).toBeNull();
  });
});
