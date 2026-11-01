import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isConfigured, whatsappEnv } from "@/lib/env";
import { decryptSecret } from "@/lib/security/crypto";
import { metaClient } from "@/lib/whatsapp/meta";
import { log } from "@/lib/log";
import { googleGmailPort } from "@/server/gmail/google-adapter";
import type { NotificationStore } from "@/server/gmail/types";
import { deliverNotificationHandler, maintenanceHandler, syncInboxHandler, testAlertHandler, type DeliveryContext } from "./handlers";
import { recordAudit } from "@/server/audit";
import { runWorker, type WorkerSummary } from "./worker";
import type { Job, Queue } from "./types";

function rpcError(name: string, error: { code?: string } | null) {
  if (error) throw new Error(`${name} failed: ${error.code ?? "db"}`);
}

export const supabaseQueue = (): Queue => ({
  async claim(worker, limit, leaseSeconds) {
    const { data, error } = await supabaseAdmin().rpc("claim_jobs", { p_worker: worker, p_types: null, p_limit: limit, p_lease_seconds: leaseSeconds });
    rpcError("claim_jobs", error);
    return (data ?? []) as Job[];
  },
  async complete(jobId, worker) {
    const { data, error } = await supabaseAdmin().rpc("complete_job", { p_job_id: jobId, p_worker: worker });
    rpcError("complete_job", error);
    return data === true;
  },
  async release(jobId, worker) {
    const { data, error } = await supabaseAdmin().rpc("release_job", { p_job_id: jobId, p_worker: worker });
    rpcError("release_job", error);
    return data === true;
  },
  async fail(jobId, worker, err, opts) {
    const { data, error } = await supabaseAdmin().rpc("fail_job", {
      p_job_id: jobId,
      p_worker: worker,
      p_error: err,
      p_retry_at: opts?.retryAt?.toISOString() ?? null,
      p_permanent: opts?.permanent ?? false,
    });
    rpcError("fail_job", error);
    return data as "retry" | "dead" | "lost_lease";
  },
});

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

export function whatsappSender() {
  if (!isConfigured("whatsapp")) return null;
  const env = whatsappEnv();
  return {
    client: metaClient({ phoneNumberId: env.META_WA_PHONE_NUMBER_ID, accessToken: env.META_WA_ACCESS_TOKEN, apiVersion: env.META_WA_API_VERSION }),
    template: env.META_WA_TEMPLATE_ALERT,
    language: env.META_WA_TEMPLATE_LANGUAGE,
  };
}

function handlers() {
  const db = supabaseAdmin();
  return {
    deliver_notification: deliverNotificationHandler({
      async context(id) {
        const { data, error } = await db.rpc("delivery_context", { p_notification_id: id });
        rpcError("delivery_context", error);
        return ((data ?? [])[0] ?? null) as DeliveryContext | null;
      },
      async record(args) {
        const { error } = await db.rpc("record_delivery_attempt", args);
        rpcError("record_delivery_attempt", error);
      },
      whatsapp: whatsappSender,
      log: (e, f) => log.warn(e, f),
    }),
    sync_inbox: syncInboxHandler({
      async loadInbox(id) {
        const { data, error } = await db
          .from("connected_inboxes")
          .select("id,user_id,label,status,last_history_id,last_reconciled_at,inbox_credentials(encrypted_refresh_token)")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error(`load inbox failed: ${error.code}`);
        const cred = (data?.inbox_credentials as unknown as { encrypted_refresh_token: string } | null)?.encrypted_refresh_token;
        if (!data || !cred) return null;
        return { ...data, refreshToken: decryptSecret(cred) } as never;
      },
      gmail: googleGmailPort,
      store: supabaseNotificationStore(),
      async finish(id, historyId, reconciled, code, reauth) {
        const { error } = await db.rpc("finish_inbox_sync", {
          p_inbox_id: id,
          p_history_id: historyId,
          p_reconciled: reconciled,
          p_error_code: code,
          p_needs_reauth: reauth,
        });
        rpcError("finish_inbox_sync", error);
      },
      onReauthNeeded: (userId, inboxId, label) => recordAudit(userId, "inbox.reauth_needed", { inbox: label }),
      log: (e, f) => (e.endsWith("failed") ? log.warn(e, f) : log.info(e, f)),
    }),
    send_test_alert: testAlertHandler({
      async destination(userId) {
        const [{ data: wa }, { data: profile }] = await Promise.all([
          db.from("whatsapp_connections").select("phone_e164,status").eq("user_id", userId).maybeSingle(),
          db.from("profiles").select("timezone").eq("id", userId).maybeSingle(),
        ]);
        return wa ? { phone_e164: wa.phone_e164 as string, status: wa.status as string, timezone: (profile?.timezone as string) ?? "UTC" } : null;
      },
      whatsapp: whatsappSender,
      audit: (userId) => recordAudit(userId, "whatsapp.test_sent"),
    }),
    maintenance: maintenanceHandler({
      async runRetention() {
        const { data, error } = await db.rpc("run_retention");
        rpcError("run_retention", error);
        return (data ?? {}) as Record<string, number>;
      },
      log: (e, f) => log.info(e, f),
    }),
  };
}

export type TickSummary = { enqueued: { syncs: number }; worker: WorkerSummary };

/**
 * One scheduler tick: enqueue due work, then process the queue within budget.
 * Safe to run concurrently or overlapping — the queue guarantees each job is
 * processed by one worker at a time.
 */
export async function runTick(budgetMs = 45_000): Promise<TickSummary> {
  const db = supabaseAdmin();
  let syncs = 0;
  if (isConfigured("google")) {
    const { data, error } = await db.rpc("enqueue_due_syncs", { p_min_interval_seconds: 60 });
    rpcError("enqueue_due_syncs", error);
    syncs = Number(data ?? 0);
  }
  const today = new Date().toISOString().slice(0, 10);
  const { error: mErr } = await db.rpc("enqueue_job", {
    p_job_type: "maintenance",
    p_idempotency_key: `maintenance:${today}`,
    p_priority: 200,
    p_max_attempts: 3,
  });
  rpcError("enqueue_job", mErr);

  const worker = await runWorker(supabaseQueue(), handlers(), {
    workerId: `tick-${randomUUID()}`,
    budgetMs,
    log: (e, f) => log.error(e, f),
  });
  log.info("tick.done", { syncs_enqueued: syncs, ...worker });
  return { enqueued: { syncs }, worker };
}
