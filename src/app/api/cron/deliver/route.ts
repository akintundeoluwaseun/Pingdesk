import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/auth/cron";
import { deliverQueued } from "@/lib/notifications/deliver";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function run(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ delivered: await deliverQueued() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Run failed" }, { status: 500 });
  }
}
export const GET = run;
export const POST = run;
