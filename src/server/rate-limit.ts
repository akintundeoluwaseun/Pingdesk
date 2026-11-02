import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

export const LIMITS = {
  gmailConnect: { limit: 10, windowSeconds: 3600 },
  testAlert: { limit: 3, windowSeconds: 86_400 },
  rename: { limit: 30, windowSeconds: 3600 },
  preferences: { limit: 60, windowSeconds: 3600 },
} as const;

/**
 * Returns true if allowed. Fails open (allows) if the limiter itself is
 * unavailable, so a database hiccup never locks users out; the event is logged.
 */
export async function allow(key: string, rule: { limit: number; windowSeconds: number }): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc("rate_limit_hit", {
    p_key: key,
    p_limit: rule.limit,
    p_window_seconds: rule.windowSeconds,
  });
  if (error) {
    log.warn("rate_limit.unavailable", { error_code: error.code });
    return true;
  }
  return data === true;
}
