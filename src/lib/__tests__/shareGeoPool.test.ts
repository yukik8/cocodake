import { describe, expect, it } from "vitest";
import { computeExpiresAt, isExpired, parseExpiresInDays } from "../share";
import { distanceMeters, inBounds, normalizeBounds, sameIdSet } from "../geo";
import { mapWithConcurrency } from "../pool";

describe("share expiry", () => {
  it.each([
    [undefined, 30],
    [0, 0],
    [7, 7],
    [365, 365],
    [-1, null],
    [366, null],
    [1.5, null],
    [Number.NaN, null],
    ["7", null],
    [null, null],
  ])("parseExpiresInDays(%s) → %s", (value, expected) => {
    expect(parseExpiresInDays(value)).toBe(expected);
  });

  it("computes the expiry from now; 0 means never", () => {
    const now = Date.UTC(2026, 0, 1);
    expect(computeExpiresAt(7, now)).toBe("2026-01-08T00:00:00.000Z");
    expect(computeExpiresAt(0, now)).toBeNull();
  });

  it("is expired from the expiry instant on", () => {
    const at = "2026-01-08T00:00:00.000Z";
    expect(isExpired(at, Date.parse(at) - 1)).toBe(false);
    expect(isExpired(at, Date.parse(at))).toBe(true);
    expect(isExpired(null)).toBe(false);
  });
});

describe("geo", () => {
  const box = { minLng: 139, minLat: 35, maxLng: 140, maxLat: 36 };

  it("includes the edges", () => {
    expect(inBounds({ lat: 35, lng: 139 }, box)).toBe(true);
    expect(inBounds({ lat: 36, lng: 140 }, box)).toBe(true);
    expect(inBounds({ lat: 36.0001, lng: 139.5 }, box)).toBe(false);
  });

  it("handles a view that crosses the antimeridian", () => {
    const pacific = normalizeBounds(170, -10, 190, 10); // MapLibre reports east > 180 here
    expect(pacific).toEqual({ minLng: 170, minLat: -10, maxLng: -170, maxLat: 10 });
    expect(inBounds({ lat: 0, lng: 179 }, pacific)).toBe(true);
    expect(inBounds({ lat: 0, lng: -175 }, pacific)).toBe(true);
    expect(inBounds({ lat: 0, lng: 0 }, pacific)).toBe(false);
  });

  it("treats a view wider than the world as every longitude", () => {
    expect(normalizeBounds(-300, -80, 300, 80)).toEqual({ minLng: -180, minLat: -80, maxLng: 180, maxLat: 80 });
  });

  it("measures distance", () => {
    const tokyoStation = { lat: 35.6812, lng: 139.7671 };
    const shinjuku = { lat: 35.6896, lng: 139.7006 };
    expect(distanceMeters(tokyoStation, shinjuku)).toBeGreaterThan(5900);
    expect(distanceMeters(tokyoStation, shinjuku)).toBeLessThan(6200);
    expect(distanceMeters(tokyoStation, tokyoStation)).toBe(0);
  });

  it("compares ID sets", () => {
    expect(sameIdSet(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(sameIdSet(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
  });
});

describe("mapWithConcurrency", () => {
  it("keeps the order and never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const result = await mapWithConcurrency([5, 1, 4, 2, 3, 0], 2, async (ms, i) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      return i * 10;
    });
    expect(result).toEqual([0, 10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
  });
});
