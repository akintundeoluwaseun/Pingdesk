import type { Header } from "@/lib/email/auth-results";

/** Minimal Gmail operations the sync engine needs (implemented by the googleapis adapter). */
export interface GmailPort {
  getProfileHistoryId(): Promise<string>;
  /** history.list with historyTypes=messageAdded. Throws GmailError(kind "history_expired") on 404. */
  listHistory(startHistoryId: string, pageToken?: string): Promise<{
    records: { id: string; messages: { id: string; labelIds: string[] }[] }[];
    historyId: string;
    nextPageToken?: string;
  }>;
  listMessages(query: string, pageToken?: string): Promise<{ ids: string[]; nextPageToken?: string }>;
  /** Returns null if the message no longer exists. */
  getMessageHeaders(id: string): Promise<{ id: string; threadId: string | null; internalDate: string | null; labelIds: string[]; headers: Header[] } | null>;
}

export type GmailErrorKind = "auth_revoked" | "insufficient_scope" | "history_expired" | "rate_limited" | "unavailable" | "unknown";

export class GmailError extends Error {
  constructor(public readonly kind: GmailErrorKind, message?: string) {
    super(message ?? kind);
    this.name = "GmailError";
  }
  get needsReauth() {
    return this.kind === "auth_revoked" || this.kind === "insufficient_scope";
  }
}

export type SyncInbox = {
  id: string;
  user_id: string;
  label: string;
  last_history_id: string | null;
  last_reconciled_at: string | null;
};

export type NewNotification = {
  user_id: string;
  inbox_id: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  category: string;
  inbox_label: string;
  sender_domain: string;
  subject: string | null;
  auth_evidence: Record<string, unknown>;
  received_at: string;
  fingerprint: string;
};

export interface NotificationStore {
  /** Inserts unless (inbox, message) already exists. Returns true if a new row was written. */
  insertNotification(row: NewNotification): Promise<boolean>;
}

export type SyncResult = {
  mode: "bootstrap" | "incremental" | "recovered";
  historyId: string;
  reconciled: boolean;
  examined: number;
  created: number;
  ignored: Record<string, number>;
  truncated: boolean;
};
