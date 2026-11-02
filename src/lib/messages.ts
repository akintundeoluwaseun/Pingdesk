/** Plain-language explanations shown to users. */

export const SKIP_REASONS: Record<string, string> = {
  preference_off: "this category is turned off in Preferences",
  paused: "alerts were paused",
  no_whatsapp: "no verified WhatsApp number (or you replied STOP)",
  stale: "the email was more than 6 hours old when PingDesk found it",
  unclassified: "it wasn't a recognised notification",
};

const DELIVERY_ERRORS: Record<string, string> = {
  "131026": "WhatsApp couldn't deliver to this number (not on WhatsApp, outdated app, or blocked)",
  "131030": "the number isn't on the sender's test list yet",
  "131047": "the 24-hour reply window had closed",
  "131049": "WhatsApp limited messages to this number for now",
  "131050": "you've stopped business messages from this sender",
  "130429": "WhatsApp was rate-limiting messages",
  "131056": "too many messages to this number in a short time",
  "131000": "a temporary WhatsApp error",
  "131016": "WhatsApp was temporarily unavailable",
  "190": "a PingDesk configuration problem (our side)",
  "132001": "a PingDesk configuration problem (our side)",
};

export function describeDeliveryError(code: string | null, title: string | null): string {
  if (code && DELIVERY_ERRORS[code]) return DELIVERY_ERRORS[code];
  if (code?.startsWith("http_")) return "PingDesk couldn't reach WhatsApp";
  return title ? title.slice(0, 120) : "an unknown error";
}

export const INBOX_ERRORS: Record<string, string> = {
  auth_revoked: "Google access was revoked or expired.",
  insufficient_scope: "PingDesk no longer has permission to read this inbox.",
  rate_limited: "Google asked us to slow down. We'll keep trying automatically.",
  unavailable: "Gmail was temporarily unreachable. We'll keep trying automatically.",
  history_expired: "We had to re-scan recent mail. No action needed.",
  internal_error: "Something went wrong on our side. We'll keep trying automatically.",
  unknown: "An unexpected error occurred. We'll keep trying automatically.",
};

export const ACTIVITY_LABELS: Record<string, (d: Record<string, unknown>) => string> = {
  "inbox.connected": (d) => `Connected Gmail inbox${d.email ? ` ${d.email}` : ""}`,
  "inbox.disconnected": (d) => `Disconnected an inbox${d.google_access_revoked === false ? " (Google access could not be revoked automatically)" : ""}`,
  "inbox.removed": () => "Removed an inbox and its alert history",
  "inbox.renamed": (d) => `Renamed an inbox to “${d.inbox ?? ""}”`,
  "inbox.reauth_needed": (d) => `${d.inbox ?? "An inbox"} needs reconnecting — Google access stopped working`,
  "inbox.sync_requested": () => "Requested an immediate inbox check",
  "whatsapp.code_sent": (d) => `Verification code sent to WhatsApp${d.number_ending ? ` ending ${d.number_ending}` : ""}`,
  "whatsapp.verified": () => "Verified WhatsApp number",
  "whatsapp.removed": () => "Removed WhatsApp number",
  "whatsapp.opted_out": () => "Replied STOP — WhatsApp alerts paused",
  "whatsapp.opted_in": () => "Replied START — WhatsApp alerts resumed",
  "whatsapp.test_sent": () => "Sent a test alert",
  "preferences.updated": (d) => (d.paused ? "Paused all alerts" : `Updated alert preferences (${d.categories_on ?? "?"} categories on)`),
  "profile.updated": (d) => (d.retention_days ? `Set alert history retention to ${d.retention_days} days` : "Updated profile"),
  "account.password_changed": () => "Changed password",
};
