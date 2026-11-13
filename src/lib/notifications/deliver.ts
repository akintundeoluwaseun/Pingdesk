import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendAlertTemplate, WhatsAppError } from "@/lib/whatsapp/send";
import { CATEGORY_LABEL, type AlertCategory } from "@/lib/email/classify";

export const MAX_ATTEMPTS = 4;
const HOURLY_LIMIT = 30; // per user, protects against a flood of emails

/** Row shape returned by the claim_notifications_for_delivery() database function. */
type Claimed = {
  id: string; user_id: string; category: AlertCategory; inbox_label: string; received_at: string; delivery_attempts: number;
  timezone: string; alerts_paused: boolean; category_enabled: boolean; phone_e164: string | null; whatsapp_status: string | null; sent_last_hour: number;
};

export function formatReceived(iso: string | null, timeZone: string | null) {
  const d = iso ? new Date(iso) : new Date();
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timeZone || "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
}

/** Retry after 1, 5, then 30 minutes. 4xx errors other than rate limits are not retried. */
function retryAt(attempt: number) { return new Date(Date.now() + ([60_000, 300_000, 1_800_000][attempt - 1] ?? 1_800_000)).toISOString(); }
function retryable(e: unknown) {
  if (!(e instanceof WhatsAppError)) return true;
  if (e.code === "not_configured") return true;
  return e.status === 429 || e.status >= 500 || e.code === "130429" || e.code === "131056";
}

const record = (args: Record<string, unknown>) => supabaseAdmin.rpc("record_delivery_attempt", args);

export async function deliverQueued(limit = 25) {
  // The database leases each row for 2 minutes, so overlapping runs never send the same alert twice.
  const { data, error } = await supabaseAdmin.rpc("claim_notifications_for_delivery", { p_limit: limit, p_lease_seconds: 120 });
  if (error) throw new Error(`Could not claim notifications: ${error.message}`);
  const results: { id: string; outcome: string }[] = [];

  for (const n of (data ?? []) as Claimed[]) {
    const skip = n.alerts_paused ? "alerts_paused"
      : !n.category_enabled ? "category_off"
      : !n.phone_e164 || !n.whatsapp_status ? "no_whatsapp"
      : n.whatsapp_status === "opted_out" ? "opted_out"
      : n.whatsapp_status !== "verified" ? "whatsapp_unverified" : null;
    if (skip) {
      await record({ p_notification_id: n.id, p_outcome: "skipped", p_skip_reason: skip });
      results.push({ id: n.id, outcome: `skipped:${skip}` });
      continue;
    }
    if (n.sent_last_hour >= HOURLY_LIMIT) {
      await record({ p_notification_id: n.id, p_outcome: "deferred", p_retry_at: new Date(Date.now() + 900_000).toISOString() });
      results.push({ id: n.id, outcome: "deferred" });
      continue;
    }

    const attempt = (n.delivery_attempts ?? 0) + 1;
    const template = process.env.META_WA_TEMPLATE_ALERT ?? null;
    const last4 = n.phone_e164!.slice(-4);
    try {
      const { messageId } = await sendAlertTemplate(n.phone_e164!, n.inbox_label, CATEGORY_LABEL[n.category] ?? "Fiverr email", formatReceived(n.received_at, n.timezone));
      await record({ p_notification_id: n.id, p_outcome: "submitted", p_provider_message_id: messageId, p_template_name: template, p_recipient_last4: last4 });
      results.push({ id: n.id, outcome: "submitted" });
    } catch (e) {
      const again = retryable(e) && attempt < MAX_ATTEMPTS;
      await record({
        p_notification_id: n.id, p_outcome: again ? "retry" : "failed",
        p_error_code: e instanceof WhatsAppError ? e.code ?? String(e.status) : "network",
        p_error_title: e instanceof Error ? e.message : String(e),
        p_retry_at: again ? retryAt(attempt) : null, p_template_name: template, p_recipient_last4: last4,
      });
      results.push({ id: n.id, outcome: again ? "retry" : "failed" });
    }
  }
  return results;
}
