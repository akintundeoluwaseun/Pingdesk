import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

/** Accepts INTERNAL_CRON_SECRET, or CRON_SECRET (what Vercel Cron sends), as a Bearer token. */
export function cronAuthorized(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  return [process.env.INTERNAL_CRON_SECRET, process.env.CRON_SECRET].some((s) => {
    if (!s) return false;
    const a = Buffer.from(header), b = Buffer.from(`Bearer ${s}`);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
