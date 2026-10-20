// The /api/import SSE "done" event. The counts other than `imported` are optional
// so a response from an older deployment still produces a message.
export interface ImportDone {
  imported: number;
  parsed?: number;
  duplicates?: number;
  geocodeFailed?: number;
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
