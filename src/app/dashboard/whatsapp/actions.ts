"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { toE164 } from "@/lib/whatsapp/phone";
import { confirmVerification, startVerification, type StartResult } from "@/server/whatsapp/verification";
import { log } from "@/lib/log";
import { recordAudit } from "@/server/audit";
import { allow, LIMITS } from "@/server/rate-limit";

export type WaState = { error?: string; message?: string; step?: "code" };

const START_MESSAGES: Record<Exclude<StartResult, "ok">, string> = {
  cooldown: "Wait a minute before requesting another code.",
  user_limit: "Too many codes requested. Try again in an hour.",
  phone_limit: "Too many codes have been sent to this number. Try again later.",
  already_verified: "This number is already verified.",
  invalid_phone: "Enter a valid mobile number, including the country code.",
  send_failed: "We couldn't send the code right now. Try again in a few minutes.",
  not_on_whatsapp: "That number doesn't seem to be on WhatsApp. Check it and try again.",
};

function unavailable(): WaState | null {
  return isConfigured("whatsapp") ? null : { error: "WhatsApp delivery isn't available yet on this PingDesk server." };
}

export async function requestCode(_: WaState, form: FormData): Promise<WaState> {
  const user = await requireUser();
  const off = unavailable();
  if (off) return off;
  if (form.get("consent") !== "on") return { error: "Tick the consent box so we're allowed to message you on WhatsApp." };
  const phone = toE164(String(form.get("phone") ?? ""));
  if (!phone) return { error: START_MESSAGES.invalid_phone };
  try {
    const result = await startVerification(user.id, phone);
    revalidatePath("/dashboard/whatsapp");
    if (result === "ok") {
      await recordAudit(user.id, "whatsapp.code_sent", { number_ending: phone.slice(-4) });
      return { step: "code", message: "We sent a 6-digit code to your WhatsApp." };
    }
    return { error: START_MESSAGES[result] };
  } catch (e) {
    log.error("whatsapp.request_code_failed", { user_id: user.id, error: e });
    return { error: START_MESSAGES.send_failed };
  }
}

export async function resendCode(): Promise<WaState> {
  const user = await requireUser();
  const off = unavailable();
  if (off) return off;
  const { data } = await supabaseAdmin().from("whatsapp_connections").select("phone_e164,status").eq("user_id", user.id).maybeSingle();
  if (!data || data.status !== "pending_verification") return { error: "Start again by entering your number." };
  const result = await startVerification(user.id, data.phone_e164).catch(() => "send_failed" as const);
  revalidatePath("/dashboard/whatsapp");
  return result === "ok" ? { message: "New code sent." } : { error: START_MESSAGES[result] };
}

export async function submitCode(_: WaState, form: FormData): Promise<WaState> {
  const user = await requireUser();
  const parsed = z.string().regex(/^\d{6}$/).safeParse(String(form.get("code") ?? "").replace(/\s/g, ""));
  if (!parsed.success) return { error: "Enter the 6-digit code from WhatsApp." };
  try {
    const result = await confirmVerification(user.id, parsed.data);
    revalidatePath("/dashboard", "layout");
    switch (result) {
      case "verified":
        log.info("whatsapp.verified", { user_id: user.id });
        await recordAudit(user.id, "whatsapp.verified");
        return { message: "Number verified. Alerts will now reach your WhatsApp." };
      case "invalid":
        return { error: "That code isn't right. Check it and try again." };
      case "expired":
        return { error: "That code has expired. Request a new one." };
      case "locked":
        return { error: "Too many wrong attempts. Request a new code." };
      default:
        return { error: "Start again by entering your number." };
    }
  } catch (e) {
    log.error("whatsapp.confirm_failed", { user_id: user.id, error: e });
    return { error: "We couldn't check the code. Try again." };
  }
}

export async function removeNumber(): Promise<WaState> {
  const user = await requireUser();
  const { error } = await supabaseAdmin().from("whatsapp_connections").delete().eq("user_id", user.id);
  if (error) return { error: "We couldn't remove the number. Try again." };
  log.info("whatsapp.removed", { user_id: user.id });
  await recordAudit(user.id, "whatsapp.removed");
  revalidatePath("/dashboard", "layout");
  return { message: "Number removed. No more WhatsApp alerts will be sent." };
}

export async function sendTestAlert(): Promise<WaState> {
  const user = await requireUser();
  const off = unavailable();
  if (off) return off;
  const { data: wa } = await supabaseAdmin().from("whatsapp_connections").select("status").eq("user_id", user.id).maybeSingle();
  if (wa?.status !== "verified") return { error: "Verify your number first." };
  if (!(await allow(`test_alert:${user.id}`, LIMITS.testAlert))) return { error: "You can send 3 test alerts a day. Try again tomorrow." };
  const { error } = await supabaseAdmin().rpc("enqueue_job", {
    p_job_type: "send_test_alert",
    p_user_id: user.id,
    p_dedupe_key: `test_alert:${user.id}`,
    p_max_attempts: 3,
    p_priority: 5,
  });
  if (error) return { error: "We couldn't queue the test alert. Try again." };
  return { message: "Test alert on its way — it should arrive within a minute." };
}
