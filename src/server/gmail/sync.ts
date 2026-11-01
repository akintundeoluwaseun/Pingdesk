import { evaluateEmail } from "@/lib/email/classify";
import { verifiedSenderDomains } from "@/lib/email/fiverr-rules";
import { fingerprint } from "@/lib/notifications/fingerprint";
import { GmailError, type GmailPort, type NotificationStore, type SyncInbox, type SyncResult } from "./types";

export type SyncOptions = {
  now?: Date;
  /** First connection: look back this far. */
  bootstrapDays?: number;
  /** Run a reconciliation search at most this often. */
  reconcileEveryHours?: number;
  /** Reconciliation search window. */
  reconcileWindowDays?: number;
  /** Hard cap on messages fetched per run (Gmail quota + function time limits). */
  maxMessages?: number;
  domains?: string[];
};

const SKIP_LABELS = new Set(["SPAM", "TRASH", "DRAFT", "SENT"]);

/** Gmail search restricted to verified senders keeps reconciliation cheap. */
export function senderQuery(domains: string[], newerThanDays: number) {
  const from = domains.map((d) => `from:${d}`).join(" OR ");
  return `(${from}) newer_than:${Math.max(1, Math.ceil(newerThanDays))}d -in:spam -in:trash`;
}

/**
 * Syncs one inbox.
 *
 *  - First run: remembers the mailbox's current historyId *before* searching,
 *    then searches recent mail from verified senders — so nothing that arrives
 *    in between is lost (duplicates are harmless; inserts are idempotent).
 *  - Later runs: walks Gmail history from the stored historyId, page by page.
 *  - If Gmail says the historyId is too old (404), falls back to a search and
 *    starts a fresh cursor.
 *  - Every few hours also runs a reconciliation search to catch anything a
 *    history walk could miss.
 *  - If the per-run cap is reached mid-history, the cursor is saved at the last
 *    fully processed history record so the next run continues from there.
 */
export async function syncInbox(
  inbox: SyncInbox,
  gmail: GmailPort,
  store: NotificationStore,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const domains = opts.domains ?? verifiedSenderDomains();
  const max = opts.maxMessages ?? 200;
  const reconcileEvery = (opts.reconcileEveryHours ?? 6) * 3600_000;

  const seen = new Set<string>();
  const result: SyncResult = { mode: "incremental", historyId: inbox.last_history_id ?? "", reconciled: false, examined: 0, created: 0, ignored: {}, truncated: false };

  const process = async (id: string, labels?: string[]) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (labels?.some((l) => SKIP_LABELS.has(l))) return;
    result.examined++;
    const msg = await gmail.getMessageHeaders(id);
    if (!msg || msg.labelIds.some((l) => SKIP_LABELS.has(l))) return;
    const verdict = evaluateEmail(msg.headers, { domains });
    if (!verdict.accepted) {
      result.ignored[verdict.reason] = (result.ignored[verdict.reason] ?? 0) + 1;
      return;
    }
    const received = msg.internalDate ? new Date(Number(msg.internalDate)) : now;
    const created = await store.insertNotification({
      user_id: inbox.user_id,
      inbox_id: inbox.id,
      gmail_message_id: msg.id,
      gmail_thread_id: msg.threadId,
      category: verdict.category,
      inbox_label: inbox.label,
      sender_domain: verdict.senderDomain,
      subject: verdict.subject || null,
      auth_evidence: verdict.evidence,
      received_at: received.toISOString(),
      fingerprint: fingerprint(inbox.id, msg.id),
    });
    if (created) result.created++;
  };

  const search = async (days: number) => {
    let pageToken: string | undefined;
    do {
      const page = await gmail.listMessages(senderQuery(domains, days), pageToken);
      for (const id of page.ids) {
        if (seen.size >= max) {
          result.truncated = true;
          return;
        }
        await process(id);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  };

  if (!inbox.last_history_id) {
    result.mode = "bootstrap";
    result.historyId = await gmail.getProfileHistoryId();
    await search(opts.bootstrapDays ?? 2);
    result.reconciled = true;
    return result;
  }

  try {
    let pageToken: string | undefined;
    let cursor = inbox.last_history_id;
    walk: do {
      const page = await gmail.listHistory(inbox.last_history_id, pageToken);
      for (const record of page.records) {
        for (const m of record.messages) {
          if (seen.size >= max && !seen.has(m.id)) {
            result.truncated = true;
            break walk;
          }
          await process(m.id, m.labelIds);
        }
        cursor = record.id;
      }
      pageToken = page.nextPageToken;
      if (!pageToken) cursor = page.historyId;
    } while (pageToken);
    result.historyId = cursor;
  } catch (err) {
    if (!(err instanceof GmailError) || err.kind !== "history_expired") throw err;
    // Cursor too old: take a fresh one first, then search to fill the gap.
    result.mode = "recovered";
    result.historyId = await gmail.getProfileHistoryId();
    await search(opts.reconcileWindowDays ?? 7);
    result.reconciled = true;
    return result;
  }

  const lastReconciled = inbox.last_reconciled_at ? new Date(inbox.last_reconciled_at).getTime() : 0;
  if (!result.truncated && now.getTime() - lastReconciled >= reconcileEvery) {
    await search(opts.reconcileWindowDays ?? 1);
    result.reconciled = !result.truncated;
  }
  return result;
}
