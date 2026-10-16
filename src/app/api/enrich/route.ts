import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getVerifiedUserId, unauthorized } from "@/lib/auth";
import { readJson, serverError } from "@/lib/http";
import { enrichPlaceByCoords, enrichPlaceById } from "@/lib/placesApi";
import { extractPlaceIdFromUrl } from "@/lib/parseTakeout";
import { mapWithConcurrency } from "@/lib/pool";
import { placePhotoUrl, refFromPhotoUrl } from "@/lib/photo";
import { saveRefs } from "@/lib/photoCache";

export const maxDuration = 120;

// Batch enrich the signed-in user's unenriched places, a few at a time
// (before: one place at a time with a fixed pause after each).
export async function POST(req: NextRequest) {
  const userId = await getVerifiedUserId();
  if (!userId) return unauthorized();

  try {
    const body = await readJson(req);
    const requested = typeof body?.limit === "number" ? Math.floor(body.limit) : 20;
    const limit = Math.min(Math.max(requested, 1), 50);

    const supabase = createServerClient();

    // Fetch unenriched places
    const { data: places, error: fetchError } = await supabase
      .from("places")
      .select("id, lat, lng, url, name, place_id")
      .eq("user_session", userId)
      .eq("enriched", false)
      .limit(limit);

    if (fetchError) return serverError("enrich fetch", fetchError);
    if (!places || places.length === 0) {
      return NextResponse.json({ enriched: 0 });
    }

    const outcomes = await mapWithConcurrency(places, 5, async (place) => {
      try {
        const placeId = place.place_id || (place.url ? extractPlaceIdFromUrl(place.url) : null);
        const searchableName = place.name && place.name !== "名称不明" ? place.name : null;
        const result =
          (placeId ? await enrichPlaceById(placeId) : null) ??
          (await enrichPlaceByCoords(place.lat, place.lng, searchableName));

        // Marked as enriched even without a result, so it isn't retried forever
        const update = result
          ? {
              name: result.name || place.name,
              address: result.address,
              category: result.category,
              rating: result.rating,
              // shown by place ID; the fresh reference goes to place_photos below
              photo_url: result.photo_url && result.place_id ? placePhotoUrl(result.place_id) : result.photo_url,
              enriched: true,
            }
          : { enriched: true };
        const { error } = await supabase.from("places").update(update).eq("id", place.id).eq("user_session", userId);
        const freshRef = refFromPhotoUrl(result?.photo_url);
        if (!error && result?.place_id && freshRef) {
          await saveRefs(supabase, [{ place_id: result.place_id, photo_ref: freshRef }]);
        }
        return !error && !!result;
      } catch (err) {
        console.error(`Enrich failed for place ${place.id}:`, err);
        return false;
      }
    });

    return NextResponse.json({ enriched: outcomes.filter(Boolean).length, total: places.length });
  } catch (err) {
    return serverError("Enrich error:", err);
  }
}
