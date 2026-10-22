import { describe, expect, it } from "vitest";
import { readImportFile } from "../importFile";
import { IMPORT_FILE_ERRORS, IMPORT_MAX_BYTES, checkImportFileName } from "../importFileCheck";

const bytes = (text: string) => new TextEncoder().encode(text);
const CSV = "タイトル,メモ,URL\nCafe,,https://www.google.com/maps/place/Cafe/data=!4m2!3m1!1s0x1:0x2\n";

describe("checkImportFileName", () => {
  it.each([
    ["保存済み.zip", IMPORT_FILE_ERRORS.zip],
    ["takeout-20261020.ZIP", IMPORT_FILE_ERRORS.zip],
    ["map.png", IMPORT_FILE_ERRORS.unsupported],
    ["行ってみたい.xlsx", IMPORT_FILE_ERRORS.unsupported],
    ["行ってみたい.csv", null],
    ["Saved Places.json", null],
    ["notes.txt", null],
    ["no-extension", null],
  ])("%s", (name, expected) => {
    expect(checkImportFileName(name, 1000)).toBe(expected);
  });

  it("rejects a file over 10MB before anything else", () => {
    expect(checkImportFileName("a.csv", IMPORT_MAX_BYTES + 1)).toBe(IMPORT_FILE_ERRORS.tooLarge);
  });
});

describe("readImportFile", () => {
  it("reads the places from a Takeout CSV", () => {
    const r = readImportFile("行ってみたい.csv", bytes(CSV));
    expect("places" in r && r.places.map((p) => p.name)).toEqual(["Cafe"]);
  });

  it("spots a zip by its contents, whatever its name", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(readImportFile("document", zip)).toEqual({ error: IMPORT_FILE_ERRORS.zip, status: 415 });
  });

  it("turns away a binary file named like text", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(readImportFile("map.csv", png)).toEqual({ error: IMPORT_FILE_ERRORS.unsupported, status: 415 });
  });

  it("turns away a CSV that isn't UTF-8 even when its URL column is readable", () => {
    // "タイトル,メモ,URL" and "カフェ,窓際," in Shift_JIS, as Excel saves it; the URL is ASCII.
    // Read as UTF-8 it would import with the title and memo silently lost.
    const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
    const file = new Uint8Array([
      ...hex("835e83438367838b2c838183822c55524c0d0a"),
      ...hex("834a837483462c918b8ddb2c"),
      ...bytes("https://www.google.com/maps/place/Cafe/data=!4m2!3m1!1s0x1:0x2\r\n"),
    ]);
    expect(readImportFile("行ってみたい.csv", file)).toEqual({ error: IMPORT_FILE_ERRORS.notUtf8, status: 422 });
  });

  it("says when a .json file isn't JSON", () => {
    expect(readImportFile("Saved Places.json", bytes("{broken"))).toEqual({ error: IMPORT_FILE_ERRORS.invalidJson, status: 422 });
  });

  it("says when a file has no places, and when it is not UTF-8 (a CSV saved by Excel as Shift_JIS)", () => {
    expect(readImportFile("list.csv", bytes("name,address\nCafe,Tokyo\n"))).toEqual({ error: IMPORT_FILE_ERRORS.noPlaces, status: 422 });
    expect(readImportFile("Saved Places.json", bytes('{"type":"FeatureCollection","features":[]}'))).toEqual({
      error: IMPORT_FILE_ERRORS.noPlaces,
      status: 422,
    });
    // "タイトル,URL" in Shift_JIS
    const sjis = new Uint8Array([0x83, 0x5e, 0x83, 0x43, 0x83, 0x67, 0x83, 0x8b, 0x2c, 0x55, 0x52, 0x4c, 0x0a]);
    expect(readImportFile("行ってみたい.csv", sjis)).toEqual({ error: IMPORT_FILE_ERRORS.notUtf8, status: 422 });
  });
});
