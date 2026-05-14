import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { parseTakeoutJson, parseTakeoutCsv } from "@/lib/parseTakeout";
import { enrichPlaceByName } from "@/lib/placesApi";
import { Place } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const sessionId = formData.get("session") as string | null;

    if (!file || !sessionId) {
      return NextResponse.json(
        { error: "file and session are required" },
        { status: 400 }
      );
    }

    const text = await file.text();
    let parsed: Partial<Place>[] = [];

    const fileName = file.name.toLowerCase();

    if (fileName.endsWith(".json")) {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON file" },
          { status: 400 }
        );
      }
      parsed = parseTakeoutJson(json);
    } else if (fileName.endsWith(".csv")) {
      parsed = parseTakeoutCsv(text);
    } else {
      // Try JSON first, then CSV
      try {
        const json = JSON.parse(text);
        parsed = parseTakeoutJson(json);
      } catch {
        parsed = parseTakeoutCsv(text);
      }
    }

    if (parsed.length === 0) {
      return NextResponse.json(
        { error: "No valid places found in file" },
        { status: 422 }
      );
    }

    // 座標なし行をジオコード（CSV Takeout形式）
    const geocoded: typeof parsed = [];
    for (const p of parsed) {
      if (p.lat != null && p.lng != null) {
        geocoded.push(p);
      } else if (p.name && p.name !== "名称不明") {
        const result = await enrichPlaceByName(p.name);
        if (result?.lat != null && result?.lng != null) {
          geocoded.push({
            ...p,
            place_id: result.place_id || null,
            lat: result.lat,
            lng: result.lng,
            address: p.address || result.address || null,
            category: p.category || result.category || null,
            rating: p.rating || result.rating || null,
            photo_url: p.photo_url || result.photo_url || null,
            enriched: true,
          });
        }
        // 座標が取れなかった行はスキップ（lat NOT NULL制約）
        await new Promise((r) => setTimeout(r, 120)); // Places API rate limit
      }
    }

    const supabase = createServerClient();

    // 既存の place_id を取得して重複を除外
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

    // Insert in batches of 500 to avoid request size limits
    const batchSize = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase.from("places").insert(batch);
      if (error) {
        console.error("Insert error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      inserted += batch.length;
    }

    return NextResponse.json({ imported: inserted });
  } catch (err) {
    console.error("Import error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
