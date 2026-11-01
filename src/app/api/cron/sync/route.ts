import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runGmailSync } from "@/server/gmail/run";
import { runDelivery } from "@/server/delivery/run";
import { isConfigured } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Scheduler entry point: Gmail sync, then WhatsApp delivery. Call every 1–5 minutes with
 * `Authorization: Bearer $INTERNAL_CRON_SECRET` (GET or POST, so it works with
 * Vercel Cron, GitHub Actions, Supabase pg_cron + pg_net, or any free pinger).
 * Phase 4 moves the per-inbox work onto the durable job queue.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: NextRequest) {
  const secret = process.env.INTERNAL_CRON_SECRET;
  if (!secret || secret.length < 32) return false;
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const out: Record<string, unknown> = {};
  let failed = false;
  if (isConfigured("google")) {
    try {
      out.sync = await runGmailSync({ budgetMs: 30_000 });
    } catch (err) {
      failed = true;
      log.error("gmail.sync_run_failed", { error: err });
      out.sync = { error: "Sync run failed." };
    }
  } else out.sync = { skipped: "Google OAuth is not configured." };

  if (isConfigured("whatsapp")) {
    try {
      out.delivery = await runDelivery({ budgetMs: 20_000 });
    } catch (err) {
      failed = true;
      log.error("delivery.run_failed", { error: err });
      out.delivery = { error: "Delivery run failed." };
    }
  } else out.delivery = { skipped: "WhatsApp Cloud API is not configured." };

  return NextResponse.json(out, { status: failed ? 500 : 200 });
}

export const GET = handle;
export const POST = handle;
