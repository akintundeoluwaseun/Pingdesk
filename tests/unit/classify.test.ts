import { describe, expect, it } from "vitest";
import { classifyFiverrEmail, senderDomain } from "@/lib/email/classify";
import { safeNext } from "@/lib/safe-redirect";

// Placeholder domain on the reserved .test TLD. Real Fiverr sender domains are
// deliberately not assumed anywhere; they come from verified samples in Phase 2.
const DOMAINS = ["notify.verified-sender.test"];

describe("sender verification", () => {
  it("ignores everything when no verified domains are configured", () => {
    expect(classifyFiverrEmail({ from: "a@notify.verified-sender.test", subject: "New order" }, [])).toBeNull();
  });

  it("ignores lookalike and unrelated domains", () => {
    for (const from of [
      "x@verified-sender.test",
      "x@notify.verified-sender.test.evil.test",
      "x@evilnotify.verified-sender.test",
      '"notify.verified-sender.test" <x@evil.test>',
      "not-an-address",
    ]) {
      expect(classifyFiverrEmail({ from, subject: "New order" }, DOMAINS), from).toBeNull();
    }
  });

  it("accepts exact and subdomain matches, case-insensitively", () => {
    expect(classifyFiverrEmail({ from: "Name <X@Notify.Verified-Sender.TEST>", subject: "hello" }, DOMAINS)).toBe("unclassified");
    expect(classifyFiverrEmail({ from: "x@mail.notify.verified-sender.test", subject: "hello" }, DOMAINS)).toBe("unclassified");
  });

  it("extracts the domain from display-name addresses", () => {
    expect(senderDomain('"Some, Name" <a@b.test>')).toBe("b.test");
    expect(senderDomain("bad")).toBeNull();
  });
});

describe("interim category rules", () => {
  const c = (subject: string) => classifyFiverrEmail({ from: "x@notify.verified-sender.test", subject }, DOMAINS);
  it("maps subjects to categories, unknown to unclassified", () => {
    expect(c("You've got a new order")).toBe("new_order");
    expect(c("Your order was delivered")).toBe("order_update");
    expect(c("You have a new message")).toBe("buyer_message");
    expect(c("Your payment has cleared")).toBe("payment");
    expect(c("New sign-in to your account")).toBe("account_security");
    expect(c("Updates to our Terms of Service")).toBe("policy");
    expect(c("Weekly digest")).toBe("unclassified");
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
