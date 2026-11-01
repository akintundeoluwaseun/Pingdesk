import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runGmailSync } from "@/server/gmail/run";
import { isConfigured } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Scheduler entry point for Gmail sync. Call every 1–5 minutes with
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
  if (!isConfigured("google")) return NextResponse.json({ error: "Google OAuth is not configured." }, { status: 503 });
  try {
    const summary = await runGmailSync({ budgetMs: 45_000 });
    return NextResponse.json(summary);
  } catch (err) {
    log.error("gmail.sync_run_failed", { error: err });
    return NextResponse.json({ error: "Sync run failed." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
