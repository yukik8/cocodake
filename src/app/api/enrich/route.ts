import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { enrichPlaceByCoords, enrichPlaceById } from "@/lib/placesApi";
import { extractPlaceIdFromUrl } from "@/lib/parseTakeout";

// Batch enrich unenriched places for a session
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { session, limit = 20 } = body as {
      session: string;
      limit?: number;
    };

    if (!session) {
      return NextResponse.json({ error: "session required" }, { status: 400 });
    }

    const supabase = createServerClient();

    // Fetch unenriched places
    const { data: places, error: fetchError } = await supabase
      .from("places")
      .select("id, lat, lng, url, name")
      .eq("user_session", session)
      .eq("enriched", false)
      .limit(limit);

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!places || places.length === 0) {
      return NextResponse.json({ enriched: 0 });
    }

    let enrichedCount = 0;

    for (const place of places) {
      try {
        let result = null;

        if (place.url) {
          const placeId = extractPlaceIdFromUrl(place.url);
          if (placeId) {
            result = await enrichPlaceById(placeId);
          }
        }

        if (!result) {
          result = await enrichPlaceByCoords(place.lat, place.lng, place.name);
        }

        if (result) {
          await supabase
            .from("places")
            .update({
              name: result.name || place.name,
              address: result.address,
              category: result.category,
              rating: result.rating,
              photo_url: result.photo_url,
              enriched: true,
            })
            .eq("id", place.id);

          enrichedCount++;
        } else {
          // Mark as enriched even if no result (avoid retrying forever)
          await supabase
            .from("places")
            .update({ enriched: true })
            .eq("id", place.id);
        }

        // Rate limiting: 10 req/s max for Places API
        await new Promise((r) => setTimeout(r, 120));
      } catch (err) {
        console.error(`Enrich failed for place ${place.id}:`, err);
      }
    }

    return NextResponse.json({ enriched: enrichedCount, total: places.length });
  } catch (err) {
    console.error("Enrich error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
