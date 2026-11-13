export type AlertCategory = "buyer_message" | "order" | "payment" | "policy" | "security" | "other";
export type Candidate = { from: string; subject: string; authResults?: string };

function verifiedDomains() {
  return (process.env.FIVERR_VERIFIED_SENDER_DOMAINS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
}

export function senderDomain(from: string) {
  const address = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  return address.split("@")[1] ?? "";
}

/**
 * Gmail adds an Authentication-Results header. When present, require DKIM or DMARC to pass
 * for the sender's domain so a spoofed "From" line can't trigger alerts.
 */
export function passesAuth(authResults: string | undefined, domain: string) {
  if (!authResults) return true; // header missing: rely on Gmail's own spam filtering
  const r = authResults.toLowerCase();
  const dmarc = /dmarc=pass/.test(r);
  const dkim = new RegExp(`dkim=pass[^;]*header\\.(?:i|d)=@?(?:[a-z0-9.-]+\\.)?${domain.replace(/\./g, "\\.")}`).test(r);
  return dmarc || dkim;
}

export function classifyFiverrEmail(input: Candidate): AlertCategory | null {
  const domain = senderDomain(input.from);
  const domains = verifiedDomains();
  if (!domain || !domains.some((d) => domain === d || domain.endsWith(`.${d}`))) return null;
  if (!passesAuth(input.authResults, domain)) return null;
  const s = input.subject.toLowerCase();
  if (/security|password|log ?in|verification|verify/.test(s)) return "security";
  if (/policy|terms|account warning|violation/.test(s)) return "policy";
  if (/payment|withdraw|earning|payout|funds/.test(s)) return "payment";
  if (/order|delivery|revision|requirements/.test(s)) return "order";
  if (/message|inbox|replied|sent you/.test(s)) return "buyer_message";
  return "other";
}

export const CATEGORY_LABEL: Record<AlertCategory, string> = {
  buyer_message: "Buyer message",
  order: "Order update",
  payment: "Payment",
  policy: "Policy notice",
  security: "Security alert",
  other: "Other",
};
