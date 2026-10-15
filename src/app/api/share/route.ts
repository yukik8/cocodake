import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getVerifiedUserId, unauthorized } from "@/lib/auth";
import { badRequest, readJson, serverError } from "@/lib/http";
import { SHARED_PLACE_COLUMNS, cleanText, isUuid, toSharedPlace } from "@/lib/places";
import { computeExpiresAt, parseExpiresInDays } from "@/lib/share";

const MAX_PLACES = 5000;
// IDs go into the query string of each lookup; 200 UUIDs keep it well under URL limits
// (one request with thousands of IDs failed for large shares)
const ID_CHUNK = 200;

export async function POST(req: NextRequest) {
  const userId = await getVerifiedUserId();
  if (!userId) return unauthorized();

  try {
    const body = await readJson(req);
    const placeIds = Array.isArray(body?.place_ids) ? [...new Set(body.place_ids.filter(isUuid))] : [];
    if (placeIds.length === 0) return badRequest("place_ids are required");
    if (placeIds.length > MAX_PLACES) return badRequest(`一度に共有できるのは${MAX_PLACES}件までです`);

    const days = parseExpiresInDays(body?.expires_in_days);
    if (days == null) return badRequest("invalid expires_in_days");

    const supabase = createServerClient();

    // Snapshot only the caller's own places, and only the fields a share link shows
    // (before: any place IDs, every column — including the owner's user ID).
    const chunks = [];
    for (let i = 0; i < placeIds.length; i += ID_CHUNK) chunks.push(placeIds.slice(i, i + ID_CHUNK));
    const results = await Promise.all(
      chunks.map((ids) =>
        supabase.from("places").select(SHARED_PLACE_COLUMNS).eq("user_session", userId).in("id", ids)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) return serverError("share fetch", failed.error);

    const order = new Map(placeIds.map((id, i) => [id, i]));
    const places = results
      .flatMap((r) => (r.data ?? []) as unknown as Record<string, unknown>[])
      .map(toSharedPlace)
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    if (places.length === 0) return badRequest("place_ids are required");

    const { data, error } = await supabase
      .from("shared_lists")
      .insert({
        title: cleanText(body?.title, 100),
        place_ids: places.map((p) => p.id),
        places_snapshot: places,
        expires_at: computeExpiresAt(days),
        user_session: userId,
      })
      .select("id, title, expires_at, created_at")
      .single();

    if (error) return serverError("share insert", error);
    return NextResponse.json({ share: data });
  } catch (err) {
    return serverError("Share error:", err);
  }
}
