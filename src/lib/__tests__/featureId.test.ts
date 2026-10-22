import { describe, expect, it } from "vitest";
import { parseFeatureId } from "../featureId";

// metres between two points (equirectangular; fine at these distances)
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  return Math.hypot(x, (b.lat - a.lat) * r) * 6371000;
}

describe("parseFeatureId", () => {
  it("reads the CID and a nearby position from a Takeout URL", () => {
    // Café Sacher Wien, from a real Takeout export
    const f = parseFeatureId("https://www.google.com/maps/place/Caf%C3%A9+Sacher+Wien/data=!4m2!3m1!1s0x476d079c6e70ce23:0xdb83f04c896f79da");
    expect(f?.cid).toBe("15817750527769278938"); // 0xdb83f04c896f79da, beyond Number precision
    expect(metres(f!.near, { lat: 48.2039, lng: 16.3697 })).toBeLessThan(100);
  });

  it("works on the other S2 faces (Budapest, Ishigaki)", () => {
    const budapest = parseFeatureId("https://www.google.com/maps/place/Castle+District/data=!4m2!3m1!1s0x4741dc22706ec2b9:0x4980c2155e8aa1d2");
    expect(metres(budapest!.near, { lat: 47.5016, lng: 19.0336 })).toBeLessThan(100);
    const ishigaki = parseFeatureId("https://www.google.com/maps/place/%E7%8E%89%E3%82%84/data=!4m2!3m1!1s0x34600b113fafe9ef:0x7cd373053db58a3f");
    expect(ishigaki!.near.lat).toBeCloseTo(24.29, 1);
    expect(ishigaki!.near.lng).toBeCloseTo(124.18, 1);
  });

  it("reads the ftid of an expanded share link", () => {
    const f = parseFeatureId("https://maps.google.com/maps?q=Caf%C3%A9+Sacher+Wien&ftid=0x476d079c6e70ce23:0xdb83f04c896f79da&entry=gps");
    expect(f?.cid).toBe("15817750527769278938");
    expect(metres(f!.near, { lat: 48.2039, lng: 16.3697 })).toBeLessThan(100);
  });

  it("ignores URLs without a feature ID, and the 0x0:0x0 placeholder", () => {
    expect(parseFeatureId("https://www.google.com/maps/search/48.2210833,14.2374444")).toBeNull();
    expect(parseFeatureId("https://www.google.com/maps/place/?q=place_id:ChIJ3S-JXmauEmsRUcIaWtf4MzE")).toBeNull();
    expect(parseFeatureId("https://www.google.com/maps/place/Cafe/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2")).toBeNull();
  });
});
