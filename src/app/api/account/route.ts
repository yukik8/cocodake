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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const authRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${session}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
  });
  if (!authRes.ok) {
    const body = await authRes.json().catch(() => ({}));
    return NextResponse.json({ error: body.message ?? "auth deletion failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
