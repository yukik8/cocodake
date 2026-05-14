import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function DELETE(req: NextRequest) {
  const { session } = await req.json() as { session?: string };
  if (!session) {
    return NextResponse.json({ error: "session is required" }, { status: 400 });
  }

  const supabase = createServerClient();

  const { error: placesError } = await supabase
    .from("places")
    .delete()
    .eq("user_session", session);

  if (placesError) {
    return NextResponse.json({ error: placesError.message }, { status: 500 });
  }

  const { error: authError } = await supabase.auth.admin.deleteUser(session);
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
