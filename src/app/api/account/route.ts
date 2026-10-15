import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getVerifiedUserId, unauthorized } from "@/lib/auth";

// Deletes the signed-in user's account and data. The user comes from the verified JWT —
// never from the request body (before, any UUID in the body deleted that account).
export async function DELETE() {
  const userId = await getVerifiedUserId();
  if (!userId) return unauthorized();

  const supabase = createServerClient();

  const { error: sharesError } = await supabase.from("shared_lists").delete().eq("user_session", userId);
  if (sharesError) {
    console.error("account delete: shares", sharesError);
    return NextResponse.json({ error: "共有リストの削除に失敗しました" }, { status: 500 });
  }

  const { error: placesError } = await supabase.from("places").delete().eq("user_session", userId);
  if (placesError) {
    console.error("account delete: places", placesError);
    return NextResponse.json({ error: "スポットの削除に失敗しました" }, { status: 500 });
  }

  const { error: authError } = await supabase.auth.admin.deleteUser(userId);
  if (authError) {
    console.error("account delete: auth user", authError);
    return NextResponse.json({ error: "アカウントの削除に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
