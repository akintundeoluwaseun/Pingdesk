import type { AlertCategory } from "@/lib/email/categories";
import { cleanParam, type MetaError, type TemplateComponent } from "@/lib/whatsapp/meta";

export type ClaimedNotification = {
  id: string;
  user_id: string;
  category: AlertCategory;
  inbox_label: string;
  received_at: string;
  delivery_attempts: number;
  timezone: string;
  alerts_paused: boolean;
  category_enabled: boolean;
  phone_e164: string | null;
  whatsapp_status: string | null;
  sent_last_hour: number;
};

export const POLICY = {
  maxAttempts: 6,
  /** Don't alert about mail older than this (e.g. backlog found on first connect). */
  staleAfterMs: 6 * 3600_000,
  /** Per-user cap to bound cost if something goes wrong upstream. */
  maxPerUserPerHour: 30,
};

export type Decision =
  | { action: "skip"; reason: "paused" | "preference_off" | "no_whatsapp" | "stale" }
  | { action: "defer"; until: Date }
  | { action: "send"; to: string; components: TemplateComponent[] };

const ALERT_TITLE: Record<AlertCategory, string> = {
  buyer_message: "New buyer message",
  new_order: "New order",
  order_update: "Order update",
  payment: "Payment update",
  policy: "Policy notice",
  account_security: "Security alert",
  general: "Fiverr update",
  unclassified: "Fiverr notification",
};

export function formatAlertTime(iso: string, timeZone: string): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz, timeZoneName: "short" }).format(new Date(iso));
  try {
    return fmt(timeZone);
  } catch {
    return fmt("UTC");
  }
}

/**
 * Alert template variables — metadata only:
 *   {{1}} what happened ("New buyer message")
 *   {{2}} which inbox (user's own label)
 *   {{3}} when (user's time zone)
 * No subject lines, buyer names or message contents are ever sent.
 */
export function alertComponents(n: Pick<ClaimedNotification, "category" | "inbox_label" | "received_at" | "timezone">): TemplateComponent[] {
  return [
    {
      type: "body",
      parameters: [
        { type: "text", text: ALERT_TITLE[n.category] },
        { type: "text", text: cleanParam(n.inbox_label, 60) },
        { type: "text", text: cleanParam(formatAlertTime(n.received_at, n.timezone), 40) },
      ],
    },
  ];
}

export function decide(n: ClaimedNotification, now: Date = new Date()): Decision {
  if (n.alerts_paused) return { action: "skip", reason: "paused" };
  if (!n.category_enabled) return { action: "skip", reason: "preference_off" };
  if (n.whatsapp_status !== "verified" || !n.phone_e164) return { action: "skip", reason: "no_whatsapp" };
  if (now.getTime() - new Date(n.received_at).getTime() > POLICY.staleAfterMs) return { action: "skip", reason: "stale" };
  if (n.sent_last_hour >= POLICY.maxPerUserPerHour) return { action: "defer", until: new Date(now.getTime() + 15 * 60_000) };
  return { action: "send", to: n.phone_e164, components: alertComponents(n) };
}

/** Exponential backoff with jitter: ~1, 2, 4, 8, 16 min … capped at 6 h. */
export function retryAt(attempt: number, now: Date = new Date(), random = Math.random): Date {
  const base = Math.min(6 * 3600_000, 60_000 * 2 ** Math.max(0, attempt - 1));
  return new Date(now.getTime() + base + Math.floor(random() * base * 0.2));
}

export function failureOutcome(err: MetaError, attemptNumber: number, now: Date = new Date()) {
  if (err.retryable && attemptNumber < POLICY.maxAttempts) return { outcome: "retry" as const, retryAt: retryAt(attemptNumber, now) };
  return { outcome: "failed" as const, retryAt: null };
}
