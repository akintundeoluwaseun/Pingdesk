import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
function getClient() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase service credentials are not configured.");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

/** Service-role client (bypasses RLS). Server-only. Created on first use so builds work without secrets. */
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    const c = getClient();
    const v = Reflect.get(c, prop);
    return typeof v === "function" ? v.bind(c) : v;
  },
});
