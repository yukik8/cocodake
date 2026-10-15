import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getVerifiedUserId, unauthorized } from "@/lib/auth";
import { badRequest, readJson, serverError } from "@/lib/http";
import { PLACE_COLUMNS, isUuid, toClientPlace } from "@/lib/places";
import type { Place } from "@/types";

// Supabase の PostgREST は1リクエスト最大1000件のため、ページに分けて全件取得する
const PAGE_SIZE = 1000;

export async function GET() {
  const userId = await getVerifiedUserId();
  if (!userId) return unauthorized();

  const supabase = createServerClient();
  const page = (from: number, withCount: boolean) =>
    supabase
      .from("places")
      .select(PLACE_COLUMNS, withCount ? { count: "exact" } : undefined)
      .eq("user_session", userId)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + PAGE_SIZE - 1);

  // The first page also returns the total, so the remaining pages load in parallel
  // instead of one after another.
  const first = await page(0, true);
  if (first.error) return serverError("places list", first.error);
  const total = first.count ?? first.data.length;
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, Math.ceil(total / PAGE_SIZE) - 1) }, (_, i) => page((i + 1) * PAGE_SIZE, false))
  );
  const failed = rest.find((r) => r.error);
  if (failed?.error) return serverError("places list", failed.error);

  const places = [first, ...rest].flatMap((r) => (r.data ?? []) as unknown as Place[]).map(toClientPlace);
  return NextResponse.json({ places });
}

export async function PATCH(req: NextRequest) {
  const userId = await getVerifiedUserId();
  if (!userId) return unauthorized();

  const body = await readJson(req);
  const id = body?.id;
  const note = body?.note;
  if (!isUuid(id)) return badRequest("id required");
  if (note != null && (typeof note !== "string" || note.length > 2000)) return badRequest("invalid note");

  const supabase = createServerClient();
  const { error } = await supabase
    .from("places")
    .update({ note: note || null })
    .eq("id", id)
    .eq("user_session", userId);

  if (error) return serverError("places update", error);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const userId = await getVerifiedUserId();
  if (!userId) return unauthorized();

  const body = await readJson(req);
  const id = body?.id;
  if (!isUuid(id)) return badRequest("id required");

  const supabase = createServerClient();
  const { error } = await supabase
    .from("places")
    .delete()
    .eq("id", id)
    .eq("user_session", userId);

  if (error) return serverError("places delete", error);
  return NextResponse.json({ ok: true });
}
