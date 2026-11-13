import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendAlertTemplate, WhatsAppError } from "@/lib/whatsapp/send";
import { CATEGORY_LABEL, type AlertCategory } from "@/lib/email/classify";

export const MAX_ATTEMPTS = 4;
const PREF_COLUMN: Record<AlertCategory, string> = {
  buyer_message: "buyer_message", order: "order_alert", payment: "payment_alert",
  policy: "policy_alert", security: "security_alert", other: "other_alert",
};

type Prefs = Record<string, unknown> & { whatsapp_number: string | null; whatsapp_opt_in: boolean; timezone: string | null };

export function formatReceived(iso: string | null, timeZone: string | null) {
  const d = iso ? new Date(iso) : new Date();
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timeZone || "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
}

/** Retry after 1, 5, then 30 minutes. 4xx errors other than rate limits are not retried. */
function retryDelayMs(attempt: number) { return [60_000, 300_000, 1_800_000][attempt - 1] ?? 1_800_000; }
function retryable(e: unknown) {
  if (!(e instanceof WhatsAppError)) return true;
  if (e.code === "not_configured") return true;
  return e.status === 429 || e.status >= 500 || e.code === "130429" || e.code === "131056";
}

export async function deliverQueued(limit = 25) {
  const now = new Date().toISOString();
  // Anything stuck in "processing" for 10 minutes (a crashed run) goes back to the queue.
  await supabaseAdmin.from("notifications").update({ processing_status: "queued" })
    .eq("processing_status", "processing").lt("updated_at", new Date(Date.now() - 600_000).toISOString());

  const { data: queued, error } = await supabaseAdmin
    .from("notifications")
    .select("id,user_id,category,received_at,attempts,inbox:connected_inboxes(display_name)")
    .eq("processing_status", "queued").lte("next_attempt_at", now)
    .order("created_at", { ascending: true }).limit(limit);
  if (error) throw new Error("Could not load queued notifications.");

  const prefsCache = new Map<string, Prefs | null>();
  const results: { id: string; outcome: string }[] = [];

  for (const n of queued ?? []) {
    // Claim the row so two overlapping runs can't both send it.
    const { data: claimed } = await supabaseAdmin.from("notifications")
      .update({ processing_status: "processing", updated_at: new Date().toISOString() })
      .eq("id", n.id).eq("processing_status", "queued").select("id");
    if (!claimed?.length) continue;

    if (!prefsCache.has(n.user_id)) {
      const { data } = await supabaseAdmin.from("notification_preferences").select("*").eq("user_id", n.user_id).maybeSingle();
      prefsCache.set(n.user_id, (data as Prefs | null) ?? null);
    }
    const prefs = prefsCache.get(n.user_id);
    const category = n.category as AlertCategory;
    const skip = !prefs?.whatsapp_opt_in ? "no_opt_in" : !prefs.whatsapp_number ? "no_number" : prefs[PREF_COLUMN[category]] === false ? "category_off" : null;
    if (skip) {
      await supabaseAdmin.from("notifications").update({ processing_status: "ignored", skip_reason: skip, updated_at: new Date().toISOString() }).eq("id", n.id);
      results.push({ id: n.id, outcome: `ignored:${skip}` });
      continue;
    }

    const attempt = (n.attempts ?? 0) + 1;
    const inbox = Array.isArray(n.inbox) ? n.inbox[0] : n.inbox;
    const { data: log } = await supabaseAdmin.from("delivery_logs")
      .insert({ notification_id: n.id, channel: "whatsapp", delivery_status: "queued", attempt_count: attempt })
      .select("id").single();
    try {
      const { messageId } = await sendAlertTemplate(prefs!.whatsapp_number!, inbox?.display_name ?? "your inbox", CATEGORY_LABEL[category], formatReceived(n.received_at, prefs!.timezone));
      await supabaseAdmin.from("delivery_logs").update({ provider_message_id: messageId, delivery_status: "submitted", sent_at: new Date().toISOString() }).eq("id", log?.id);
      await supabaseAdmin.from("notifications").update({ processing_status: "sent", attempts: attempt, updated_at: new Date().toISOString() }).eq("id", n.id);
      results.push({ id: n.id, outcome: "sent" });
    } catch (e) {
      const code = e instanceof WhatsAppError ? e.code ?? String(e.status) : "network";
      await supabaseAdmin.from("delivery_logs").update({ delivery_status: "failed", error_code: code, error_message: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).eq("id", log?.id);
      const again = retryable(e) && attempt < MAX_ATTEMPTS;
      await supabaseAdmin.from("notifications").update({
        processing_status: again ? "queued" : "failed", attempts: attempt,
        next_attempt_at: new Date(Date.now() + retryDelayMs(attempt)).toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", n.id);
      results.push({ id: n.id, outcome: again ? "retry" : "failed" });
    }
  }
  return results;
}
