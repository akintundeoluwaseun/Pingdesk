import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { categorise, evaluateEmail, senderDomain } from "@/lib/email/classify";
import { loadSubjectRules, normaliseSubject, verifiedSenderDomains } from "@/lib/email/fiverr-rules";
import { parseAuthenticationResults } from "@/lib/email/auth-results";
import { safeNext } from "@/lib/safe-redirect";

type Fixture = {
  source: string;
  expect: { accepted: boolean; category?: string; reason?: string };
  message: { headers: { name: string; value: string }[] };
};

const dir = join(__dirname, "..", "fixtures", "fiverr");
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8")) as Fixture] as const);

describe("Fiverr email fixtures (real + adversarial)", () => {
  it("has real samples", () => {
    expect(fixtures.filter(([f]) => f.startsWith("real-")).length).toBeGreaterThanOrEqual(5);
  });

  for (const [file, fx] of fixtures) {
    it(file, () => {
      const v = evaluateEmail(fx.message.headers, { domains: ["e.fiverr.com"] });
      expect(v.accepted).toBe(fx.expect.accepted);
      if (v.accepted) expect(v.category).toBe(fx.expect.category);
      else expect(v.reason).toBe(fx.expect.reason);
    });
  }
});

describe("authentication results", () => {
  it("parses Gmail's verdict and ignores comment text", () => {
    const e = parseAuthenticationResults([
      {
        name: "Authentication-Results",
        value:
          "mx.google.com; dkim=pass header.i=@e.fiverr.com header.s=dkim; spf=pass (google.com: dmarc=pass header.from=evil.test) smtp.mailfrom=noreply@e.fiverr.com; dmarc=pass (p=QUARANTINE) header.from=e.fiverr.com",
      },
    ]);
    expect(e).toMatchObject({ trusted: true, dmarc: "pass", dmarcFrom: "e.fiverr.com", dkimPassDomains: ["e.fiverr.com"], spf: "pass", spfMailFrom: "e.fiverr.com" });
  });

  it("is untrusted with no header", () => {
    expect(parseAuthenticationResults([{ name: "From", value: "x" }]).trusted).toBe(false);
  });

  it("rejects verified sender with no Authentication-Results at all", () => {
    const v = evaluateEmail(
      [
        { name: "From", value: "Fiverr <noreply@e.fiverr.com>" },
        { name: "Subject", value: "Reset your Fiverr password" },
      ],
      { domains: ["e.fiverr.com"] },
    );
    expect(v).toMatchObject({ accepted: false, reason: "auth_failed" });
  });
});

describe("rules configuration", () => {
  it("defaults to the observed transactional domain and allows override", () => {
    expect(verifiedSenderDomains({})).toEqual(["e.fiverr.com"]);
    expect(verifiedSenderDomains({ FIVERR_VERIFIED_SENDER_DOMAINS: " A.test , b.test" })).toEqual(["a.test", "b.test"]);
  });

  it("normalises curly quotes and spacing", () => {
    expect(normaliseSubject("  You’ve   got NEW messages ")).toBe("you've got new messages");
  });

  it("supports extra rules from config and rejects bad config", () => {
    const rules = loadSubjectRules({ FIVERR_EXTRA_RULES: JSON.stringify([{ category: "new_order", pattern: "^order from \\S+$", sample: "Order from x" }]) });
    expect(categorise("Order from someone", rules)).toBe("new_order");
    expect(categorise("Order from someone", loadSubjectRules({}))).toBe("unclassified");
    expect(() => loadSubjectRules({ FIVERR_EXTRA_RULES: "not json" })).toThrow();
    expect(() => loadSubjectRules({ FIVERR_EXTRA_RULES: JSON.stringify([{ category: "hack", pattern: "x", sample: "x" }]) })).toThrow();
  });

  it("extracts sender domains safely", () => {
    expect(senderDomain('"Some, Name" <a@b.test>')).toBe("b.test");
    expect(senderDomain('"a@e.fiverr.com" <x@evil.test>')).toBe("evil.test");
    expect(senderDomain("bad")).toBeNull();
  });
});

describe("safeNext", () => {
  it("allows same-site paths only", () => {
    expect(safeNext("/dashboard/inboxes")).toBe("/dashboard/inboxes");
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "dashboard", null, "/x\r\nSet-Cookie: a"]) {
      expect(safeNext(bad)).toBe("/dashboard");
    }
  });
});
