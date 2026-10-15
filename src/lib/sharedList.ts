import { cache } from "react";
import { createServerClient } from "./supabase";
import { isUuid, toSharedPlace } from "./places";
import { isExpired } from "./share";
import type { SharedList } from "@/types";

export type SharedListResult =
  | { status: "ok"; share: SharedList }
  | { status: "not_found" }
  | { status: "expired" };

// One read per request: the share page's generateMetadata and the page itself both call
// this, and React's cache() makes the second call free (before: two queries, and the
// metadata one pulled the whole snapshot just to count it).
export const getSharedList = cache(async (id: string): Promise<SharedListResult> => {
  if (!isUuid(id)) return { status: "not_found" };

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("shared_lists")
    .select("id, title, places_snapshot, expires_at, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return { status: "not_found" };
  if (isExpired(data.expires_at)) return { status: "expired" };

  const snapshot = Array.isArray(data.places_snapshot) ? data.places_snapshot : [];
  return {
    status: "ok",
    share: {
      id: data.id,
      title: data.title,
      expires_at: data.expires_at,
      created_at: data.created_at,
      // shares made before the fix still hold every column; strip them on the way out
      places_snapshot: snapshot.filter((p: unknown) => p && typeof p === "object").map(toSharedPlace),
    },
  };
});
