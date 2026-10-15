import { NextRequest, NextResponse } from "next/server";
import { getSharedList } from "@/lib/sharedList";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await getSharedList(id);

  if (result.status === "not_found") {
    return NextResponse.json({ error: "Share not found" }, { status: 404 });
  }
  if (result.status === "expired") {
    return NextResponse.json({ error: "This share link has expired" }, { status: 410 });
  }
  return NextResponse.json({ share: result.share });
}
