import { createClient } from "@supabase/supabase-js";
import { createServerClient as createSSRClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

// Returns the id of the signed-in user, verified from the JWT — never from the request body.
// Native app and share extension: `Authorization: Bearer <access_token>`.
// Web app: the Supabase session cookies (same-origin requests send them automatically).
export async function getVerifiedUserId(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const authorization = (await headers()).get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer) {
    const supabase = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await supabase.auth.getClaims(bearer);
    return error ? null : (data?.claims.sub ?? null);
  }

  const cookieStore = await cookies();
  const supabase = createSSRClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // a refreshed session is written back so the browser keeps it
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });
  const { data, error } = await supabase.auth.getClaims();
  return error ? null : (data?.claims.sub ?? null);
}

export function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
