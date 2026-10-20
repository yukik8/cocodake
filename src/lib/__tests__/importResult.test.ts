import { describe, expect, it } from "vitest";
import { importResultMessage, notFoundPlaces } from "../importResult";

describe("importResultMessage", () => {
  it("shows how many of the file's places were added and why the rest were skipped", () => {
    expect(importResultMessage({ imported: 600, parsed: 1000, duplicates: 300, geocodeFailed: 100 })).toBe(
      "ファイル内 1000件中 600件を新規追加しました（重複 300件スキップ、座標取得失敗 100件）"
    );
  });

  it("leaves out skip reasons that did not happen", () => {
    expect(importResultMessage({ imported: 5, parsed: 5, duplicates: 0, geocodeFailed: 0 })).toBe(
      "ファイル内 5件中 5件を新規追加しました"
    );
  });

  it('says nothing was added instead of "0件を新規追加しました"', () => {
    expect(importResultMessage({ imported: 0, parsed: 3, duplicates: 3, geocodeFailed: 0 })).toBe(
      "ファイル内 3件中、新規追加はありませんでした（重複 3件スキップ）"
    );
    expect(importResultMessage({ imported: 0, parsed: 4, duplicates: 3, geocodeFailed: 1 })).toBe(
      "ファイル内 4件中、新規追加はありませんでした（重複 3件スキップ、座標取得失敗 1件）"
    );
    expect(importResultMessage({ imported: 0 })).toBe("新規追加はありませんでした");
  });

  it("falls back to the added count when only that is sent", () => {
    expect(importResultMessage({ imported: 12 })).toBe("12件を新規追加しました");
  });
});

describe("notFoundPlaces", () => {
  it("lists the places not found with their links, and counts the rest beyond the list", () => {
    const done = {
      imported: 1,
      geocodeFailed: 3,
      notFound: [
        { name: "Munich", url: "https://www.google.com/maps/place/Munich/data=!4m2!3m1!1s0x1:0x2" },
        { name: "Castle District", url: null },
      ],
    };
    expect(notFoundPlaces(done)).toEqual({ places: done.notFound, more: 1 });
  });

  it("drops links that are not http(s)", () => {
    expect(notFoundPlaces({ imported: 0, geocodeFailed: 1, notFound: [{ name: "x", url: "javascript:alert(1)" }] }).places).toEqual([
      { name: "x", url: null },
    ]);
  });

  it("is empty for an older server that sends no list", () => {
    expect(notFoundPlaces({ imported: 3, geocodeFailed: 2 })).toEqual({ places: [], more: 2 });
  });
});
