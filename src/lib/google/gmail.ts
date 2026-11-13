import { google, type gmail_v1 } from "googleapis";
import { googleOAuthClient } from "./oauth";

export function gmailClient(refreshToken: string) {
  const auth = googleOAuthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth });
}

const MAX_IDS = 200;

/** Message ids from a time-window search, following pages. Used for first sync and when history has expired. */
export async function listMessageIdsSince(gmail: gmail_v1.Gmail, afterEpochSeconds: number) {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const r = await gmail.users.messages.list({ userId: "me", q: `after:${afterEpochSeconds}`, maxResults: 100, pageToken });
    for (const m of r.data.messages ?? []) if (m.id) ids.push(m.id);
    pageToken = r.data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < MAX_IDS);
  return ids;
}

/**
 * Message ids added since a stored historyId. Returns null when Gmail no longer
 * has that history (HTTP 404), so the caller can fall back to a time window.
 */
export async function listAddedMessageIdsSince(gmail: gmail_v1.Gmail, startHistoryId: string) {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  try {
    do {
      const r = await gmail.users.history.list({ userId: "me", startHistoryId, historyTypes: ["messageAdded"], maxResults: 100, pageToken });
      for (const h of r.data.history ?? []) for (const a of h.messagesAdded ?? []) if (a.message?.id) ids.add(a.message.id);
      pageToken = r.data.nextPageToken ?? undefined;
    } while (pageToken && ids.size < MAX_IDS);
  } catch (e) {
    if (statusOf(e) === 404) return null;
    throw e;
  }
  return [...ids];
}

export async function getMessageMetadata(gmail: gmail_v1.Gmail, messageId: string) {
  const r = await gmail.users.messages.get({ userId: "me", id: messageId, format: "metadata", metadataHeaders: ["From", "Subject", "Date", "Authentication-Results"] });
  const headers = r.data.payload?.headers ?? [];
  const read = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
  return {
    id: messageId,
    threadId: r.data.threadId ?? null,
    from: read("From"),
    subject: read("Subject"),
    authResults: read("Authentication-Results"),
    internalDate: r.data.internalDate ? new Date(Number(r.data.internalDate)).toISOString() : null,
    labelIds: r.data.labelIds ?? [],
  };
}

export function statusOf(e: unknown): number | undefined {
  const x = e as { code?: unknown; status?: unknown; response?: { status?: number } };
  const n = Number(x?.response?.status ?? x?.status ?? x?.code);
  return Number.isFinite(n) ? n : undefined;
}

/** Short machine-readable code for connected_inboxes.last_error_code. */
export function errorCode(e: unknown) {
  if (isInvalidGrant(e)) return "invalid_grant";
  const st = statusOf(e);
  if (st) return `http_${st}`;
  return ((e as { code?: string })?.code ?? "sync_failed").toString().slice(0, 64);
}

/** True when Google says the refresh token is revoked or expired. */
export function isInvalidGrant(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return /invalid_grant/i.test(msg);
}
