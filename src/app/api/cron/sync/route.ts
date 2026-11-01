import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/security/crypto";
import { listRecentMessageIds, getMessageMetadata } from "@/lib/google/gmail";
import { classifyFiverrEmail, senderDomain } from "@/lib/email/classify";
import { fingerprint } from "@/lib/notifications/fingerprint";
import { log } from "@/lib/log";

/**
 * INTERIM pilot sync (24-hour lookback, de-duplicated by unique constraints).
 * Phase 2 replaces this with historyId-based incremental sync + reconciliation,
 * and Phase 4 moves the work onto the durable job queue.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: NextRequest) {
  const secret = process.env.INTERNAL_CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || secret.length < 32) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

type InboxRow = {
  id: string;
  user_id: string;
  label: string;
  inbox_credentials: { encrypted_refresh_token: string } | null;
};

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("connected_inboxes")
    .select("id,user_id,label,inbox_credentials(encrypted_refresh_token)")
    .eq("status", "active")
    .limit(50);
  if (error) {
    log.error("sync.load_failed", { error_code: error.code });
    return NextResponse.json({ error: "Could not load inboxes." }, { status: 500 });
  }

  const results: { inbox_id: string; created?: number; error?: string }[] = [];
  for (const inbox of (data ?? []) as unknown as InboxRow[]) {
    const cipher = inbox.inbox_credentials?.encrypted_refresh_token;
    if (!cipher) continue;
    try {
      const refresh = decryptSecret(cipher);
      const ids = await listRecentMessageIds(refresh, Math.floor(Date.now() / 1000) - 60 * 60 * 24);
      let created = 0;
      for (const item of ids) {
        if (!item.id) continue;
        const meta = await getMessageMetadata(refresh, item.id);
        const category = classifyFiverrEmail({ from: meta.from, subject: meta.subject });
        if (!category) continue;
        const received = meta.internalDate ? new Date(Number(meta.internalDate)) : new Date();
        const { error: insertError } = await db.from("notifications").insert({
          user_id: inbox.user_id,
          inbox_id: inbox.id,
          gmail_message_id: item.id,
          gmail_thread_id: item.threadId ?? null,
          category,
          inbox_label: inbox.label,
          sender_domain: senderDomain(meta.from),
          subject: meta.subject.slice(0, 300) || null,
          received_at: received.toISOString(),
          fingerprint: fingerprint(inbox.id, item.id),
        });
        if (!insertError) created++;
        else if (insertError.code !== "23505") throw new Error(`insert failed: ${insertError.code}`);
      }
      await db.from("connected_inboxes").update({ last_synced_at: new Date().toISOString() }).eq("id", inbox.id);
      results.push({ inbox_id: inbox.id, created });
    } catch (e) {
      log.error("sync.inbox_failed", { inbox_id: inbox.id, error: e });
      results.push({ inbox_id: inbox.id, error: "sync failed" });
    }
  }
  return NextResponse.json({ processed: results.length, results });
}
