import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runTick } from "@/server/jobs/runtime";
import { log } from "@/lib/log";

/**
 * Scheduler tick. Call every minute (Supabase pg_cron + pg_net) or every few
 * minutes (GitHub Actions) with `Authorization: Bearer $INTERNAL_CRON_SECRET`.
 * Enqueues due Gmail syncs and daily maintenance, then works the job queue.
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

async function handleTick(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runTick(45_000));
  } catch (err) {
    log.error("tick.failed", { error: err });
    return NextResponse.json({ error: "Tick failed." }, { status: 500 });
  }
}

export const GET = handleTick;
export const POST = handleTick;
