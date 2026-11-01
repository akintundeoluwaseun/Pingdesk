import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { whatsappEnv } from "@/lib/env";
import { MetaError, metaClient, type WhatsAppClient } from "@/lib/whatsapp/meta";
import { last4 } from "@/lib/whatsapp/phone";
import { log } from "@/lib/log";
import { decide, failureOutcome, type ClaimedNotification } from "./decide";

export type DeliverySummary = { claimed: number; submitted: number; skipped: number; deferred: number; retrying: number; failed: number };

export function whatsappClient(): { client: WhatsAppClient; template: string; language: string } {
  const env = whatsappEnv();
  return {
    client: metaClient({ phoneNumberId: env.META_WA_PHONE_NUMBER_ID, accessToken: env.META_WA_ACCESS_TOKEN, apiVersion: env.META_WA_API_VERSION }),
    template: env.META_WA_TEMPLATE_ALERT,
    language: env.META_WA_TEMPLATE_LANGUAGE,
  };
}

/**
 * Claims due notifications (leased, SKIP LOCKED), applies preferences, and
 * sends the approved alert template. Each outcome is recorded atomically by
 * record_delivery_attempt. Delivery is at-least-once: if the process dies
 * after Meta accepts a message but before it is recorded, the lease expires
 * and the alert may be sent again.
 */
export async function runDelivery(opts: { limit?: number; budgetMs?: number } = {}): Promise<DeliverySummary> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 30_000;
  const db = supabaseAdmin();
  const { client, template, language } = whatsappClient();

  const { data, error } = await db.rpc("claim_notifications_for_delivery", {
    p_limit: opts.limit ?? 25,
    p_lease_seconds: Math.ceil(budget / 1000) + 30,
  });
  if (error) throw new Error(`claim deliveries failed: ${error.code}`);
  const items = (data ?? []) as ClaimedNotification[];
  const summary: DeliverySummary = { claimed: items.length, submitted: 0, skipped: 0, deferred: 0, retrying: 0, failed: 0 };

  const record = async (args: Record<string, unknown>) => {
    const { error: e } = await db.rpc("record_delivery_attempt", args);
    if (e) log.error("delivery.record_failed", { notification_id: args.p_notification_id, error_code: e.code });
  };

  for (const n of items) {
    if (Date.now() - started > budget) {
      await db.from("notifications").update({ delivery_locked_until: null }).eq("id", n.id);
      continue;
    }
    const d = decide(n);
    if (d.action === "skip") {
      summary.skipped++;
      await record({ p_notification_id: n.id, p_outcome: "skipped", p_skip_reason: d.reason });
      continue;
    }
    if (d.action === "defer") {
      summary.deferred++;
      await record({ p_notification_id: n.id, p_outcome: "deferred", p_retry_at: d.until.toISOString() });
      continue;
    }
    const attempt = n.delivery_attempts + 1;
    try {
      const { messageId } = await client.sendTemplate(d.to, template, language, d.components);
      summary.submitted++;
      await record({
        p_notification_id: n.id,
        p_outcome: "submitted",
        p_provider_message_id: messageId,
        p_template_name: template,
        p_recipient_last4: last4(d.to),
      });
    } catch (err) {
      const me = err instanceof MetaError ? err : new MetaError(null, "Unexpected send error", true, false, 0);
      const f = failureOutcome(me, attempt);
      if (f.outcome === "retry") summary.retrying++;
      else summary.failed++;
      await record({
        p_notification_id: n.id,
        p_outcome: f.outcome,
        p_error_code: me.code?.toString() ?? `http_${me.httpStatus}`,
        p_error_title: me.title,
        p_retry_at: f.retryAt?.toISOString() ?? null,
        p_template_name: template,
        p_recipient_last4: last4(d.to),
      });
      log[me.operator ? "error" : "warn"]("delivery.send_failed", { notification_id: n.id, error_code: me.code, outcome: f.outcome, operator: me.operator });
    }
  }
  return summary;
}
