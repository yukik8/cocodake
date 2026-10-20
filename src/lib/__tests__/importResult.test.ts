import { describe, expect, it } from "vitest";
import { importResultMessage } from "../importResult";

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
    expect(importResultMessage({ imported: 0, parsed: 3, duplicates: 3, geocodeFailed: 0 })).toBe(
      "ファイル内 3件中 0件を新規追加しました（重複 3件スキップ）"
    );
  });

  it("falls back to the added count when only that is sent", () => {
    expect(importResultMessage({ imported: 12 })).toBe("12件を新規追加しました");
  });
});
