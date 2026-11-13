import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/auth/cron";
import { syncAllInboxes } from "@/lib/notifications/sync";
import { deliverQueued } from "@/lib/notifications/deliver";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Checks every active inbox for new Fiverr emails, then sends any alerts that are due. */
async function run(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const synced = await syncAllInboxes();
    const delivered = await deliverQueued();
    return NextResponse.json({ synced, delivered });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Run failed" }, { status: 500 });
  }
}
export const GET = run;
export const POST = run;
