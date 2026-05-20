import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { parseTakeoutJson, parseTakeoutCsv } from "@/lib/parseTakeout";
import { enrichPlaceByName, enrichPlaceById } from "@/lib/placesApi";
import { extractPlaceIdFromUrl } from "@/lib/parseTakeout";
import { Place } from "@/types";

export const maxDuration = 300;

type ProgressEvent =
  | { type: "progress"; phase: "geocoding"; current: number; total: number }
  | { type: "progress"; phase: "parsing" | "saving" }
  | { type: "done"; imported: number }
  | { type: "error"; message: string };

async function runImport(
  file: File,
  sessionId: string,
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

  const withCoords = parsed.filter((p) => p.lat != null && p.lng != null);
  const withoutCoords = parsed.filter((p) => p.lat == null || p.lng == null);
  const geocoded: typeof parsed = [...withCoords];

  const CONCURRENCY = 5;
  let geocodeDone = 0;
  for (let i = 0; i < withoutCoords.length; i += CONCURRENCY) {
    const batch = withoutCoords.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (p) => {
        if (!p.name || p.name === "名称不明") return null;
        // URL に place_id があれば Details 1回、なければ Find Place + Details の2回
        const urlPlaceId = p.url ? extractPlaceIdFromUrl(p.url) : null;
        const result = urlPlaceId
          ? await enrichPlaceById(urlPlaceId)
          : await enrichPlaceByName(p.name);
        if (result?.lat != null && result?.lng != null) {
          return {
            ...p,
            place_id: result.place_id || null,
            lat: result.lat,
            lng: result.lng,
            address: p.address || result.address || null,
            category: p.category || result.category || null,
            rating: p.rating || result.rating || null,
            photo_url: p.photo_url || result.photo_url || null,
            enriched: true,
          };
        }
        return null;
      })
    );
    results.forEach((r) => { if (r) geocoded.push(r); });
    geocodeDone += batch.length;
    onProgress({ type: "progress", phase: "geocoding", current: geocodeDone, total: withoutCoords.length });
    if (i + CONCURRENCY < withoutCoords.length) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  onProgress({ type: "progress", phase: "saving" });

  const supabase = createServerClient();

  const { data: existingPlaces } = await supabase
    .from("places")
    .select("place_id, url")
    .eq("user_session", sessionId)
    .limit(100000);
  const existingPlaceIds = new Set((existingPlaces ?? []).map((p) => p.place_id).filter(Boolean));
  const existingUrls = new Set((existingPlaces ?? []).map((p) => p.url).filter(Boolean));

  const rows = geocoded
    .filter((p) => {
      if (p.place_id && existingPlaceIds.has(p.place_id)) return false;
      const url = p.url || `https://www.google.com/maps?q=${p.lat!},${p.lng!}`;
      if (!p.place_id && existingUrls.has(url)) return false;
      return true;
    })
    .map((p) => ({
      user_session: sessionId,
      place_id: p.place_id || null,
      name: p.name || "名称不明",
      url: p.place_id
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name || "名称不明")}&query_place_id=${p.place_id}`
        : p.url || `https://www.google.com/maps?q=${p.lat!},${p.lng!}`,
      lat: p.lat!,
      lng: p.lng!,
      address: p.address || null,
      category: p.category || null,
      rating: p.rating || null,
      photo_url: p.photo_url || null,
      note: p.note || null,
      enriched: p.enriched ?? false,
    }));

  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from("places").insert(batch);
    if (error) {
      onProgress({ type: "error", message: error.message });
      return;
    }
    inserted += batch.length;
  }

  onProgress({ type: "done", imported: inserted });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const sessionId = formData.get("session") as string | null;

  if (!file || !sessionId) {
    return NextResponse.json({ error: "file and session are required" }, { status: 400 });
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
          await runImport(file, sessionId, send);
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
    await runImport(file, sessionId, (event) => {
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
