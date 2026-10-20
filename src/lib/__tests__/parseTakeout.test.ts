import { describe, expect, it } from "vitest";
import {
  extractCoordsFromUrl,
  extractPlaceIdFromUrl,
  extractPlaceNameFromUrl,
  isTabelogUrl,
  parseCsv,
  parseTabelogHtml,
  parseTakeoutCsv,
  parseTakeoutJson,
} from "../parseTakeout";

// Same cases as the native app (map-native src/lib/__tests__/placeId.test.ts) and the iOS share extension
describe("extractPlaceIdFromUrl", () => {
  it.each([
    ["https://www.google.com/maps/search/?api=1&query=X&query_place_id=ChIJabc123", "ChIJabc123"],
    ["https://maps.google.com/?q=place_id:ChIJabc123", "ChIJabc123"],
    ["https://www.google.com/maps/place/?q=place_id=ChIJabc123&foo=1", "ChIJabc123"],
    ["https://www.google.com/maps/place/X/data=!4m2!3m1!1sChIJabc123!2m1", "ChIJabc123"],
    ["https://www.google.com/maps/place/X/data=!3m1!1s0x6018:0x1234", null],
    ["", null],
  ])("%s → %s", (url, expected) => {
    expect(extractPlaceIdFromUrl(url)).toBe(expected);
  });

  it("prefers the place_id parameter over a !1s segment", () => {
    expect(extractPlaceIdFromUrl("https://g.co/x/data=!1sChIJfromData?query_place_id=ChIJfromParam")).toBe("ChIJfromParam");
  });
});

describe("extractCoordsFromUrl", () => {
  it("takes the place pin (!3d!4d), not the viewport centre (@), when a URL has both", () => {
    const url = "https://www.google.com/maps/place/Cafe/@35.6000000,139.7000000,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d35.6581!4d139.7017";
    expect(extractCoordsFromUrl(url)).toEqual({ lat: 35.6581, lng: 139.7017 });
  });

  it.each([
    ["https://www.google.com/maps/@35.1,139.2,15z", { lat: 35.1, lng: 139.2 }],
    ["https://maps.google.com/?ll=35.3,139.4", { lat: 35.3, lng: 139.4 }],
    ["https://www.google.com/maps/search/?api=1&query=-33.86,151.21", { lat: -33.86, lng: 151.21 }],
    ["https://www.google.com/maps?q=35.5,139.6", { lat: 35.5, lng: 139.6 }],
    // a dropped pin in Takeout
    ["https://www.google.com/maps/search/48.2210833,14.2374444", { lat: 48.2210833, lng: 14.2374444 }],
    ["https://www.google.com/maps/search/-33.86,+151.21", { lat: -33.86, lng: 151.21 }],
    ["https://www.google.com/maps/search/ramen", null],
    ["https://www.google.com/maps/place/Shop", null],
    ["", null],
  ])("%s", (url, expected) => {
    expect(extractCoordsFromUrl(url)).toEqual(expected);
  });
});

describe("extractPlaceNameFromUrl", () => {
  it("reads the name from /maps/place/NAME", () => {
    expect(extractPlaceNameFromUrl("https://www.google.com/maps/place/%E3%82%AB%E3%83%95%E3%82%A7+ABC/@1.0,2.0")).toBe("カフェ ABC");
  });
  it("ignores q= when it holds coordinates or a place_id", () => {
    expect(extractPlaceNameFromUrl("https://www.google.com/maps?q=35.5,139.6")).toBeNull();
    expect(extractPlaceNameFromUrl("https://maps.google.com/?q=place_id:ChIJabc123")).toBeNull();
  });
});

describe("parseCsv", () => {
  it("handles quoted commas, escaped quotes, line breaks inside quotes, CRLF and a BOM", () => {
    const csv = '﻿Title,Note,URL\r\n"Cafe, Shibuya","He said ""hi""\nsecond line",https://x/1\r\n\r\nBar,,https://x/2\n';
    expect(parseCsv(csv)).toEqual([
      ["Title", "Note", "URL"],
      ["Cafe, Shibuya", 'He said "hi"\nsecond line', "https://x/1"],
      ["Bar", "", "https://x/2"],
    ]);
  });
});

describe("parseTakeoutCsv", () => {
  it("reads Japanese headers and keeps a multi-line note on one place", () => {
    const csv = 'タイトル,メモ,URL,コメント\n"店A","1行目\n2行目",https://www.google.com/maps/place/A/data=!3d35.1!4d139.1,\n店B,,,\n';
    const places = parseTakeoutCsv(csv);
    expect(places).toHaveLength(1); // 店B has no URL
    expect(places[0]).toMatchObject({ name: "店A", note: "1行目\n2行目", lat: 35.1, lng: 139.1 });
  });
});

describe("parseTakeoutJson", () => {
  const feature = (coordinates: [number, number], properties: object) => ({ type: "Feature", geometry: { type: "Point", coordinates }, properties });

  it("reads the 2024 format", () => {
    const places = parseTakeoutJson({
      type: "FeatureCollection",
      features: [feature([139.7, 35.6], { google_maps_url: "https://maps.google.com/?cid=1", location: { name: "Cafe", address: "Tokyo" } })],
    });
    expect(places).toEqual([
      { name: "Cafe", url: "https://maps.google.com/?cid=1", lat: 35.6, lng: 139.7, address: "Tokyo", note: null, enriched: false },
    ]);
  });

  it("keeps a named place Takeout wrote as [0, 0] without coordinates (it gets geocoded), drops an unnamed one", () => {
    const places = parseTakeoutJson({
      type: "FeatureCollection",
      features: [
        feature([0, 0], { location: { name: "Named" } }),
        feature([0, 0], { google_maps_url: "https://maps.google.com/?cid=2" }),
      ],
    });
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ name: "Named", lat: undefined, lng: undefined });
  });

  it("reads the old format's Geo Coordinates", () => {
    const places = parseTakeoutJson({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: null, properties: { Title: "Old", Location: { "Business Name": "Old Shop", "Geo Coordinates": { Latitude: 34.7, Longitude: 135.5 } } } }],
    });
    expect(places[0]).toMatchObject({ name: "Old Shop", lat: 34.7, lng: 135.5 });
  });

  it("returns nothing for unrelated JSON", () => {
    expect(parseTakeoutJson({ hello: "world" })).toEqual([]);
    expect(parseTakeoutJson(null)).toEqual([]);
  });
});

describe("isTabelogUrl", () => {
  it.each([
    ["https://tabelog.com/tokyo/A1303/A130301/13123456/", true],
    ["https://s.tabelog.com/tokyo/A1303/A130301/13123456", true],
    ["https://evil.example/?tabelog.com/a/12345678", false],
    ["https://tabelog.com.evil.example/tokyo/A1/13123456/", false],
    ["javascript:alert(1)//tabelog.com/a/12345678", false],
    ["https://tabelog.com/tokyo/", false],
  ])("%s → %s", (url, expected) => {
    expect(isTabelogUrl(url)).toBe(expected);
  });
});

describe("parseTabelogHtml", () => {
  it("prefers JSON-LD", () => {
    const html = `<script type="application/ld+json">{"@type":"Restaurant","name":"すし店","geo":{"latitude":"35.1","longitude":"139.2"},"address":{"addressRegion":"東京都","addressLocality":"港区","streetAddress":"1-2-3"}}</script>`;
    expect(parseTabelogHtml(html)).toEqual({ name: "すし店", lat: 35.1, lng: 139.2, address: "東京都港区1-2-3" });
  });

  it("reads JSON-LD given as an array, with no geo", () => {
    const html = `<script type="application/ld+json">[{"@type":"BreadcrumbList"},{"@type":"FoodEstablishment","name":"そば屋"}]</script>`;
    expect(parseTabelogHtml(html)).toMatchObject({ name: "そば屋", lat: null, lng: null });
  });

  it("falls back to og:title without the station part, then to <title>", () => {
    expect(parseTabelogHtml(`<meta property="og:title" content="ラーメン &amp; 餃子 （渋谷/ラーメン）">`).name).toBe("ラーメン & 餃子");
    expect(parseTabelogHtml(`<title>カレー屋 - 食べログ</title>`).name).toBe("カレー屋");
    expect(parseTabelogHtml(`<p>nothing</p>`).name).toBeNull();
  });
});
