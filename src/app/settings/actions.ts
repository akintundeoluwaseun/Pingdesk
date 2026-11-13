"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/user";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/security/crypto";
import { googleOAuthClient } from "@/lib/google/oauth";
import { sendAlertTemplate } from "@/lib/whatsapp/send";
import { formatReceived } from "@/lib/notifications/deliver";

const CATEGORIES = ["buyer_message", "order_alert", "payment_alert", "policy_alert", "security_alert", "other_alert"] as const;

function go(path: string, key: "error" | "notice", message: string): never {
  redirect(`${path}?${key}=${encodeURIComponent(message)}`);
}

/** "+234 803 123 4567" -> "2348031234567". Returns null if it isn't a full international number. */
function normalizeNumber(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/[^\d]/g, "").replace(/^00/, "");
  if (trimmed.replace(/[\s()-]/g, "").startsWith("0") && !trimmed.startsWith("00")) return null;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export async function savePreferences(form: FormData) {
  const { supabase, user } = await requireUser("/settings");
  const number = normalizeNumber(String(form.get("whatsapp_number") ?? ""));
  if (number === null) go("/settings", "error", "Enter the number with its country code, for example +234 803 123 4567.");
  const optIn = form.get("whatsapp_opt_in") === "on";
  if (optIn && !number) go("/settings", "error", "Add a WhatsApp number before turning alerts on.");
  const timezone = String(form.get("timezone") ?? "UTC");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { go("/settings", "error", "Pick a valid time zone."); }

  const row: Record<string, unknown> = { user_id: user.id, whatsapp_number: number || null, whatsapp_opt_in: optIn, timezone, updated_at: new Date().toISOString() };
  for (const c of CATEGORIES) row[c] = form.get(c) === "on";
  const { error } = await supabase.from("notification_preferences").upsert(row, { onConflict: "user_id" });
  if (error) go("/settings", "error", "Couldn't save your settings. Try again.");
  revalidatePath("/dashboard");
  go("/settings", "notice", "Settings saved.");
}

export async function sendTestAlert() {
  const { supabase, user } = await requireUser("/settings");
  const { data: prefs } = await supabase.from("notification_preferences").select("whatsapp_number,whatsapp_opt_in,timezone").eq("user_id", user.id).maybeSingle();
  if (!prefs?.whatsapp_number || !prefs.whatsapp_opt_in) go("/settings", "error", "Save a WhatsApp number with alerts turned on first.");
  try {
    await sendAlertTemplate(prefs.whatsapp_number, "PingDesk test", "Test alert", formatReceived(null, prefs.timezone));
  } catch (e) {
    go("/settings", "error", `The test didn't send: ${e instanceof Error ? e.message : "unknown error"}`);
  }
  go("/settings", "notice", "Test alert sent. It should reach WhatsApp within a minute.");
}

export async function disconnectInbox(form: FormData) {
  const { user } = await requireUser("/dashboard");
  const id = String(form.get("inbox_id") ?? "");
  const { data: inbox } = await supabaseAdmin.from("connected_inboxes").select("id,encrypted_refresh_token,email_address").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!inbox) go("/dashboard", "error", "That inbox wasn't found.");
  // Revoke at Google so the token is useless even if a copy existed somewhere; ignore failures (already revoked).
  try { if (inbox.encrypted_refresh_token) await googleOAuthClient().revokeToken(decryptSecret(inbox.encrypted_refresh_token)); } catch {}
  await supabaseAdmin.from("connected_inboxes").delete().eq("id", inbox.id).eq("user_id", user.id);
  revalidatePath("/dashboard");
  go("/dashboard", "notice", `${inbox.email_address} disconnected and its alert history deleted.`);
}
