import { z } from "zod";
import type { AlertCategory } from "./categories";

/**
 * Fiverr notification rules — derived ONLY from real, authorized notification
 * emails (redacted copies live in tests/fixtures/fiverr/). Do not add a sender
 * or subject pattern without adding a matching real fixture.
 *
 * Observed samples (Nov 2025 – Oct 2026):
 *   noreply@e.fiverr.com        transactional notifications, DKIM d=e.fiverr.com,
 *                               DMARC pass header.from=e.fiverr.com
 *   no-reply@ / team@announce.fiverr.com
 *                               marketing (SendGrid), ignored on purpose
 *
 * Not yet observed (no samples): new order, order update, payment. Emails of
 * those kinds from the verified sender are stored as "unclassified" until real
 * samples are added — they are never guessed.
 */
export const TRANSACTIONAL_SENDER_DOMAINS = ["e.fiverr.com"] as const;
export const IGNORED_SENDER_DOMAINS = ["announce.fiverr.com", "mail.announce.fiverr.com"] as const;

export type SubjectRule = { category: AlertCategory; pattern: RegExp; sample: string };

export const SUBJECT_RULES: SubjectRule[] = [
  { category: "buyer_message", pattern: /^you've got (?:a )?new messages? from \S+$/, sample: "You’ve got new messages from <buyer>" },
  { category: "account_security", pattern: /^reset your fiverr password$/, sample: "Reset your Fiverr password" },
  {
    category: "account_security",
    pattern: /^a new phone number was added to your fiverr account$/,
    sample: "A new phone number was added to your Fiverr account",
  },
  {
    category: "policy",
    pattern: /^you are no longer eligible to offer services on fiverr$/,
    sample: "You are no longer eligible to offer services on Fiverr",
  },
];

/** Normalises typographic quotes, case and whitespace before matching. */
export function normaliseSubject(subject: string): string {
  return subject
    .normalize("NFKC")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Operators can add rules for newly observed formats without a code change:
 * FIVERR_EXTRA_RULES='[{"category":"new_order","pattern":"^...$","sample":"..."}]'
 * Patterns are matched against the normalised (lower-case) subject.
 */
const extraRuleSchema = z.array(
  z.object({
    category: z.enum(["buyer_message", "new_order", "order_update", "payment", "policy", "account_security", "general"]),
    pattern: z.string().min(2).max(300),
    sample: z.string().min(1).max(300),
  }),
);

export function loadSubjectRules(env: Record<string, string | undefined> = process.env): SubjectRule[] {
  const raw = env.FIVERR_EXTRA_RULES;
  if (!raw) return SUBJECT_RULES;
  try {
    const extra = extraRuleSchema.parse(JSON.parse(raw)).map((r) => ({ ...r, pattern: new RegExp(r.pattern) }));
    return [...SUBJECT_RULES, ...extra];
  } catch {
    throw new Error("FIVERR_EXTRA_RULES is not valid JSON rule configuration.");
  }
}

/** Verified transactional sender domains; FIVERR_VERIFIED_SENDER_DOMAINS replaces the default list if set. */
export function verifiedSenderDomains(env: Record<string, string | undefined> = process.env): string[] {
  const override = (env.FIVERR_VERIFIED_SENDER_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return override.length ? override : [...TRANSACTIONAL_SENDER_DOMAINS];
}
