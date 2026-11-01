import { NextResponse, type NextRequest } from "next/server";
import { google } from "googleapis";
import { googleOAuthClient, GMAIL_SCOPE, revokeGoogleToken } from "@/lib/google/oauth";
import { googleEnv, isConfigured } from "@/lib/env";
import { getUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/security/crypto";
import { STATE_COOKIE, verifyOAuthState } from "@/lib/security/oauth-state";
import { log } from "@/lib/log";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const done = (query: string) => {
    const res = NextResponse.redirect(new URL(`/dashboard/inboxes?${query}`, req.url));
    res.cookies.set(STATE_COOKIE, "", { path: "/api/google", maxAge: 0 });
    return res;
  };

  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/dashboard/inboxes", req.url));
  if (!isConfigured("google")) return done("error=google_not_configured");

  const params = req.nextUrl.searchParams;
  const valid = await verifyOAuthState({
    cookie: req.cookies.get(STATE_COOKIE)?.value,
    returnedState: params.get("state"),
    userId: user.id,
    secret: googleEnv().OAUTH_STATE_SECRET,
  });
  if (!valid) return done("error=state_mismatch");
  if (params.get("error")) return done(params.get("error") === "access_denied" ? "error=access_denied" : "error=google_error");

  const code = params.get("code");
  if (!code) return done("error=google_error");

  let refreshToken: string | null | undefined;
  try {
    const oauth = googleOAuthClient();
    const { tokens } = await oauth.getToken(code);
    refreshToken = tokens.refresh_token;
    const scopes = (tokens.scope ?? "").split(" ");
    if (!scopes.includes(GMAIL_SCOPE)) {
      // User unticked the Gmail permission on the consent screen.
      if (refreshToken) await revokeGoogleToken(refreshToken);
      return done("error=scope_missing");
    }
    if (!refreshToken) return done("error=no_refresh_token");

    oauth.setCredentials(tokens);
    const profile = await google.gmail({ version: "v1", auth: oauth }).users.getProfile({ userId: "me" });
    const email = profile.data.emailAddress;
    if (!email) {
      await revokeGoogleToken(refreshToken);
      return done("error=google_error");
    }

    const { ciphertext, keyVersion } = encryptSecret(refreshToken);
    const { error } = await supabaseAdmin().rpc("link_gmail_inbox", {
      p_user_id: user.id,
      p_email: email,
      p_encrypted_refresh_token: ciphertext,
      p_key_version: keyVersion,
      p_scopes: GMAIL_SCOPE,
    });
    if (error) throw new Error(`link_gmail_inbox failed: ${error.code ?? "unknown"}`);

    log.info("gmail.connected", { user_id: user.id });
    await recordAudit(user.id, "inbox.connected", { email });
    return done("connected=1");
  } catch (err) {
    log.error("gmail.connect_failed", { user_id: user.id, error: err });
    if (refreshToken) await revokeGoogleToken(refreshToken);
    return done("error=connect_failed");
  }
}
