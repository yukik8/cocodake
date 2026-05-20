import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const session = req.nextUrl.searchParams.get("session");
  if (!session) {
    return NextResponse.json({ error: "session required" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Supabase の PostgREST は1リクエスト最大1000件のため、ページネーションで全件取得
  const PAGE_SIZE = 1000;
  const allPlaces = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("places")
      .select("*")
      .eq("user_session", session)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (data && data.length > 0) allPlaces.push(...data);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return NextResponse.json({ places: allPlaces });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, session, note } = body as { id: string; session: string; note: string | null };

  if (!id || !session) {
    return NextResponse.json({ error: "id and session required" }, { status: 400 });
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from("places")
    .update({ note: note ?? null })
    .eq("id", id)
    .eq("user_session", session);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { id, session } = body as { id: string; session: string };

  if (!id || !session) {
    return NextResponse.json({ error: "id and session required" }, { status: 400 });
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from("places")
    .delete()
    .eq("id", id)
    .eq("user_session", session);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
