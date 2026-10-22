import type { Place } from "@/types";
import { parseTakeoutCsv, parseTakeoutJson } from "./parseTakeout";
import { IMPORT_FILE_ERRORS, checkImportFileName } from "./importFileCheck";

// Reads the places out of an uploaded Takeout file, or says what is wrong with it, before the
// import starts streaming, so a wrong file gets its error at once.

export type ImportFileResult = { places: Partial<Place>[] } | { error: string; status: number };

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\3\4"

export function readImportFile(name: string, bytes: Uint8Array): ImportFileResult {
  const nameError = checkImportFileName(name, bytes.length);
  if (nameError) {
    return { error: nameError, status: nameError === IMPORT_FILE_ERRORS.tooLarge ? 413 : 415 };
  }
  // by contents too: a phone can hand over a file under any name
  if (ZIP_MAGIC.every((b, i) => bytes[i] === b)) return { error: IMPORT_FILE_ERRORS.zip, status: 415 };
  if (bytes.subarray(0, 8192).includes(0)) return { error: IMPORT_FILE_ERRORS.unsupported, status: 415 };

  // Strictly UTF-8, as Takeout writes it. A CSV saved by Excel as Shift_JIS still has a readable
  // URL column, so it would import, but without its Japanese title and memo columns.
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { error: IMPORT_FILE_ERRORS.notUtf8, status: 422 };
  }
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  let places: Partial<Place>[];
  if (ext === "json") {
    try {
      places = parseTakeoutJson(JSON.parse(text));
    } catch {
      return { error: IMPORT_FILE_ERRORS.invalidJson, status: 422 };
    }
  } else if (ext === "csv") {
    places = parseTakeoutCsv(text);
  } else {
    try {
      places = parseTakeoutJson(JSON.parse(text));
    } catch {
      places = parseTakeoutCsv(text);
    }
  }

  if (places.length === 0) return { error: IMPORT_FILE_ERRORS.noPlaces, status: 422 };
  return { places };
}
