import { supabaseAdmin } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/security/crypto";
import { gmailClient, getMessageMetadata, isInvalidGrant, listAddedMessageIdsSince, listMessageIdsSince } from "@/lib/google/gmail";
import { classifyFiverrEmail } from "@/lib/email/classify";
import { fingerprint } from "./fingerprint";

const FIRST_SYNC_LOOKBACK_S = 60 * 60 * 24;

type Inbox = { id: string; user_id: string; email_address: string; encrypted_refresh_token: string; last_history_id: string | null };

export async function syncInbox(inbox: Inbox) {
  const gmail = gmailClient(decryptSecret(inbox.encrypted_refresh_token));
  try {
    // Read the current historyId first so nothing that arrives during this run is skipped next time.
    const profile = await gmail.users.getProfile({ userId: "me" });
    const latestHistoryId = profile.data.historyId ?? null;

    let ids = inbox.last_history_id ? await listAddedMessageIdsSince(gmail, inbox.last_history_id) : null;
    if (ids === null) ids = await listMessageIdsSince(gmail, Math.floor(Date.now() / 1000) - FIRST_SYNC_LOOKBACK_S);

    let created = 0;
    for (const id of ids) {
      const meta = await getMessageMetadata(gmail, id);
      if (meta.labelIds.includes("SENT") || meta.labelIds.includes("SPAM")) continue;
      const category = classifyFiverrEmail(meta);
      if (!category) continue;
      const { error } = await supabaseAdmin.from("notifications").insert({
        user_id: inbox.user_id, inbox_id: inbox.id, source_message_id: id, category,
        subject: meta.subject.slice(0, 300), received_at: meta.internalDate,
        fingerprint: fingerprint(inbox.id, id), processing_status: "queued",
      });
      if (!error) created++;
      else if (error.code !== "23505") throw error; // 23505 = already stored
    }

    await supabaseAdmin.from("connected_inboxes")
      .update({ last_history_id: latestHistoryId, last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", inbox.id);
    return { inbox: inbox.email_address, scanned: ids.length, created };
  } catch (e) {
    const reauth = isInvalidGrant(e);
    const message = reauth ? "Google access was revoked or expired. Reconnect Gmail." : e instanceof Error ? e.message : "Sync failed";
    await supabaseAdmin.from("connected_inboxes")
      .update({ ...(reauth ? { status: "needs_reauth" } : {}), last_error: message.slice(0, 500) })
      .eq("id", inbox.id);
    return { inbox: inbox.email_address, error: message };
  }
}

export async function syncAllInboxes(limit = 50) {
  const { data, error } = await supabaseAdmin
    .from("connected_inboxes")
    .select("id,user_id,email_address,encrypted_refresh_token,last_history_id")
    .eq("status", "active")
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error("Could not load inboxes.");
  const results = [];
  for (const inbox of data ?? []) results.push(await syncInbox(inbox));
  return results;
}
