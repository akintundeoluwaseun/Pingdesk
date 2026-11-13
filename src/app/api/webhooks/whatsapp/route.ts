import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const expected = process.env.META_WA_VERIFY_TOKEN;
  if (p.get("hub.mode") === "subscribe" && expected && p.get("hub.verify_token") === expected && p.get("hub.challenge")) {
    return new NextResponse(p.get("hub.challenge"), { status: 200 });
  }
  return NextResponse.json({ error: "Webhook verification failed." }, { status: 403 });
}

type Status = { id?: string; status?: string; timestamp?: string; errors?: { code?: number; title?: string }[]; pricing?: { category?: string; billable?: boolean } };
type Inbound = { from?: string; type?: string; text?: { body?: string }; button?: { text?: string } };
type Payload = { entry?: { changes?: { value?: { statuses?: Status[]; messages?: Inbound[] } }[] }[] };

const STOP = /^(stop|unsubscribe|cancel|end|quit|stop all)$/i;
const START = /^(start|unstop|resume|subscribe)$/i;

export async function POST(req: NextRequest) {
  const raw = await req.text(), signature = req.headers.get("x-hub-signature-256"), secret = process.env.META_WA_APP_SECRET;
  if (!signature || !secret) return NextResponse.json({ error: "Webhook signature configuration missing." }, { status: 401 });
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });

  let payload: Payload;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "Bad JSON." }, { status: 400 }); }
  const values = payload.entry?.flatMap((e) => e.changes ?? []).map((c) => c.value ?? {}) ?? [];

  for (const s of values.flatMap((v) => v.statuses ?? [])) {
    if (!s.id || !s.status) continue;
    // apply_delivery_status only ever moves a delivery forward, so repeats and out-of-order events are safe.
    await supabaseAdmin.rpc("apply_delivery_status", {
      p_provider_message_id: s.id, p_status: s.status,
      p_at: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString(),
      p_error_code: s.errors?.[0]?.code?.toString() ?? null, p_error_title: s.errors?.[0]?.title ?? null,
      p_pricing_category: s.pricing?.category ?? null, p_billable: s.pricing?.billable ?? null, p_retry_at: null,
    });
  }

  // Replies of STOP / START turn alerts off and back on for that number.
  for (const m of values.flatMap((v) => v.messages ?? [])) {
    if (!m.from) continue;
    const body = (m.text?.body ?? m.button?.text ?? "").trim();
    const action = STOP.test(body) ? "stop" : START.test(body) ? "start" : "other";
    await supabaseAdmin.rpc("whatsapp_inbound", { p_phone: `+${m.from.replace(/\D/g, "")}`, p_action: action });
  }
  return NextResponse.json({ received: true });
}
