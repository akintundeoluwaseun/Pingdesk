import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

/**
 * User-visible activity events. Details must never contain tokens, codes,
 * full phone numbers, email bodies or message content.
 */
export type AuditEvent =
  | "inbox.connected"
  | "inbox.disconnected"
  | "inbox.removed"
  | "inbox.renamed"
  | "inbox.reauth_needed"
  | "inbox.sync_requested"
  | "whatsapp.code_sent"
  | "whatsapp.verified"
  | "whatsapp.removed"
  | "whatsapp.opted_out"
  | "whatsapp.opted_in"
  | "whatsapp.test_sent"
  | "preferences.updated"
  | "profile.updated"
  | "account.password_changed";

/** Best effort: activity logging must never break the action it describes. */
export async function recordAudit(userId: string, event: AuditEvent, details: Record<string, string | number | boolean | null> = {}) {
  try {
    const { error } = await supabaseAdmin().from("audit_events").insert({ user_id: userId, event, details });
    if (error) log.warn("audit.insert_failed", { event, error_code: error.code });
  } catch (e) {
    log.warn("audit.insert_failed", { event, error: e });
  }
}

/** For events keyed by phone (webhooks), record against every matching user. */
export async function recordAuditByPhone(phoneE164: string, event: AuditEvent) {
  try {
    const { data } = await supabaseAdmin().from("whatsapp_connections").select("user_id").eq("phone_e164", phoneE164);
    await Promise.all((data ?? []).map((r) => recordAudit(r.user_id as string, event, { number_ending: phoneE164.slice(-4) })));
  } catch (e) {
    log.warn("audit.insert_failed", { event, error: e });
  }
}
