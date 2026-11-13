import { supabaseAdmin } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/security/crypto";
import { errorCode, gmailClient, getMessageMetadata, isInvalidGrant, listAddedMessageIdsSince, listMessageIdsSince } from "@/lib/google/gmail";
import { authEvidence, classifyFiverrEmail, senderDomain } from "@/lib/email/classify";
import { fingerprint } from "./fingerprint";

const FIRST_SYNC_LOOKBACK_S = 60 * 60 * 24;

/** Row shape returned by the claim_inboxes_for_sync() database function. */
type ClaimedInbox = { id: string; user_id: string; label: string; email_address: string; last_history_id: string | null; encrypted_refresh_token: string };

export async function syncInbox(inbox: ClaimedInbox) {
  let latestHistoryId: string | null = null;
  try {
    const gmail = gmailClient(decryptSecret(inbox.encrypted_refresh_token));
    // Read the current historyId first so nothing that arrives during this run is skipped next time.
    const profile = await gmail.users.getProfile({ userId: "me" });
    latestHistoryId = profile.data.historyId ?? null;

    let ids = inbox.last_history_id ? await listAddedMessageIdsSince(gmail, inbox.last_history_id) : null;
    const reconciled = ids === null;
    if (ids === null) ids = await listMessageIdsSince(gmail, Math.floor(Date.now() / 1000) - FIRST_SYNC_LOOKBACK_S);

    let created = 0;
    for (const id of ids) {
      const meta = await getMessageMetadata(gmail, id);
      if (meta.labelIds.includes("SENT") || meta.labelIds.includes("SPAM")) continue;
      const category = classifyFiverrEmail(meta);
      if (!category) continue;
      const domain = senderDomain(meta.from);
      const { error } = await supabaseAdmin.from("notifications").insert({
        user_id: inbox.user_id, inbox_id: inbox.id, gmail_message_id: id, gmail_thread_id: meta.threadId,
        category, inbox_label: inbox.label, sender_domain: domain, subject: meta.subject.slice(0, 300) || null,
        auth_evidence: authEvidence(meta.authResults, domain),
        received_at: meta.internalDate ?? new Date().toISOString(),
        fingerprint: fingerprint(inbox.id, id), status: "queued",
      });
      if (!error) created++;
      else if (error.code !== "23505") throw error; // 23505 = already stored
    }

    await supabaseAdmin.rpc("finish_inbox_sync", { p_inbox_id: inbox.id, p_history_id: latestHistoryId, p_reconciled: reconciled, p_error_code: null, p_needs_reauth: false });
    return { inbox: inbox.email_address, scanned: ids.length, created };
  } catch (e) {
    const code = errorCode(e);
    // On a non-auth error keep the old historyId so the next run retries the same window.
    await supabaseAdmin.rpc("finish_inbox_sync", { p_inbox_id: inbox.id, p_history_id: null, p_reconciled: false, p_error_code: code, p_needs_reauth: isInvalidGrant(e) });
    return { inbox: inbox.email_address, error: code };
  }
}

/** Leases due inboxes in the database (so overlapping runs never sync the same inbox) and syncs them. */
export async function syncAllInboxes(limit = 10) {
  const { data, error } = await supabaseAdmin.rpc("claim_inboxes_for_sync", { p_limit: limit, p_lease_seconds: 120, p_min_interval_seconds: 60 });
  if (error) throw new Error(`Could not claim inboxes: ${error.message}`);
  const results = [];
  for (const inbox of (data ?? []) as ClaimedInbox[]) results.push(await syncInbox(inbox));
  return results;
}
