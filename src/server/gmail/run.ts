import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/security/crypto";
import { log } from "@/lib/log";
import { googleGmailPort } from "./google-adapter";
import { syncInbox } from "./sync";
import { GmailError, type NotificationStore } from "./types";

type ClaimedInbox = {
  id: string;
  user_id: string;
  label: string;
  last_history_id: string | null;
  last_reconciled_at: string | null;
  encrypted_refresh_token: string;
};

export const supabaseNotificationStore = (): NotificationStore => ({
  async insertNotification(row) {
    const { data, error } = await supabaseAdmin()
      .from("notifications")
      .upsert(row, { onConflict: "inbox_id,gmail_message_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`notification insert failed: ${error.code}`);
    return (data?.length ?? 0) > 0;
  },
});

export type RunSummary = { inboxes: number; created: number; failed: number; reauth: number };

/**
 * Claims due inboxes (with a lease) and syncs them with limited concurrency,
 * stopping before the time budget runs out. Safe to call from overlapping
 * schedulers: leases guarantee one worker per inbox.
 */
export async function runGmailSync(opts: { limit?: number; concurrency?: number; budgetMs?: number } = {}): Promise<RunSummary> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 45_000;
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("claim_inboxes_for_sync", {
    p_limit: opts.limit ?? 20,
    p_lease_seconds: Math.ceil(budget / 1000) + 30,
    p_min_interval_seconds: 60,
  });
  if (error) throw new Error(`claim failed: ${error.code}`);
  const queue = [...((data ?? []) as ClaimedInbox[])];
  const summary: RunSummary = { inboxes: queue.length, created: 0, failed: 0, reauth: 0 };
  const store = supabaseNotificationStore();

  const finish = (id: string, historyId: string | null, reconciled: boolean, code: string | null, reauth = false) =>
    db.rpc("finish_inbox_sync", {
      p_inbox_id: id,
      p_history_id: historyId,
      p_reconciled: reconciled,
      p_error_code: code,
      p_needs_reauth: reauth,
    });

  const worker = async () => {
    while (queue.length) {
      const inbox = queue.shift()!;
      if (Date.now() - started > budget) {
        // Out of time: release the lease without recording a failure.
        await db.from("connected_inboxes").update({ sync_locked_until: null }).eq("id", inbox.id);
        continue;
      }
      try {
        const gmail = googleGmailPort(decryptSecret(inbox.encrypted_refresh_token));
        const res = await syncInbox(inbox, gmail, store);
        summary.created += res.created;
        await finish(inbox.id, res.historyId, res.reconciled, null);
        log.info("gmail.sync_ok", { inbox_id: inbox.id, mode: res.mode, examined: res.examined, created: res.created, ignored: res.ignored, truncated: res.truncated });
      } catch (err) {
        const ge = err instanceof GmailError ? err : null;
        if (ge?.needsReauth) summary.reauth++;
        else summary.failed++;
        await finish(inbox.id, null, false, ge?.kind ?? "internal_error", ge?.needsReauth ?? false);
        log[ge?.needsReauth ? "warn" : "error"]("gmail.sync_failed", { inbox_id: inbox.id, kind: ge?.kind ?? "internal_error", error: err });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, queue.length) }, worker));
  return summary;
}
