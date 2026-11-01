import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

/**
 * Meta WhatsApp Cloud API webhook: verification handshake + delivery statuses.
 * Phase 3 extends this with inbound opt-in/opt-out messages, the 24-hour
 * window, pricing/usage capture and replay protection.
 */
export const runtime = "nodejs";

const RANK: Record<string, number> = { pending: 0, submitted: 1, sent: 2, delivered: 3, read: 4, failed: 5 };

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
  if (ok && challenge) return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  return NextResponse.json({ error: "Webhook verification failed." }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const secret = process.env.META_WA_APP_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: { entry?: { changes?: { value?: { statuses?: StatusEvent[] } }[] }[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const statuses = (payload.entry ?? []).flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.statuses ?? []);
  const db = supabaseAdmin();
  for (const s of statuses) {
    if (!s.id || !(s.status in RANK)) continue;
    const { data: row } = await db.from("delivery_logs").select("id,status").eq("provider_message_id", s.id).maybeSingle();
    if (!row) continue;
    // Statuses can arrive out of order; never move backwards (e.g. read -> delivered).
    if (RANK[s.status] <= RANK[row.status as string] && s.status !== "failed") continue;
    const at = s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString();
    const update: Record<string, unknown> = { status: s.status, [`${s.status}_at`]: at };
    if (s.status === "failed") {
      update.error_code = s.errors?.[0]?.code?.toString() ?? null;
      update.error_title = s.errors?.[0]?.title?.slice(0, 200) ?? null;
    }
    if (s.pricing) {
      update.pricing_category = s.pricing.category ?? null;
      update.billable = s.pricing.billable ?? null;
    }
    const { error } = await db.from("delivery_logs").update(update).eq("id", row.id);
    if (error) log.error("whatsapp.status_update_failed", { delivery_log_id: row.id, error_code: error.code });
  }
  return NextResponse.json({ received: true });
}

type StatusEvent = {
  id?: string;
  status: string;
  timestamp?: string;
  errors?: { code?: number; title?: string }[];
  pricing?: { category?: string; billable?: boolean };
};
