import { NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { parseTakeoutJson, parseTakeoutCsv } from "@/lib/parseTakeout";
import { enrichPlaceByName } from "@/lib/placesApi";
import { Place } from "@/types";

export const maxDuration = 60;

type ProgressEvent =
  | { type: "progress"; phase: "geocoding"; current: number; total: number }
  | { type: "progress"; phase: "parsing" | "saving" }
  | { type: "done"; imported: number }
  | { type: "error"; message: string };

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ProgressEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        const sessionId = formData.get("session") as string | null;

        if (!file || !sessionId) {
          send({ type: "error", message: "file and session are required" });
          controller.close();
          return;
        }

        send({ type: "progress", phase: "parsing" });

        const text = await file.text();
        let parsed: Partial<Place>[] = [];
        const fileName = file.name.toLowerCase();

        if (fileName.endsWith(".json")) {
          try {
            parsed = parseTakeoutJson(JSON.parse(text));
          } catch {
            send({ type: "error", message: "Invalid JSON file" });
            controller.close();
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
          send({ type: "error", message: "No valid places found in file" });
          controller.close();
          return;
        }

        const withCoords = parsed.filter((p) => p.lat != null && p.lng != null);
        const withoutCoords = parsed.filter((p) => p.lat == null || p.lng == null);
        const geocoded: typeof parsed = [...withCoords];

        // 5件ずつ並列ジオコード（バッチ間のみ120ms待機）
        const CONCURRENCY = 5;
        let geocodeDone = 0;
        for (let i = 0; i < withoutCoords.length; i += CONCURRENCY) {
          const batch = withoutCoords.slice(i, i + CONCURRENCY);
          const results = await Promise.all(
            batch.map(async (p) => {
              if (!p.name || p.name === "名称不明") return null;
              const result = await enrichPlaceByName(p.name);
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
          send({ type: "progress", phase: "geocoding", current: geocodeDone, total: withoutCoords.length });
          if (i + CONCURRENCY < withoutCoords.length) {
            await new Promise((r) => setTimeout(r, 120));
          }
        }

        send({ type: "progress", phase: "saving" });

        const supabase = createServerClient();

        const { data: existingPlaces } = await supabase
          .from("places")
          .select("place_id, url")
          .eq("user_session", sessionId);
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
            send({ type: "error", message: error.message });
            controller.close();
            return;
          }
          inserted += batch.length;
        }

        send({ type: "done", imported: inserted });
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
