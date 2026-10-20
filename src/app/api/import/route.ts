import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase";
import { getVerifiedUserId, unauthorized } from "@/lib/auth";
import { parseTakeoutJson, parseTakeoutCsv } from "@/lib/parseTakeout";
import { enrichPlaceByName, enrichPlaceById, placeCid } from "@/lib/placesApi";
import { locateCandidate } from "@/lib/importGeocode";
import { mapWithConcurrency } from "@/lib/pool";
import { createProgressReporter } from "@/lib/progress";
import { refFromPhotoUrl } from "@/lib/photo";
import { saveRefs } from "@/lib/photoCache";
import { planImport, seenKeysFrom, toImportRow, type ExistingRow, type ImportCandidate, type ImportRow } from "@/lib/importPlan";
import { Place } from "@/types";

export const maxDuration = 300;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
// Google calls in flight at once (was 5 per batch plus a fixed 120 ms pause between batches)
const GEOCODE_CONCURRENCY = 10;
// Rows are saved chunk by chunk, so a timeout keeps what was already geocoded
const GEOCODE_CHUNK = 50;
// Places not found are listed by name with their link, so they can be added one by one
const NOT_FOUND_LIST_MAX = 100;

type ProgressEvent =
  | { type: "progress"; phase: "geocoding"; current: number; total: number }
  | { type: "progress"; phase: "parsing" | "saving" }
  | {
      type: "done";
      imported: number;
      parsed: number;
      geocodeFailed: number;
      duplicates: number;
      notFound: { name: string; url: string | null }[];
    }
  | { type: "error"; message: string };

async function loadExistingKeys(supabase: SupabaseClient, userId: string) {
  const PAGE = 1000;
  const rows: ExistingRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("places")
      .select("place_id, url, source_url")
      .eq("user_session", userId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return seenKeysFrom(rows);
}

// ON CONFLICT DO NOTHING on (user_session, place_id): a place saved meanwhile is skipped,
// not a failed batch. Returns how many rows were actually inserted.
async function saveRows(supabase: SupabaseClient, userId: string, rows: ImportRow[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r) => ({ user_session: userId, ...r }));
    const { data, error } = await supabase
      .from("places")
      .upsert(batch, { onConflict: "user_session,place_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    inserted += data?.length ?? 0;
  }
  return inserted;
}

const lookups = { byId: enrichPlaceById, byName: enrichPlaceByName, cidOf: placeCid };

async function runImport(
  file: File,
  userId: string,
  onProgress: (event: ProgressEvent) => void
): Promise<void> {
  onProgress({ type: "progress", phase: "parsing" });

  const text = await file.text();
  let parsed: Partial<Place>[] = [];
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith(".json")) {
    try {
      parsed = parseTakeoutJson(JSON.parse(text));
    } catch {
      onProgress({ type: "error", message: "Invalid JSON file" });
      return;
    }
  } else if (fileName.endsWith(".csv")) {
    parsed = parseTakeoutCsv(text);
  } else {
    try {
      parsed = parseTakeoutJson(JSON.parse(text));
    } catch {
      parsed = parseTakeoutCsv(text);
    }
  }

  if (parsed.length === 0) {
    onProgress({ type: "error", message: "No valid places found in file" });
    return;
  }

  const supabase = createServerClient();
  const seen = await loadExistingKeys(supabase, userId);
  const plan = planImport(parsed, seen);
  let duplicates = plan.duplicates;
  let imported = 0;
  let geocodeFailed = 0;
  const notFound: { name: string; url: string | null }[] = [];
  const markNotFound = (c: ImportCandidate) => {
    geocodeFailed++;
    if (notFound.length < NOT_FOUND_LIST_MAX) notFound.push({ name: c.name, url: c.sourceUrl });
  };

  onProgress({ type: "progress", phase: "saving" });
  const ready = plan.withCoords.map((c) => toImportRow(c)).filter((r): r is ImportRow => !!r);
  const readyInserted = await saveRows(supabase, userId, ready);
  imported += readyInserted;
  duplicates += ready.length - readyInserted;

  // Progress is reported as each place is located (at most once a second), not only when a
  // chunk of 50 is saved, so a long import visibly keeps moving
  const total = plan.withoutCoords.length;
  const progress = createProgressReporter(total, (current) =>
    onProgress({ type: "progress", phase: "geocoding", current, total })
  );
  if (total > 0) progress.start();
  for (let i = 0; i < total; i += GEOCODE_CHUNK) {
    const chunk = plan.withoutCoords.slice(i, i + GEOCODE_CHUNK);
    const results = await mapWithConcurrency(chunk, GEOCODE_CONCURRENCY, async (c) => {
      const geo = await locateCandidate(c, lookups);
      progress.tick();
      return geo;
    });

    const rows: ImportRow[] = [];
    const refs: { place_id: string; photo_ref: string }[] = [];
    results.forEach((geo, k) => {
      if (!geo) {
        markNotFound(chunk[k]);
        return;
      }
      // two different URLs in the file (or an already saved spot) can resolve to the same place
      if (geo.place_id && seen.placeIds.has(geo.place_id) && geo.place_id !== chunk[k].urlPlaceId) {
        duplicates++;
        return;
      }
      if (geo.place_id) seen.placeIds.add(geo.place_id);
      const row = toImportRow(chunk[k], geo);
      if (row) rows.push(row);
      else markNotFound(chunk[k]);
      const ref = refFromPhotoUrl(geo.photo_url);
      if (row && geo.place_id && ref) refs.push({ place_id: geo.place_id, photo_ref: ref });
    });

    const inserted = await saveRows(supabase, userId, rows);
    await saveRefs(supabase, refs);
    imported += inserted;
    duplicates += rows.length - inserted;
  }
  if (total > 0) progress.finish();

  onProgress({ type: "done", imported, parsed: parsed.length, geocodeFailed, duplicates, notFound });
}

export async function POST(req: NextRequest) {
  const userId = await getVerifiedUserId();
  if (!userId) return unauthorized();

  let file: File | null = null;
  try {
    const value = (await req.formData()).get("file");
    file = value instanceof File ? value : null;
  } catch {
    file = null;
  }
  if (!file) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "ファイルが大きすぎます（10MBまで）" }, { status: 413 });
  }

  // X-Stream: true → SSE（新クライアント）、なし → JSON（旧map-native等）
  const useStream = req.headers.get("x-stream") === "true";

  if (useStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: ProgressEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        try {
          await runImport(file, userId, send);
        } catch (err) {
          console.error("Import error:", err);
          send({ type: "error", message: "Internal server error" });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // JSON fallback（旧クライアント向け）
  try {
    let result: { imported?: number; error?: string } = {};
    await runImport(file, userId, (event) => {
      if (event.type === "done") result = { imported: event.imported };
      if (event.type === "error") result = { error: event.message };
    });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 422 });
    return NextResponse.json({ imported: result.imported ?? 0 });
  } catch (err) {
    console.error("Import error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
