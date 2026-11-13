import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

/** Returns the signed-in user and a request-scoped client, or sends them to /login. */
export async function requireUser(next = "/dashboard") {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return { supabase, user };
}

/** Only allow same-site relative paths as post-login destinations. */
export function safeNext(value: unknown, fallback = "/dashboard") {
  const v = typeof value === "string" ? value : "";
  return v.startsWith("/") && !v.startsWith("//") ? v : fallback;
}
