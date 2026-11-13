import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { googleOAuthClient, GMAIL_SCOPE } from "@/lib/google/oauth";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/dashboard", req.url));
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret) return NextResponse.redirect(new URL("/dashboard?error=" + encodeURIComponent("Google sign-in isn't set up on the server yet (OAUTH_STATE_SECRET)."), req.url));

  let url: string;
  const state = crypto.randomUUID();
  try {
    url = googleOAuthClient().generateAuthUrl({ access_type: "offline", prompt: "consent", include_granted_scopes: true, scope: [GMAIL_SCOPE], state });
  } catch (e) {
    return NextResponse.redirect(new URL("/dashboard?error=" + encodeURIComponent(e instanceof Error ? e.message : "Google OAuth is not configured."), req.url));
  }
  const signed = await new SignJWT({ state, uid: user.id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(secret));
  const response = NextResponse.redirect(url);
  const opts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 600 };
  response.cookies.set("pd_oauth_state", signed, opts);
  return response;
}
