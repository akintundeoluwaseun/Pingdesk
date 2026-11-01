import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { CATEGORIES, type AlertCategory } from "@/lib/email/classify";
import type {
  Inbox,
  NotificationRow,
  NotificationStatus,
  Preferences,
  Profile,
  WhatsAppConnection,
} from "@/lib/db/types";

/**
 * All dashboard reads go through the user's own session, so Row Level
 * Security guarantees users only ever see their own rows.
 */
export class QueryError extends Error {}

function check<T>(res: { data: T; error: { code?: string; message: string } | null }, what: string): T {
  if (res.error) throw new QueryError(`Could not load ${what} (${res.error.code ?? "db"}).`);
  return res.data;
}

const INBOX_COLUMNS = "id,email_address,label,status,last_synced_at,last_error_code,connected_at,disconnected_at";
const NOTIFICATION_COLUMNS = "id,category,inbox_label,subject,received_at,status,skip_reason";

export async function getOverview() {
  const db = await supabaseServer();
  const count = (status?: NotificationStatus) => {
    let q = db.from("notifications").select("id", { count: "exact", head: true });
    if (status) q = q.eq("status", status);
    return q;
  };
  const [total, delivered, failed, inboxes, whatsapp, recent] = await Promise.all([
    count(),
    count("delivered"),
    count("failed"),
    db.from("connected_inboxes").select(INBOX_COLUMNS).neq("status", "disconnected").order("connected_at"),
    db.from("whatsapp_connections").select("phone_e164,status,verified_at,opted_in_at").maybeSingle(),
    db.from("notifications").select(NOTIFICATION_COLUMNS).order("received_at", { ascending: false }).limit(6),
  ]);
  for (const r of [total, delivered, failed]) if (r.error) throw new QueryError("Could not load alert totals.");
  return {
    totals: { total: total.count ?? 0, delivered: delivered.count ?? 0, failed: failed.count ?? 0 },
    inboxes: check(inboxes, "inboxes") as Inbox[],
    whatsapp: check(whatsapp, "WhatsApp status") as WhatsAppConnection | null,
    recent: check(recent, "recent alerts") as NotificationRow[],
  };
}

export async function listInboxes() {
  const db = await supabaseServer();
  return check(await db.from("connected_inboxes").select(INBOX_COLUMNS).order("connected_at"), "inboxes") as Inbox[];
}

export async function getWhatsApp() {
  const db = await supabaseServer();
  return check(
    await db.from("whatsapp_connections").select("phone_e164,status,verified_at,opted_in_at").maybeSingle(),
    "WhatsApp status",
  ) as WhatsAppConnection | null;
}

export const HISTORY_PAGE_SIZE = 25;
const STATUSES: NotificationStatus[] = ["received", "queued", "delivering", "delivered", "failed", "skipped"];

export function parseHistoryFilters(sp: Record<string, string | undefined>) {
  const category = CATEGORIES.includes(sp.category as AlertCategory) ? (sp.category as AlertCategory) : undefined;
  const status = STATUSES.includes(sp.status as NotificationStatus) ? (sp.status as NotificationStatus) : undefined;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(sp.page ?? "1", 10) || 1));
  return { category, status, page };
}

export async function listHistory(filters: ReturnType<typeof parseHistoryFilters>) {
  const db = await supabaseServer();
  const from = (filters.page - 1) * HISTORY_PAGE_SIZE;
  let q = db
    .from("notifications")
    .select(NOTIFICATION_COLUMNS, { count: "exact" })
    .order("received_at", { ascending: false })
    .range(from, from + HISTORY_PAGE_SIZE - 1);
  if (filters.category) q = q.eq("category", filters.category);
  if (filters.status) q = q.eq("status", filters.status);
  const res = await q;
  const rows = check(res, "notification history") as NotificationRow[];
  return { rows, total: res.count ?? 0 };
}

export async function getPreferences() {
  const db = await supabaseServer();
  return check(
    await db
      .from("notification_preferences")
      .select(["alerts_paused", ...CATEGORIES].join(","))
      .maybeSingle(),
    "preferences",
  ) as Preferences | null;
}

export async function getProfile() {
  const db = await supabaseServer();
  return check(await db.from("profiles").select("full_name,timezone").maybeSingle(), "profile") as Profile | null;
}
