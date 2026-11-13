// Categories match the notifications.category check constraint in Supabase.
export type AlertCategory = "buyer_message" | "new_order" | "order_update" | "payment" | "policy" | "account_security" | "general" | "unclassified";
export type Candidate = { from: string; subject: string; authResults?: string };
export type AuthEvidence = { dkim: boolean; dmarc: boolean; spf: boolean; header: boolean };

function verifiedDomains() {
  return (process.env.FIVERR_VERIFIED_SENDER_DOMAINS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
}

export function senderDomain(from: string) {
  const address = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  return address.split("@")[1] ?? "";
}

export function authEvidence(authResults: string | undefined, domain: string): AuthEvidence {
  const r = (authResults ?? "").toLowerCase();
  const d = domain.replace(/\./g, "\\.");
  return {
    header: Boolean(authResults),
    dmarc: /dmarc=pass/.test(r),
    dkim: new RegExp(`dkim=pass[^;]*header\\.(?:i|d)=@?(?:[a-z0-9.-]+\\.)?${d}`).test(r),
    spf: /spf=pass/.test(r),
  };
}

/**
 * Gmail adds an Authentication-Results header. When present, require DKIM or DMARC to pass
 * for the sender's domain so a spoofed "From" line can't trigger alerts.
 */
export function passesAuth(authResults: string | undefined, domain: string) {
  const e = authEvidence(authResults, domain);
  return !e.header || e.dmarc || e.dkim;
}

export function isVerifiedSender(from: string) {
  const domain = senderDomain(from);
  return Boolean(domain) && verifiedDomains().some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function categorize(subject: string): AlertCategory {
  const s = subject.toLowerCase();
  if (/security|password|log ?in|sign[- ]?in|verification code|verify your|two-factor|2fa/.test(s)) return "account_security";
  if (/policy|terms of service|account warning|violation|restricted|suspended/.test(s)) return "policy";
  if (/payment|withdraw|earning|payout|funds|cleared|tip/.test(s)) return "payment";
  if (/new order|received an order|placed an order|you've got an order|order from/.test(s)) return "new_order";
  if (/order|delivery|delivered|revision|requirements|extension|cancel|dispute|review/.test(s)) return "order_update";
  if (/message|inbox|replied|sent you|contacted you|brief/.test(s)) return "buyer_message";
  if (/newsletter|tips for|webinar|% off|discover|introducing|level|update to/.test(s)) return "general";
  return "unclassified";
}

export function classifyFiverrEmail(input: Candidate): AlertCategory | null {
  if (!isVerifiedSender(input.from)) return null;
  if (!passesAuth(input.authResults, senderDomain(input.from))) return null;
  return categorize(input.subject);
}

export const CATEGORY_LABEL: Record<AlertCategory, string> = {
  buyer_message: "Buyer message",
  new_order: "New order",
  order_update: "Order update",
  payment: "Payment",
  policy: "Policy notice",
  account_security: "Security alert",
  general: "Fiverr news",
  unclassified: "Other Fiverr email",
};

export const CATEGORY_HINT: Record<AlertCategory, string> = {
  buyer_message: "Someone sent you a message",
  new_order: "A buyer placed an order",
  order_update: "Deliveries, revisions, reviews, cancellations",
  payment: "Earnings cleared, withdrawals, tips",
  policy: "Warnings and terms changes",
  account_security: "Logins, passwords and verification",
  general: "Newsletters and announcements",
  unclassified: "Fiverr emails that don't fit the others",
};
