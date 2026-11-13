import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { google } from "googleapis";
import { googleOAuthClient, GMAIL_SCOPE } from "@/lib/google/oauth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/security/crypto";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const done = (key: "error" | "connected", message: string) => {
    const res = NextResponse.redirect(new URL(`/dashboard?${key}=${encodeURIComponent(message)}`, req.url));
    res.cookies.delete("pd_oauth_state");
    return res;
  };
  const p = req.nextUrl.searchParams;
  if (p.get("error")) return done("error", p.get("error") === "access_denied" ? "Gmail wasn't connected because access was declined." : "Google returned an error. Try again.");
  const code = p.get("code"), state = p.get("state"), signed = req.cookies.get("pd_oauth_state")?.value, secret = process.env.OAUTH_STATE_SECRET;
  if (!code || !state || !signed || !secret) return done("error", "The Google sign-in expired. Try connecting again.");

  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/dashboard", req.url));
  try {
    const { payload } = await jwtVerify(signed, new TextEncoder().encode(secret));
    if (payload.state !== state || payload.uid !== user.id) return done("error", "The Google sign-in didn't match this session. Try again.");
  } catch {
    return done("error", "The Google sign-in expired. Try connecting again.");
  }

  try {
    const oauth = googleOAuthClient();
    const { tokens } = await oauth.getToken(code);
    if (!tokens.scope?.split(" ").includes(GMAIL_SCOPE)) return done("error", "PingDesk needs permission to read Gmail notifications. Tick the Gmail box on Google's screen.");
    if (!tokens.refresh_token) return done("error", "Google didn't return long-term access. Remove PingDesk at myaccount.google.com/permissions and connect again.");
    oauth.setCredentials(tokens);
    const gmail = google.gmail({ version: "v1", auth: oauth });
    const profile = await gmail.users.getProfile({ userId: "me" });
    const email = profile.data.emailAddress;
    if (!email) return done("error", "Couldn't read the Gmail address.");
    const address = email.toLowerCase();
    const { data: inbox, error } = await supabaseAdmin.from("connected_inboxes").upsert({
      user_id: user.id, provider: "gmail", email_address: address, label: address.slice(0, 60),
      status: "active", last_history_id: null, last_error_code: null, last_error_at: null,
      consecutive_failures: 0, disconnected_at: null, connected_at: new Date().toISOString(),
    }, { onConflict: "user_id,provider,email_address" }).select("id").single();
    if (error || !inbox) throw error ?? new Error("inbox upsert failed");
    // The refresh token lives in its own table that browsers can never read.
    const { error: credError } = await supabaseAdmin.from("inbox_credentials").upsert({
      inbox_id: inbox.id, user_id: user.id, encrypted_refresh_token: encryptSecret(tokens.refresh_token),
      key_version: 1, granted_scopes: tokens.scope ?? GMAIL_SCOPE,
    }, { onConflict: "inbox_id" });
    if (credError) throw credError;
    return done("connected", email);
  } catch (e) {
    console.error("google callback", e);
    return done("error", "Connecting Gmail failed. Try again.");
  }
}
