import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { classifyMetaError } from "@/lib/whatsapp/meta";
import { failureOutcome } from "@/server/delivery/decide";
import { whatsappSender } from "@/server/jobs/runtime";
import { parseWebhook, verifySignature } from "@/server/whatsapp/webhook";
import { log } from "@/lib/log";
import { recordAuditByPhone } from "@/server/audit";

/**
 * Meta WhatsApp Cloud API webhook.
 *  GET  — subscription handshake (hub.verify_token).
 *  POST — signed (X-Hub-Signature-256) delivery statuses and inbound replies.
 * Handlers are idempotent, so Meta's retries and replays are harmless.
 */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const expected = process.env.META_WA_VERIFY_TOKEN;
  const token = p.get("hub.verify_token") ?? "";
  const ok =
    p.get("hub.mode") === "subscribe" &&
    !!expected &&
    token.length === expected.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  const challenge = p.get("hub.challenge");
  if (ok && challenge && /^[\w-]{1,128}$/.test(challenge)) {
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return NextResponse.json({ error: "Webhook verification failed." }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const secret = process.env.META_WA_APP_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { statuses, inbound } = parseWebhook(payload);
  const db = supabaseAdmin();

  for (const s of statuses) {
    let retryAt: string | null = null;
    if (s.status === "failed") {
      const { data: logRow } = await db.from("delivery_logs").select("attempt").eq("provider_message_id", s.providerMessageId).maybeSingle();
      const err = classifyMetaError(200, { error: { code: s.errorCode ?? undefined, message: s.errorTitle ?? "failed" } });
      const f = failureOutcome(err, logRow?.attempt ?? 1);
      retryAt = f.retryAt?.toISOString() ?? null;
    }
    const { error } = await db.rpc("apply_delivery_status", {
      p_provider_message_id: s.providerMessageId,
      p_status: s.status,
      p_at: s.at,
      p_error_code: s.errorCode?.toString() ?? null,
      p_error_title: s.errorTitle,
      p_pricing_category: s.pricingCategory,
      p_billable: s.billable,
      p_retry_at: retryAt,
    });
    if (error) log.error("whatsapp.status_apply_failed", { error_code: error.code });
  }

  for (const m of inbound) {
    const { data: affected, error } = await db.rpc("whatsapp_inbound", { p_phone: m.phone, p_action: m.action });
    if (error) {
      log.error("whatsapp.inbound_failed", { error_code: error.code });
      continue;
    }
    if (m.action !== "message" && (affected ?? 0) > 0) {
      log.info("whatsapp.opt_change", { action: m.action });
      await recordAuditByPhone(m.phone, m.action === "stop" ? "whatsapp.opted_out" : "whatsapp.opted_in");
      // The user just messaged us, so a free-form reply is inside the 24-hour window.
      try {
        await whatsappSender()?.client.sendText(
          m.phone,
          m.action === "stop"
            ? "You've stopped PingDesk alerts. Reply START to turn them back on."
            : "PingDesk alerts are back on. Reply STOP any time to pause them.",
        );
      } catch {
        // Confirmation is best-effort; the opt-change itself is already saved.
      }
    }
  }
  return NextResponse.json({ received: true });
}
