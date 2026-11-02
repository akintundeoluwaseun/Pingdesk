import { isAuthenticSender, parseAuthenticationResults, type AuthEvidence, type Header } from "./auth-results";
import { IGNORED_SENDER_DOMAINS, loadSubjectRules, normaliseSubject, verifiedSenderDomains, type SubjectRule } from "./fiverr-rules";
import type { AlertCategory } from "./categories";

export { CATEGORIES, CATEGORY_LABELS, type AlertCategory } from "./categories";

export type EmailEvaluation =
  | { accepted: false; reason: "not_fiverr" | "marketing" | "auth_failed" | "malformed"; senderDomain: string | null }
  | {
      accepted: true;
      category: AlertCategory;
      senderDomain: string;
      subject: string;
      evidence: Pick<AuthEvidence, "dmarc" | "dkimPassDomains" | "spf">;
    };

export function readHeader(headers: Header[], name: string): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function senderDomain(from: string): string | null {
  const address = (from.match(/<([^<>]+)>\s*$/)?.[1] ?? from).trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at < 1 || /[\s<>]/.test(address)) return null;
  return address.slice(at + 1) || null;
}

export function categorise(subject: string, rules: SubjectRule[] = loadSubjectRules()): AlertCategory {
  const s = normaliseSubject(subject);
  return rules.find((r) => r.pattern.test(s))?.category ?? "unclassified";
}

/**
 * Decides whether a Gmail message is a genuine Fiverr notification and, if so,
 * which category it belongs to. Only exact, verified sender domains with
 * passing DMARC + aligned DKIM are accepted; everything else is ignored.
 */
export function evaluateEmail(
  headers: Header[],
  opts: { domains?: string[]; rules?: SubjectRule[] } = {},
): EmailEvaluation {
  const from = readHeader(headers, "From");
  const domain = senderDomain(from);
  if (!domain) return { accepted: false, reason: "malformed", senderDomain: null };
  if ((IGNORED_SENDER_DOMAINS as readonly string[]).includes(domain)) return { accepted: false, reason: "marketing", senderDomain: domain };

  const domains = opts.domains ?? verifiedSenderDomains();
  if (!domains.includes(domain)) return { accepted: false, reason: "not_fiverr", senderDomain: domain };

  const evidence = parseAuthenticationResults(headers);
  if (!isAuthenticSender(evidence, domain)) return { accepted: false, reason: "auth_failed", senderDomain: domain };

  const subject = readHeader(headers, "Subject").replace(/\s+/g, " ").trim();
  return {
    accepted: true,
    category: categorise(subject, opts.rules),
    senderDomain: domain,
    subject: subject.slice(0, 300),
    evidence: { dmarc: evidence.dmarc, dkimPassDomains: evidence.dkimPassDomains, spf: evidence.spf },
  };
}
