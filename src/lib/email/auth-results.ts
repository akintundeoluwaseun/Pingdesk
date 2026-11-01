/**
 * Reads Gmail's own sender-authentication verdict.
 *
 * Gmail's receiving server (authserv-id "mx.google.com") prepends an
 * Authentication-Results header with SPF/DKIM/DMARC outcomes. A sender can put
 * a fake "Authentication-Results: mx.google.com; dmarc=pass" lower down in
 * their own message, so we trust ONLY the first Authentication-Results header,
 * and only if it was written by mx.google.com.
 */
export type Header = { name?: string | null; value?: string | null };

export type AuthEvidence = {
  trusted: boolean; // first header came from mx.google.com
  dmarc: string | null; // pass | fail | none | ...
  dmarcFrom: string | null; // header.from domain DMARC evaluated
  dkimPassDomains: string[]; // d= / header.i domains with dkim=pass
  spf: string | null;
  spfMailFrom: string | null; // envelope sender domain
};

const GMAIL_AUTHSERV = "mx.google.com";

function domainOf(value: string): string {
  const v = value.replace(/^"|"$/g, "").trim().toLowerCase();
  const at = v.lastIndexOf("@");
  return at >= 0 ? v.slice(at + 1) : v;
}

export function parseAuthenticationResults(headers: Header[]): AuthEvidence {
  const empty: AuthEvidence = { trusted: false, dmarc: null, dmarcFrom: null, dkimPassDomains: [], spf: null, spfMailFrom: null };
  const first = headers.find((h) => h.name?.toLowerCase() === "authentication-results");
  if (!first?.value) return empty;

  const value = first.value.replace(/\s+/g, " ").trim();
  // Strip RFC 5322 comments like "(google.com: domain of … )" so they can't inject tokens.
  const clean = value.replace(/\([^()]*\)/g, " ");
  const [authserv, ...rest] = clean.split(";");
  if (authserv.trim().toLowerCase() !== GMAIL_AUTHSERV) return empty;

  const out: AuthEvidence = { ...empty, trusted: true };
  for (const raw of rest) {
    const part = raw.trim();
    const method = /^(dkim|spf|dmarc)\s*=\s*([a-z]+)/i.exec(part);
    if (!method) continue;
    const kind = method[1].toLowerCase();
    const result = method[2].toLowerCase();
    const prop = (name: string) => new RegExp(`(?:^|\\s)${name.replace(".", "\\.")}=("[^"]*"|\\S+)`, "i").exec(part)?.[1];
    if (kind === "dmarc") {
      out.dmarc = result;
      const from = prop("header.from");
      out.dmarcFrom = from ? domainOf(from) : null;
    } else if (kind === "spf") {
      out.spf = result;
      const mf = prop("smtp.mailfrom");
      out.spfMailFrom = mf ? domainOf(mf) : null;
    } else if (kind === "dkim" && result === "pass") {
      const d = prop("header.d") ?? prop("header.i");
      if (d) out.dkimPassDomains.push(domainOf(d));
    }
  }
  return out;
}

/**
 * The sender is authentic only if Gmail says DMARC passed for exactly this
 * From domain AND a DKIM signature from that same domain verified.
 */
export function isAuthenticSender(evidence: AuthEvidence, fromDomain: string): boolean {
  const d = fromDomain.toLowerCase();
  return (
    evidence.trusted &&
    evidence.dmarc === "pass" &&
    evidence.dmarcFrom === d &&
    evidence.dkimPassDomains.includes(d)
  );
}
