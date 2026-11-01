/**
 * Conservative Fiverr notification classifier (interim).
 *
 * Sender domains are NOT hard-coded: they come from FIVERR_VERIFIED_SENDER_DOMAINS
 * and must be set only after inspecting real, authorized, redacted samples.
 * With the variable empty, nothing is classified — that is intentional.
 *
 * Phase 2 replaces the subject keywords below with configurable rules backed by
 * real sample fixtures, and adds SPF/DKIM/DMARC evidence checks.
 */
export const CATEGORIES = [
  "buyer_message",
  "new_order",
  "order_update",
  "payment",
  "policy",
  "account_security",
  "general",
  "unclassified",
] as const;
export type AlertCategory = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<AlertCategory, string> = {
  buyer_message: "Buyer message",
  new_order: "New order",
  order_update: "Order update",
  payment: "Payment",
  policy: "Policy",
  account_security: "Account security",
  general: "General",
  unclassified: "Unclassified",
};

export type Candidate = { from: string; subject: string };

export function verifiedDomains(): string[] {
  return (process.env.FIVERR_VERIFIED_SENDER_DOMAINS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

export function senderDomain(from: string): string | null {
  const address = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at < 1) return null;
  return address.slice(at + 1) || null;
}

/** Returns null when the email is not from a verified sender (ignore it). */
export function classifyFiverrEmail(input: Candidate, domains = verifiedDomains()): AlertCategory | null {
  const domain = senderDomain(input.from);
  if (!domain || !domains.some((d) => domain === d || domain.endsWith(`.${d}`))) return null;
  const s = input.subject.toLowerCase();
  if (/security|password|login|verification code|sign-in/.test(s)) return "account_security";
  if (/policy|terms of service|account warning/.test(s)) return "policy";
  if (/payment|withdrawal|earnings|funds/.test(s)) return "payment";
  if (/new order|order received|you've got an order/.test(s)) return "new_order";
  if (/order/.test(s)) return "order_update";
  if (/message|inbox/.test(s)) return "buyer_message";
  return "unclassified";
}
