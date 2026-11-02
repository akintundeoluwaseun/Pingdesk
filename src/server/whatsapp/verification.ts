import "server-only";
import { createHmac, randomInt } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { whatsappEnv } from "@/lib/env";
import { MetaError, metaClient, otpComponents } from "@/lib/whatsapp/meta";
import { log } from "@/lib/log";

/** Bump when the consent wording on the WhatsApp page changes. */
export const OPT_IN_VERSION = "2026-11-01";
export const CODE_TTL_SECONDS = 600;

export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Codes are stored only as an HMAC bound to the user, never in plain text. */
export function hashCode(userId: string, code: string, secret = process.env.TOKEN_ENCRYPTION_KEY ?? ""): string {
  if (!/^[0-9a-fA-F]{64}$/.test(secret)) throw new Error("TOKEN_ENCRYPTION_KEY is required for verification codes.");
  return createHmac("sha256", Buffer.from(secret, "hex")).update(`wa-otp:${userId}:${code}`).digest("hex");
}

export type StartResult = "ok" | "cooldown" | "user_limit" | "phone_limit" | "already_verified" | "invalid_phone" | "send_failed" | "not_on_whatsapp";

export async function startVerification(userId: string, phoneE164: string): Promise<StartResult> {
  const env = whatsappEnv();
  const code = generateCode();
  const { data, error } = await supabaseAdmin().rpc("start_whatsapp_verification", {
    p_user_id: userId,
    p_phone: phoneE164,
    p_code_hash: hashCode(userId, code),
    p_opt_in_version: OPT_IN_VERSION,
    p_ttl_seconds: CODE_TTL_SECONDS,
  });
  if (error) throw new Error(`start verification failed: ${error.code}`);
  if (data !== "ok") return data as StartResult;

  try {
    const client = metaClient({ phoneNumberId: env.META_WA_PHONE_NUMBER_ID, accessToken: env.META_WA_ACCESS_TOKEN, apiVersion: env.META_WA_API_VERSION });
    await client.sendTemplate(phoneE164, env.META_WA_TEMPLATE_VERIFY, env.META_WA_TEMPLATE_LANGUAGE, otpComponents(code));
    log.info("whatsapp.verification_sent", { user_id: userId });
    return "ok";
  } catch (err) {
    const me = err instanceof MetaError ? err : null;
    log[me?.operator ? "error" : "warn"]("whatsapp.verification_send_failed", { user_id: userId, error_code: me?.code ?? null });
    return me?.code === 131026 ? "not_on_whatsapp" : "send_failed";
  }
}

export type ConfirmResult = "verified" | "invalid" | "expired" | "locked" | "none";

export async function confirmVerification(userId: string, code: string): Promise<ConfirmResult> {
  const { data, error } = await supabaseAdmin().rpc("confirm_whatsapp_verification", {
    p_user_id: userId,
    p_code_hash: hashCode(userId, code),
  });
  if (error) throw new Error(`confirm verification failed: ${error.code}`);
  return data as ConfirmResult;
}
