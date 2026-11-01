import { decide, failureOutcome, type ClaimedNotification } from "@/server/delivery/decide";
import { MetaError, type WhatsAppClient } from "@/lib/whatsapp/meta";
import { last4 } from "@/lib/whatsapp/phone";
import { syncInbox } from "@/server/gmail/sync";
import { GmailError, type GmailPort, type NotificationStore, type SyncInbox } from "@/server/gmail/types";
import { PermanentJobError, type Handler, type HandlerResult } from "./types";

// ---------------------------------------------------------------------------
// deliver_notification
// ---------------------------------------------------------------------------
export type DeliveryContext = ClaimedNotification & { status: string };

export type DeliveryDeps = {
  context(notificationId: string): Promise<DeliveryContext | null>;
  record(args: Record<string, unknown>): Promise<void>;
  whatsapp(): { client: WhatsAppClient; template: string; language: string } | null;
  log?: (event: string, fields: Record<string, unknown>) => void;
};

export function deliverNotificationHandler(deps: DeliveryDeps): Handler {
  return async (job): Promise<HandlerResult> => {
    const id = String(job.payload.notification_id ?? "");
    if (!id) throw new PermanentJobError("missing notification_id");
    const n = await deps.context(id);
    // Deleted (inbox removed) or already handled by an earlier/duplicate job: nothing to do.
    if (!n || !["received", "queued"].includes(n.status)) return { kind: "done" };

    const d = decide(n);
    if (d.action === "skip") {
      await deps.record({ p_notification_id: n.id, p_outcome: "skipped", p_skip_reason: d.reason });
      return { kind: "done" };
    }
    if (d.action === "defer") {
      await deps.record({ p_notification_id: n.id, p_outcome: "deferred", p_retry_at: d.until.toISOString() });
      return { kind: "retry", at: d.until, reason: "per-user hourly cap" };
    }

    const wa = deps.whatsapp();
    if (!wa) {
      // Operator hasn't configured WhatsApp yet: keep the alert queued, check again later.
      return { kind: "retry", at: new Date(Date.now() + 15 * 60_000), reason: "whatsapp not configured" };
    }

    const attempt = n.delivery_attempts + 1;
    try {
      const { messageId } = await wa.client.sendTemplate(d.to, wa.template, wa.language, d.components);
      await deps.record({
        p_notification_id: n.id,
        p_outcome: "submitted",
        p_provider_message_id: messageId,
        p_template_name: wa.template,
        p_recipient_last4: last4(d.to),
      });
      return { kind: "done" };
    } catch (err) {
      const me = err instanceof MetaError ? err : new MetaError(null, "Unexpected send error", true, false, 0);
      const f = failureOutcome(me, attempt);
      await deps.record({
        p_notification_id: n.id,
        p_outcome: f.outcome,
        p_error_code: me.code?.toString() ?? `http_${me.httpStatus}`,
        p_error_title: me.title,
        p_retry_at: f.retryAt?.toISOString() ?? null,
        p_template_name: wa.template,
        p_recipient_last4: last4(d.to),
      });
      deps.log?.("delivery.send_failed", { notification_id: n.id, error_code: me.code, outcome: f.outcome, operator: me.operator });
      // The notification records the permanent failure; the job itself is finished.
      return f.outcome === "retry" ? { kind: "retry", at: f.retryAt, reason: `meta ${me.code ?? me.httpStatus}` } : { kind: "done" };
    }
  };
}

// ---------------------------------------------------------------------------
// sync_inbox
// ---------------------------------------------------------------------------
export type SyncDeps = {
  loadInbox(inboxId: string): Promise<(SyncInbox & { status: string; refreshToken: string }) | null>;
  gmail(refreshToken: string): GmailPort;
  store: NotificationStore;
  finish(inboxId: string, historyId: string | null, reconciled: boolean, errorCode: string | null, needsReauth: boolean): Promise<void>;
  log?: (event: string, fields: Record<string, unknown>) => void;
};

/**
 * Sync jobs always finish: failures are recorded on the inbox (which drives
 * back-off and "Reconnect needed"), and the scheduler enqueues the next sync.
 */
export function syncInboxHandler(deps: SyncDeps): Handler {
  return async (job) => {
    const id = String(job.payload.inbox_id ?? "");
    if (!id) throw new PermanentJobError("missing inbox_id");
    const inbox = await deps.loadInbox(id);
    if (!inbox || !["active", "error"].includes(inbox.status)) return { kind: "done" };
    try {
      const res = await syncInbox(inbox, deps.gmail(inbox.refreshToken), deps.store);
      await deps.finish(id, res.historyId, res.reconciled, null, false);
      deps.log?.("gmail.sync_ok", { inbox_id: id, mode: res.mode, examined: res.examined, created: res.created, ignored: res.ignored, truncated: res.truncated });
    } catch (err) {
      const ge = err instanceof GmailError ? err : null;
      await deps.finish(id, null, false, ge?.kind ?? "internal_error", ge?.needsReauth ?? false);
      deps.log?.("gmail.sync_failed", { inbox_id: id, kind: ge?.kind ?? "internal_error", error: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
    }
    return { kind: "done" };
  };
}

// ---------------------------------------------------------------------------
// maintenance
// ---------------------------------------------------------------------------
export function maintenanceHandler(deps: { cleanupJobs(): Promise<number>; log?: (e: string, f: Record<string, unknown>) => void }): Handler {
  return async () => {
    const removed = await deps.cleanupJobs();
    deps.log?.("maintenance.done", { jobs_removed: removed });
    return { kind: "done" };
  };
}
