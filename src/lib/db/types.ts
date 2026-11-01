import type { AlertCategory } from "@/lib/email/classify";

export type InboxStatus = "active" | "needs_reauth" | "disconnected" | "error";
export type NotificationStatus = "received" | "queued" | "delivering" | "delivered" | "failed" | "skipped";
export type WhatsAppStatus = "pending_verification" | "verified" | "opted_out";

export type Inbox = {
  id: string;
  email_address: string;
  label: string;
  status: InboxStatus;
  last_synced_at: string | null;
  last_error_code: string | null;
  connected_at: string;
  disconnected_at: string | null;
};

export type NotificationRow = {
  id: string;
  category: AlertCategory;
  inbox_label: string;
  subject: string | null;
  received_at: string;
  status: NotificationStatus;
  skip_reason: string | null;
};

export type Preferences = {
  alerts_paused: boolean;
} & Record<AlertCategory, boolean>;

export type WhatsAppConnection = {
  phone_e164: string;
  status: WhatsAppStatus;
  verified_at: string | null;
  opted_in_at: string | null;
};

export type Profile = { full_name: string | null; timezone: string };
