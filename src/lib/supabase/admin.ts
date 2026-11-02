import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { coreEnv } from "@/lib/env";

let client: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS — use only in server code, and always
 * scope queries by a user id that was obtained from a verified session.
 */
export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    const env = coreEnv();
    client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
