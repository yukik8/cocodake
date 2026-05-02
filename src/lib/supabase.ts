import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";

// Browser client (singleton) — reads session from cookies set by callback route
let _browserClient: ReturnType<typeof createBrowserClient> | null = null;
export function getSupabaseClient() {
  if (!_browserClient) {
    _browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _browserClient;
}

// Server-side client with service role key — used in API routes
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase environment variables are not configured. " +
        "Copy .env.local.example to .env.local and fill in your credentials."
    );
  }
  return createClient(url, key);
}
