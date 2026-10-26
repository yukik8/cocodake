// What's wrong with a file picked for a Takeout import, said the same way by the server and the
// web client (the app keeps a copy in src/lib/importFileCheck.ts). No dependencies, so the
// client can check a file before uploading it.

// Vercel turns away a request body over 4.5 MB before the route runs, with a 413 that isn't our
// JSON, so the limit stays under it (with room for the multipart wrapping)
export const IMPORT_MAX_BYTES = 4 * 1024 * 1024;

export const IMPORT_FILE_ERRORS = {
  missing: "ファイルを選んでください",
  tooMany: "ファイルは1つずつ選んでください",
  tooLarge: "ファイルが大きすぎます（4MBまで）",
  zip: "zipファイルのままです。解凍して、中のCSV（例:「行ってみたい.csv」）かJSONを選んでください",
  unsupported: "対応していないファイル形式です。Google TakeoutのCSVかJSONを選んでください",
  invalidJson: "JSONとして読み込めませんでした。Google TakeoutのCSVかJSONを選んでください",
  notUtf8: "文字化けして読めませんでした。Excelなどで保存し直した場合は「CSV UTF-8」形式で保存してください",
  noPlaces: "このファイルからスポットが見つかりませんでした。Google Takeoutの「保存済み」フォルダにあるCSVかJSONを選んでください",
} as const;

const TEXT_EXTENSIONS = ["json", "csv", "txt"];

// By name and size alone, before anything is read or uploaded. A name without an extension
// passes; the server looks at the contents.
export function checkImportFileName(name: string, size: number): string | null {
  if (size > IMPORT_MAX_BYTES) return IMPORT_FILE_ERRORS.tooLarge;
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "zip") return IMPORT_FILE_ERRORS.zip;
  if (ext && !TEXT_EXTENSIONS.includes(ext)) return IMPORT_FILE_ERRORS.unsupported;
  return null;
}
