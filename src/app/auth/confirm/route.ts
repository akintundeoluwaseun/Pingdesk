import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-redirect";

/**
 * Handles Supabase email links (sign-up confirmation, password recovery).
 * Supports both the token_hash template (recommended, works across devices)
 * and the default PKCE ?code= redirect.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const next = safeNext(p.get("next"));
  const supabase = await supabaseServer();

  const tokenHash = p.get("token_hash");
  const type = p.get("type") as EmailOtpType | null;
  const code = p.get("code");

  let ok = false;
  if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  else if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;

  if (ok) return NextResponse.redirect(new URL(next, req.url));
  return NextResponse.redirect(new URL("/login?error=link_expired", req.url));
}
