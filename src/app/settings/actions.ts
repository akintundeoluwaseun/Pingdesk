"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/user";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decryptSecret, hashVerificationCode, newVerificationCode } from "@/lib/security/crypto";
import { googleOAuthClient } from "@/lib/google/oauth";
import { sendAlertTemplate, sendVerificationCode } from "@/lib/whatsapp/send";
import { formatReceived } from "@/lib/notifications/deliver";

const CATEGORIES = ["buyer_message", "new_order", "order_update", "payment", "policy", "account_security", "general", "unclassified"] as const;
const OPT_IN_VERSION = "2026-11-v1";

function go(path: string, key: "error" | "notice", message: string): never {
  redirect(`${path}?${key}=${encodeURIComponent(message)}`);
}

/** "+234 803 123 4567" -> "+2348031234567". Returns null if it isn't a full international number. */
function toE164(input: string) {
  const t = input.trim().replace(/[\s()-]/g, "");
  const digits = t.startsWith("+") ? t.slice(1) : t.startsWith("00") ? t.slice(2) : null;
  return digits && /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

export async function savePreferences(form: FormData) {
  const { user } = await requireUser("/settings");
  const timezone = String(form.get("timezone") ?? "UTC");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { go("/settings", "error", "Pick a valid time zone."); }

  const prefs: Record<string, unknown> = { user_id: user.id, alerts_paused: form.get("alerts_paused") === "on" };
  for (const c of CATEGORIES) prefs[c] = form.get(c) === "on";
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabaseAdmin.from("notification_preferences").upsert(prefs, { onConflict: "user_id" }),
    supabaseAdmin.from("profiles").upsert({ id: user.id, timezone }, { onConflict: "id" }),
  ]);
  if (e1 || e2) go("/settings", "error", "Couldn't save your settings. Try again.");
  revalidatePath("/dashboard");
  go("/settings", "notice", "Settings saved.");
}

const START_MESSAGES: Record<string, string> = {
  invalid_phone: "Enter the number with its country code, for example +234 803 123 4567.",
  already_verified: "That number is already verified.",
  cooldown: "Wait a minute before asking for another code.",
  user_limit: "Too many codes requested. Try again in an hour.",
  phone_limit: "Too many codes sent to this number. Try again later.",
};

export async function startVerification(form: FormData) {
  const { user } = await requireUser("/settings");
  if (form.get("consent") !== "on") go("/settings", "error", "Tick the box to agree to receive alerts on WhatsApp.");
  const phone = toE164(String(form.get("phone") ?? ""));
  if (!phone) go("/settings", "error", START_MESSAGES.invalid_phone);
  const code = newVerificationCode();
  const { data, error } = await supabaseAdmin.rpc("start_whatsapp_verification", {
    p_user_id: user.id, p_phone: phone, p_code_hash: hashVerificationCode(user.id, code), p_opt_in_version: OPT_IN_VERSION, p_ttl_seconds: 600,
  });
  if (error) go("/settings", "error", "Couldn't start verification. Try again.");
  if (data !== "ok") go("/settings", data === "already_verified" ? "notice" : "error", START_MESSAGES[data as string] ?? "Couldn't start verification.");
  try {
    await sendVerificationCode(phone, code);
  } catch (e) {
    go("/settings", "error", `The code didn't send: ${e instanceof Error ? e.message : "unknown error"}. Try again in a minute.`);
  }
  revalidatePath("/settings");
  go("/settings", "notice", `We sent a 6-digit code to ${phone} on WhatsApp. It expires in 10 minutes.`);
}

const CONFIRM_MESSAGES: Record<string, string> = {
  none: "There's no code waiting. Ask for a new one.",
  locked: "Too many wrong codes. Ask for a new one.",
  expired: "That code has expired. Ask for a new one.",
  invalid: "That code isn't right. Check WhatsApp and try again.",
};

export async function confirmVerification(form: FormData) {
  const { user } = await requireUser("/settings");
  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  if (code.length !== 6) go("/settings", "error", "Enter the 6-digit code from WhatsApp.");
  const { data, error } = await supabaseAdmin.rpc("confirm_whatsapp_verification", { p_user_id: user.id, p_code_hash: hashVerificationCode(user.id, code) });
  if (error) go("/settings", "error", "Couldn't check the code. Try again.");
  if (data !== "verified") go("/settings", "error", CONFIRM_MESSAGES[data as string] ?? "Couldn't verify the number.");
  revalidatePath("/dashboard");
  go("/settings", "notice", "Number verified. Alerts will now reach your WhatsApp.");
}

export async function stopWhatsApp() {
  const { user } = await requireUser("/settings");
  await supabaseAdmin.from("whatsapp_connections").update({ status: "opted_out", opted_out_at: new Date().toISOString() }).eq("user_id", user.id).eq("status", "verified");
  revalidatePath("/dashboard");
  go("/settings", "notice", "WhatsApp alerts turned off. Verify your number again to turn them back on.");
}

export async function sendTestAlert() {
  const { user } = await requireUser("/settings");
  const [{ data: w }, { data: profile }] = await Promise.all([
    supabaseAdmin.from("whatsapp_connections").select("phone_e164,status").eq("user_id", user.id).maybeSingle(),
    supabaseAdmin.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
  ]);
  if (w?.status !== "verified") go("/settings", "error", "Verify your WhatsApp number first.");
  try {
    await sendAlertTemplate(w.phone_e164, "PingDesk test", "Test alert", formatReceived(null, profile?.timezone ?? "UTC"));
  } catch (e) {
    go("/settings", "error", `The test didn't send: ${e instanceof Error ? e.message : "unknown error"}`);
  }
  go("/settings", "notice", "Test alert sent. It should reach WhatsApp within a minute.");
}

export async function disconnectInbox(form: FormData) {
  const { user } = await requireUser("/dashboard");
  const id = String(form.get("inbox_id") ?? "");
  const { data: inbox } = await supabaseAdmin.from("connected_inboxes").select("id,email_address").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!inbox) go("/dashboard", "error", "That inbox wasn't found.");
  const { data: cred } = await supabaseAdmin.from("inbox_credentials").select("encrypted_refresh_token").eq("inbox_id", inbox.id).maybeSingle();
  // Revoke at Google so the token is useless even if a copy existed somewhere; ignore failures (already revoked).
  try { if (cred?.encrypted_refresh_token) await googleOAuthClient().revokeToken(decryptSecret(cred.encrypted_refresh_token)); } catch {}
  // Deleting the inbox also deletes its credentials, alerts and delivery logs (foreign keys cascade).
  await supabaseAdmin.from("connected_inboxes").delete().eq("id", inbox.id).eq("user_id", user.id);
  revalidatePath("/dashboard");
  go("/dashboard", "notice", `${inbox.email_address} disconnected and its alert history deleted.`);
}
