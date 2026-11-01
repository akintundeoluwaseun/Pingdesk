"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser, supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/security/crypto";
import { revokeGoogleToken } from "@/lib/google/oauth";
import { CATEGORIES } from "@/lib/email/classify";
import { log } from "@/lib/log";

export type ActionState = { error?: string; message?: string };

const uuid = z.uuid();

export async function renameInbox(_: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = z
    .object({ inboxId: uuid, label: z.string().trim().min(1, "Give the inbox a name.").max(60, "Keep it under 60 characters.") })
    .safeParse({ inboxId: form.get("inboxId"), label: form.get("label") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const db = await supabaseServer();
  const { data, error } = await db
    .from("connected_inboxes")
    .update({ label: parsed.data.label })
    .eq("id", parsed.data.inboxId)
    .select("id");
  if (error || !data?.length) return { error: "We couldn't rename that inbox. Refresh the page and try again." };
  revalidatePath("/dashboard", "layout");
  return { message: "Saved." };
}

/** Revokes Google's grant first (best effort), then deletes our stored credentials. */
async function revokeInboxCredentials(userId: string, inboxId?: string) {
  const admin = supabaseAdmin();
  let q = admin.from("inbox_credentials").select("inbox_id,encrypted_refresh_token").eq("user_id", userId);
  if (inboxId) q = q.eq("inbox_id", inboxId);
  const { data, error } = await q;
  if (error) throw new Error(`load credentials failed: ${error.code}`);
  let allRevoked = true;
  for (const row of data ?? []) {
    let ok = false;
    try {
      ok = await revokeGoogleToken(decryptSecret(row.encrypted_refresh_token));
    } catch (e) {
      log.error("gmail.revoke_decrypt_failed", { inbox_id: row.inbox_id, error: e });
    }
    if (!ok) allRevoked = false;
  }
  return allRevoked;
}

export async function disconnectInbox(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = z
    .object({ inboxId: uuid, deleteHistory: z.enum(["on"]).optional() })
    .safeParse({ inboxId: form.get("inboxId"), deleteHistory: form.get("deleteHistory") ?? undefined });
  if (!parsed.success) return { error: "That inbox could not be found." };

  try {
    const revoked = await revokeInboxCredentials(user.id, parsed.data.inboxId);
    const { data: ok, error } = await supabaseAdmin().rpc("disconnect_inbox", {
      p_user_id: user.id,
      p_inbox_id: parsed.data.inboxId,
      p_delete_history: parsed.data.deleteHistory === "on",
    });
    if (error) throw new Error(`disconnect_inbox failed: ${error.code}`);
    if (!ok) return { error: "That inbox could not be found." };
    log.info("gmail.disconnected", { user_id: user.id, inbox_id: parsed.data.inboxId, revoked });
    revalidatePath("/dashboard", "layout");
    return {
      message: revoked
        ? "Inbox disconnected and Google access revoked."
        : "Inbox disconnected. We couldn't reach Google to revoke access — remove PingDesk at myaccount.google.com/permissions to be sure.",
    };
  } catch (e) {
    log.error("gmail.disconnect_failed", { user_id: user.id, error: e });
    return { error: "We couldn't disconnect that inbox. Try again in a moment." };
  }
}

export async function savePreferences(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const update: Record<string, boolean> = { alerts_paused: form.get("alerts_paused") === "on" };
  for (const c of CATEGORIES) update[c] = form.get(c) === "on";
  const db = await supabaseServer();
  const { data, error } = await db.from("notification_preferences").update(update).eq("user_id", user.id).select("user_id");
  if (error || !data?.length) return { error: "We couldn't save your preferences. Try again." };
  revalidatePath("/dashboard", "layout");
  return { message: "Preferences saved." };
}

const TIMEZONES = new Set(Intl.supportedValuesOf("timeZone").concat("UTC"));

export async function saveProfile(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = z
    .object({
      fullName: z.string().trim().min(1, "Enter your name.").max(120),
      timezone: z.string().refine((tz) => TIMEZONES.has(tz), "Choose a time zone from the list."),
    })
    .safeParse({ fullName: form.get("fullName"), timezone: form.get("timezone") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const db = await supabaseServer();
  const { data, error } = await db
    .from("profiles")
    .update({ full_name: parsed.data.fullName, timezone: parsed.data.timezone })
    .eq("id", user.id)
    .select("id");
  if (error || !data?.length) return { error: "We couldn't save your profile. Try again." };
  revalidatePath("/dashboard", "layout");
  return { message: "Profile saved." };
}

export async function deleteAccount(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const typed = String(form.get("confirmEmail") ?? "").trim().toLowerCase();
  if (!user.email || typed !== user.email.toLowerCase()) {
    return { error: "Type your account email exactly to confirm." };
  }
  try {
    await revokeInboxCredentials(user.id);
    const { error } = await supabaseAdmin().auth.admin.deleteUser(user.id);
    if (error) throw new Error(`delete user failed: ${error.code ?? error.status}`);
    log.info("account.deleted", { user_id: user.id });
  } catch (e) {
    log.error("account.delete_failed", { user_id: user.id, error: e });
    return { error: "We couldn't delete your account. Try again in a moment. Gmail access may already be revoked, so you might need to reconnect inboxes if you keep the account." };
  }
  const db = await supabaseServer();
  await db.auth.signOut();
  redirect("/?account=deleted");
}
