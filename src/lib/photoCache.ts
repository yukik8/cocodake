import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidPhotoRef } from "./photo";

// The current Google photo reference of each Google place (table place_photos), shared by
// every user who saved the place. A reference stops working after a while; /api/photo
// then fetches the current one and overwrites it here. photo_ref = null records that the
// place has no photo.
//
// Every function tolerates a missing table (before the migration runs): the cache then
// behaves as empty and photos are looked up at Google each time, as before.

export const NO_PHOTO_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

export async function readCachedRef(
  sb: SupabaseClient,
  placeId: string
): Promise<{ ref: string | null; fetchedAt: number } | null> {
  const { data, error } = await sb
    .from("place_photos")
    .select("photo_ref, fetched_at")
    .eq("place_id", placeId)
    .maybeSingle();
  if (error || !data) return null;
  return { ref: isValidPhotoRef(data.photo_ref) ? data.photo_ref : null, fetchedAt: Date.parse(data.fetched_at) || 0 };
}

export async function saveRefs(sb: SupabaseClient, entries: { place_id: string; photo_ref: string | null }[]): Promise<void> {
  if (entries.length === 0) return;
  const fetched_at = new Date().toISOString();
  const { error } = await sb
    .from("place_photos")
    .upsert(entries.map((e) => ({ ...e, fetched_at })), { onConflict: "place_id" });
  if (error) console.error("place_photos upsert", error.code);
}

// /api/photo is public: Google is only asked about places someone actually saved
export async function isSavedPlace(sb: SupabaseClient, placeId: string): Promise<boolean> {
  const { data, error } = await sb.from("places").select("id").eq("place_id", placeId).limit(1).maybeSingle();
  if (error) return true; // a database hiccup should not hide photos
  return !!data;
}

// undefined = Google could not answer; null = the place has no photo (or no longer exists)
export async function fetchCurrentRef(placeId: string, key: string): Promise<string | null | undefined> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "photos");
  url.searchParams.set("key", key);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return undefined;
    const data = await res.json();
    if (data.status === "OK") {
      const ref = data.result?.photos?.[0]?.photo_reference;
      return isValidPhotoRef(ref) ? ref : null;
    }
    return data.status === "NOT_FOUND" || data.status === "ZERO_RESULTS" || data.status === "INVALID_REQUEST"
      ? null
      : undefined;
  } catch {
    return undefined;
  }
}
