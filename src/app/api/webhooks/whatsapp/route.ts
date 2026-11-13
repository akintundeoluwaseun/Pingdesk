import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const RANK: Record<string, number> = { queued: 0, submitted: 1, sent: 2, delivered: 3, read: 4 };

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const expected = process.env.META_WA_VERIFY_TOKEN;
  if (p.get("hub.mode") === "subscribe" && expected && p.get("hub.verify_token") === expected && p.get("hub.challenge")) {
    return new NextResponse(p.get("hub.challenge"), { status: 200 });
  }
  return NextResponse.json({ error: "Webhook verification failed." }, { status: 403 });
}

type Status = { id?: string; status?: string; timestamp?: string; errors?: { code?: number; title?: string }[] };

export async function POST(req: NextRequest) {
  const raw = await req.text(), signature = req.headers.get("x-hub-signature-256"), secret = process.env.META_WA_APP_SECRET;
  if (!signature || !secret) return NextResponse.json({ error: "Webhook signature configuration missing." }, { status: 401 });
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });

  let payload: { entry?: { changes?: { value?: { statuses?: Status[] } }[] }[] };
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "Bad JSON." }, { status: 400 }); }
  const statuses = payload.entry?.flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.statuses ?? []) ?? [];

  for (const s of statuses) {
    if (!s.id || !s.status) continue;
    const { data: log } = await supabaseAdmin.from("delivery_logs").select("id,delivery_status").eq("provider_message_id", s.id).maybeSingle();
    if (!log) continue;
    const at = s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString();
    if (s.status === "failed") {
      await supabaseAdmin.from("delivery_logs").update({ delivery_status: "failed", error_code: s.errors?.[0]?.code?.toString() ?? null, error_message: s.errors?.[0]?.title ?? null }).eq("id", log.id);
      continue;
    }
    // Meta can send statuses out of order (or twice); only ever move forward.
    if (!(s.status in RANK) || (RANK[log.delivery_status] ?? -1) >= RANK[s.status]) continue;
    await supabaseAdmin.from("delivery_logs").update({ delivery_status: s.status, ...(s.status === "delivered" ? { delivered_at: at } : {}) }).eq("id", log.id);
    // A "read" can arrive without a "delivered" first: reading implies delivery.
    if (s.status === "read") await supabaseAdmin.from("delivery_logs").update({ delivered_at: at }).eq("id", log.id).is("delivered_at", null);
  }
  return NextResponse.json({ received: true });
}
