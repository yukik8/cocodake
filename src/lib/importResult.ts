// The /api/import SSE "done" event. The counts other than `imported` are optional
// so a response from an older deployment still produces a message.
export interface ImportDone {
  imported: number;
  parsed?: number;
  duplicates?: number;
  geocodeFailed?: number;
  notFound?: NotFoundPlace[];
}

export interface NotFoundPlace {
  name: string;
  url: string | null;
}

// Summary shown when a Takeout import finishes, e.g.
// "ファイル内 1000件中 600件を新規追加しました（重複 300件スキップ、座標取得失敗 100件）"
export function importResultMessage(done: ImportDone): string {
  const details: string[] = [];
  if ((done.duplicates ?? 0) > 0) details.push(`重複 ${done.duplicates}件スキップ`);
  if ((done.geocodeFailed ?? 0) > 0) details.push(`座標取得失敗 ${done.geocodeFailed}件`);
  const suffix = details.length > 0 ? `（${details.join("、")}）` : "";
  // When every place was a duplicate or failed to geocode, don't say "0件を新規追加しました"
  const added = done.imported > 0 ? `${done.imported}件を新規追加しました` : "新規追加はありませんでした";
  const prefix = typeof done.parsed === "number" ? `ファイル内 ${done.parsed}件中${done.imported > 0 ? " " : "、"}` : "";
  return `${prefix}${added}${suffix}`;
}

// The places the import could not find, to add one by one from their links. The server lists
// at most 100; `more` is the rest. Only http(s) links are kept.
export function notFoundPlaces(done: ImportDone): { places: NotFoundPlace[]; more: number } {
  const places = (done.notFound ?? []).map((p) => ({
    name: p.name,
    url: p.url && /^https?:\/\//i.test(p.url) ? p.url : null,
  }));
  return { places, more: Math.max(0, (done.geocodeFailed ?? 0) - places.length) };
}
