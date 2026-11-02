import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Operator status (aggregate counts only, no personal data).
 * `Authorization: Bearer $OPS_STATUS_SECRET` (falls back to INTERNAL_CRON_SECRET).
 * Returns 503 when the system looks unhealthy, so an uptime monitor can alert.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest) {
  const secret = process.env.OPS_STATUS_SECRET || process.env.INTERNAL_CRON_SECRET;
  if (!secret || secret.length < 32) return false;
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Ops = { queue: { oldest_due_seconds: number; expired_leases: number; dead_24h: number }; last_sync_at: string | null };

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { data, error } = await supabaseAdmin().rpc("ops_status");
    if (error) throw new Error(`ops_status failed: ${error.code}`);
    const ops = data as Ops & Record<string, unknown>;
    const problems: string[] = [];
    if (ops.queue.oldest_due_seconds > 600) problems.push("queue backlog over 10 minutes (is the scheduler running?)");
    if (ops.queue.expired_leases > 0) problems.push("jobs with expired leases (worker crashes or timeouts)");
    if (ops.queue.dead_24h > 0) problems.push("dead jobs in the last 24 hours");
    const config = { google: isConfigured("google"), whatsapp: isConfigured("whatsapp") };
    return NextResponse.json({ healthy: problems.length === 0, problems, config, ...ops }, { status: problems.length ? 503 : 200 });
  } catch (err) {
    log.error("ops.status_failed", { error: err });
    return NextResponse.json({ healthy: false, problems: ["database unreachable"] }, { status: 503 });
  }
}
