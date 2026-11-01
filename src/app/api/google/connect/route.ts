import { NextResponse, type NextRequest } from "next/server";
import { googleOAuthClient, GMAIL_SCOPE } from "@/lib/google/oauth";
import { googleEnv, isConfigured } from "@/lib/env";
import { getUser } from "@/lib/supabase/server";
import { createOAuthState, STATE_COOKIE } from "@/lib/security/oauth-state";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const back = (error: string) => NextResponse.redirect(new URL(`/dashboard/inboxes?error=${error}`, req.url));
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/dashboard/inboxes", req.url));
  if (!isConfigured("google")) return back("google_not_configured");

  const { nonce, cookie } = await createOAuthState(user.id, googleEnv().OAUTH_STATE_SECRET);
  const url = googleOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: false,
    scope: [GMAIL_SCOPE],
    state: nonce,
  });

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google",
    maxAge: 600,
  });
  return res;
}
