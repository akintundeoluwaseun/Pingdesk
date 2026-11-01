import "server-only";
import { google, type gmail_v1 } from "googleapis";
import { googleOAuthClient } from "@/lib/google/oauth";
import { GmailError, type GmailErrorKind, type GmailPort } from "./types";

const METADATA_HEADERS = ["From", "Subject", "Date", "Authentication-Results", "Message-ID"];

/** Maps googleapis/gaxios errors to the small set of cases the sync engine handles. */
export function classifyGoogleError(err: unknown): GmailError {
  const e = err as { code?: number | string; status?: number; response?: { status?: number; data?: { error?: string | { status?: string; errors?: { reason?: string }[] } } } };
  const status = Number(e?.response?.status ?? e?.status ?? e?.code) || 0;
  const data = e?.response?.data?.error;
  const oauthError = typeof data === "string" ? data : undefined;
  const reason = typeof data === "object" ? data?.errors?.[0]?.reason : undefined;

  let kind: GmailErrorKind = "unknown";
  if (oauthError === "invalid_grant" || oauthError === "unauthorized_client" || status === 401) kind = "auth_revoked";
  else if (status === 403 && (reason === "insufficientPermissions" || reason === "forbidden")) kind = "insufficient_scope";
  else if (status === 403 && /rate|quota/i.test(reason ?? "")) kind = "rate_limited";
  else if (status === 429) kind = "rate_limited";
  else if (status === 404) kind = "history_expired";
  else if (status >= 500 || ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(String(e?.code))) kind = "unavailable";
  return new GmailError(kind, `gmail ${kind}${status ? ` (${status})` : ""}`);
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw classifyGoogleError(err);
  }
}

export function googleGmailPort(refreshToken: string): GmailPort {
  const auth = googleOAuthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  const gmail: gmail_v1.Gmail = google.gmail({ version: "v1", auth, timeout: 15_000, retry: true });

  return {
    async getProfileHistoryId() {
      const res = await call(() => gmail.users.getProfile({ userId: "me" }));
      if (!res.data.historyId) throw new GmailError("unknown", "profile has no historyId");
      return res.data.historyId;
    },
    async listHistory(startHistoryId, pageToken) {
      const res = await call(() =>
        gmail.users.history.list({ userId: "me", startHistoryId, historyTypes: ["messageAdded"], maxResults: 100, pageToken }),
      );
      return {
        historyId: res.data.historyId ?? startHistoryId,
        nextPageToken: res.data.nextPageToken ?? undefined,
        records: (res.data.history ?? []).map((h) => ({
          id: h.id ?? startHistoryId,
          messages: (h.messagesAdded ?? [])
            .map((a) => a.message)
            .filter((m): m is gmail_v1.Schema$Message => !!m?.id)
            .map((m) => ({ id: m.id!, labelIds: m.labelIds ?? [] })),
        })),
      };
    },
    async listMessages(query, pageToken) {
      const res = await call(() => gmail.users.messages.list({ userId: "me", q: query, maxResults: 100, pageToken }));
      return { ids: (res.data.messages ?? []).map((m) => m.id!).filter(Boolean), nextPageToken: res.data.nextPageToken ?? undefined };
    },
    async getMessageHeaders(id) {
      try {
        const res = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: METADATA_HEADERS });
        return {
          id,
          threadId: res.data.threadId ?? null,
          internalDate: res.data.internalDate ?? null,
          labelIds: res.data.labelIds ?? [],
          headers: res.data.payload?.headers ?? [],
        };
      } catch (err) {
        const mapped = classifyGoogleError(err);
        if (mapped.kind === "history_expired") return null; // 404 here = message deleted
        throw mapped;
      }
    },
  };
}
