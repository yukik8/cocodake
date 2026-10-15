import { describe, expect, it } from "vitest";
import { cleanRating, cleanText, isGooglePlaceId, isUuid, safeHttpUrl, toClientPlace, toSharedPlace } from "../places";
import { isValidPhotoRef, photoProxyUrl, toPublicPhotoUrl } from "../photo";

const LEGACY_PHOTO =
  "https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=AbC_def-123456&key=SECRET_KEY";

describe("toPublicPhotoUrl", () => {
  it("turns a stored Google photo URL into the proxy path and drops the key", () => {
    expect(toPublicPhotoUrl(LEGACY_PHOTO)).toBe("/api/photo?ref=AbC_def-123456");
  });
  it("keeps a valid proxy path", () => {
    expect(toPublicPhotoUrl(photoProxyUrl("AbC_def-123456"))).toBe("/api/photo?ref=AbC_def-123456");
  });
  it.each([
    [null],
    [""],
    ["https://evil.example/x.jpg"],
    ["/api/photo?ref=bad ref<script>"],
    ["https://maps.googleapis.com/maps/api/place/photo?key=SECRET_KEY"],
    ["javascript:alert(1)"],
  ])("rejects %s", (value) => {
    expect(toPublicPhotoUrl(value)).toBeNull();
  });
  it("validates references", () => {
    expect(isValidPhotoRef("short")).toBe(false);
    expect(isValidPhotoRef("A".repeat(1025))).toBe(false);
  });
});

describe("toSharedPlace", () => {
  it("keeps only the public fields: no owner ID, no private note", () => {
    const shared = toSharedPlace({
      id: "p1",
      user_session: "owner-uuid",
      note: "private",
      enriched: true,
      created_at: "2026-01-01",
      place_id: "ChIJabc123",
      name: "Cafe",
      url: "https://www.google.com/maps?q=1,2",
      lat: 1,
      lng: 2,
      address: null,
      category: "カフェ",
      rating: 4.2,
      photo_url: LEGACY_PHOTO,
    });
    expect(shared).toEqual({
      id: "p1",
      place_id: "ChIJabc123",
      name: "Cafe",
      url: "https://www.google.com/maps?q=1,2",
      lat: 1,
      lng: 2,
      address: null,
      category: "カフェ",
      rating: 4.2,
      photo_url: "/api/photo?ref=AbC_def-123456",
    });
    expect(JSON.stringify(shared)).not.toContain("SECRET_KEY");
  });

  it("drops a javascript: link from an imported file", () => {
    expect(toSharedPlace({ id: "p", url: "javascript:alert(1)", lat: 0, lng: 0 }).url).toBeNull();
  });
});

describe("toClientPlace", () => {
  it("rewrites the photo URL of rows saved before the fix", () => {
    expect(toClientPlace({ id: "1", photo_url: LEGACY_PHOTO }).photo_url).toBe("/api/photo?ref=AbC_def-123456");
  });
});

describe("input cleaning", () => {
  it("safeHttpUrl", () => {
    expect(safeHttpUrl("https://maps.app.goo.gl/abc")).toBe("https://maps.app.goo.gl/abc");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
    expect(safeHttpUrl(42)).toBeNull();
  });
  it("cleanText trims, caps and turns blanks into null", () => {
    expect(cleanText("  abc  ", 10)).toBe("abc");
    expect(cleanText("abcdef", 3)).toBe("abc");
    expect(cleanText("   ", 3)).toBeNull();
    expect(cleanText(5, 3)).toBeNull();
  });
  it("isGooglePlaceId / isUuid / cleanRating", () => {
    expect(isGooglePlaceId("ChIJN1t_tDeuEmsRUsoyG83frY4")).toBe(true);
    expect(isGooglePlaceId("ChIJ'; drop table")).toBe(false);
    expect(isUuid("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(true);
    expect(isUuid("3f2504e0")).toBe(false);
    expect(cleanRating(4.5)).toBe(4.5);
    expect(cleanRating(6)).toBeNull();
    expect(cleanRating("4")).toBeNull();
  });
});
