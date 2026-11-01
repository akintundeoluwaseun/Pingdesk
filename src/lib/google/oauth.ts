import "server-only";
import { google } from "googleapis";
import { googleEnv } from "@/lib/env";

/** Read-only Gmail access. No send, modify or delete permissions are requested. */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function googleOAuthClient() {
  const env = googleEnv();
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

/**
 * Revokes a Google token (and with it the user's grant to PingDesk).
 * Returns false if Google could not be reached or rejected the request; a
 * 400 "invalid_token" means it was already revoked, which counts as success.
 */
export async function revokeGoogleToken(token: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    if (res.ok) return true;
    if (res.status === 400) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return body.error === "invalid_token";
    }
    return false;
  } catch {
    return false;
  }
}
