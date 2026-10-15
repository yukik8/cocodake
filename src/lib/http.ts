import { NextResponse } from "next/server";

// A malformed body is a 400, not an unhandled exception (500).
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

// Database error messages describe the schema; log them and send a generic message.
export function serverError(context: string, err: unknown) {
  console.error(context, err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
