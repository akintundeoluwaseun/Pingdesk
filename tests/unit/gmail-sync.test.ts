import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { senderQuery, syncInbox } from "@/server/gmail/sync";
import { GmailError, type GmailPort, type NewNotification, type NotificationStore } from "@/server/gmail/types";
import { classifyGoogleError } from "@/server/gmail/google-adapter";

type Msg = Awaited<ReturnType<GmailPort["getMessageHeaders"]>>;
const fixture = (name: string): NonNullable<Msg> =>
  JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "fiverr", `${name}.json`), "utf8")).message;

function msg(id: string, base: string, labels?: string[]): NonNullable<Msg> {
  const m = fixture(base);
  return { ...m, id, threadId: id, labelIds: labels ?? m.labelIds };
}

class FakeGmail implements GmailPort {
  calls = { history: 0, list: 0, get: 0, profile: 0 };
  queries: string[] = [];
  constructor(
    public messages: Record<string, NonNullable<Msg>>,
    public history: { id: string; ids: string[] }[] = [],
    public opts: { profileHistoryId?: string; expired?: boolean; pageSize?: number; searchIds?: string[]; failGet?: GmailError } = {},
  ) {}
  async getProfileHistoryId() {
    this.calls.profile++;
    return this.opts.profileHistoryId ?? "9000";
  }
  async listHistory(start: string, pageToken?: string) {
    this.calls.history++;
    if (this.opts.expired) throw new GmailError("history_expired");
    const records = this.history.filter((h) => Number(h.id) > Number(start));
    const size = this.opts.pageSize ?? 100;
    const offset = Number(pageToken ?? 0);
    const page = records.slice(offset, offset + size);
    return {
      historyId: this.history.at(-1)?.id ?? start,
      nextPageToken: offset + size < records.length ? String(offset + size) : undefined,
      records: page.map((r) => ({ id: r.id, messages: r.ids.map((id) => ({ id, labelIds: this.messages[id]?.labelIds ?? [] })) })),
    };
  }
  async listMessages(q: string, pageToken?: string) {
    this.calls.list++;
    this.queries.push(q);
    const ids = this.opts.searchIds ?? Object.keys(this.messages);
    const offset = Number(pageToken ?? 0);
    const size = this.opts.pageSize ?? 100;
    return { ids: ids.slice(offset, offset + size), nextPageToken: offset + size < ids.length ? String(offset + size) : undefined };
  }
  async getMessageHeaders(id: string) {
    this.calls.get++;
    if (this.opts.failGet) throw this.opts.failGet;
    return this.messages[id] ?? null;
  }
}

class MemoryStore implements NotificationStore {
  rows = new Map<string, NewNotification>();
  async insertNotification(row: NewNotification) {
    const key = `${row.inbox_id}:${row.gmail_message_id}`;
    if (this.rows.has(key)) return false;
    this.rows.set(key, row);
    return true;
  }
}

const inbox = (over: Partial<{ last_history_id: string | null; last_reconciled_at: string | null }> = {}) => ({
  id: "inbox-1",
  user_id: "user-1",
  label: "Fiverr seller",
  last_history_id: null,
  last_reconciled_at: null,
  ...over,
});
const opts = { domains: ["e.fiverr.com"], now: new Date("2026-11-01T10:00:00Z") };

describe("bootstrap (first sync)", () => {
  it("takes the cursor first, searches verified senders, stores only genuine notifications", async () => {
    const gmail = new FakeGmail({
      a: msg("a", "real-buyer-message"),
      b: msg("b", "real-marketing-announce"),
      c: msg("c", "spoof-dmarc-fail"),
      d: msg("d", "real-password-reset"),
    });
    const store = new MemoryStore();
    const res = await syncInbox(inbox(), gmail, store, opts);
    expect(res).toMatchObject({ mode: "bootstrap", historyId: "9000", created: 2, reconciled: true });
    expect(res.ignored).toEqual({ marketing: 1, auth_failed: 1 });
    expect(gmail.queries[0]).toBe("(from:e.fiverr.com) newer_than:2d -in:spam -in:trash");
    const row = store.rows.get("inbox-1:a")!;
    expect(row).toMatchObject({ category: "buyer_message", inbox_label: "Fiverr seller", sender_domain: "e.fiverr.com" });
    expect(row.received_at).toBe(new Date(1791902195000).toISOString());
    expect(row.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("paginates search results", async () => {
    const messages = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`m${i}`, msg(`m${i}`, "real-phone-added")]));
    const gmail = new FakeGmail(messages, [], { pageSize: 3 });
    const res = await syncInbox(inbox(), gmail, new MemoryStore(), opts);
    expect(res.created).toBe(7);
    expect(gmail.calls.list).toBe(3);
  });
});

describe("incremental sync", () => {
  const history = [
    { id: "101", ids: ["x1"] },
    { id: "102", ids: ["x2", "x3"] },
    { id: "103", ids: ["x4"] },
  ];
  const messages = {
    x1: msg("x1", "real-buyer-message"),
    x2: msg("x2", "real-marketing-announce"),
    x3: msg("x3", "real-no-longer-eligible"),
    x4: msg("x4", "real-password-reset", ["SPAM"]),
  };

  it("walks history pages from the stored cursor and advances it", async () => {
    const gmail = new FakeGmail(messages, history, { pageSize: 1 });
    const store = new MemoryStore();
    const res = await syncInbox(inbox({ last_history_id: "100", last_reconciled_at: "2026-11-01T09:00:00Z" }), gmail, store, opts);
    expect(res).toMatchObject({ mode: "incremental", historyId: "103", created: 2, reconciled: false, truncated: false });
    expect(gmail.calls.history).toBe(3);
    expect(gmail.calls.list).toBe(0); // reconciled an hour ago: no search
    expect(store.rows.has("inbox-1:x4")).toBe(false); // spam skipped without fetching
  });

  it("is idempotent: re-running the same window creates nothing new", async () => {
    const store = new MemoryStore();
    const i = inbox({ last_history_id: "100", last_reconciled_at: "2026-11-01T09:00:00Z" });
    await syncInbox(i, new FakeGmail(messages, history), store, opts);
    const again = await syncInbox(i, new FakeGmail(messages, history), store, opts);
    expect(again.created).toBe(0);
    expect(store.rows.size).toBe(2);
  });

  it("runs a reconciliation search when one is due", async () => {
    const gmail = new FakeGmail(messages, history, { searchIds: ["x1", "late"] });
    gmail.messages.late = msg("late", "real-phone-added");
    const res = await syncInbox(inbox({ last_history_id: "100", last_reconciled_at: "2026-11-01T01:00:00Z" }), gmail, new MemoryStore(), opts);
    expect(res.reconciled).toBe(true);
    expect(res.created).toBe(3); // x1, x3 from history + "late" found by search
    expect(gmail.queries[0]).toContain("newer_than:1d");
  });

  it("recovers when Gmail says the cursor expired", async () => {
    const gmail = new FakeGmail({ r: msg("r", "real-buyer-message") }, [], { expired: true, profileHistoryId: "5555" });
    const res = await syncInbox(inbox({ last_history_id: "1" }), gmail, new MemoryStore(), opts);
    expect(res).toMatchObject({ mode: "recovered", historyId: "5555", created: 1, reconciled: true });
    expect(gmail.queries[0]).toContain("newer_than:7d");
  });

  it("stops at the per-run cap and saves the cursor at the last complete record", async () => {
    const gmail = new FakeGmail(messages, history);
    const res = await syncInbox(inbox({ last_history_id: "100", last_reconciled_at: "2026-11-01T09:00:00Z" }), gmail, new MemoryStore(), { ...opts, maxMessages: 2 });
    expect(res.truncated).toBe(true);
    expect(res.historyId).toBe("101"); // record 102 not fully processed -> resume there
    expect(res.reconciled).toBe(false);
  });

  it("propagates auth errors so the inbox can be marked for reconnection", async () => {
    const gmail = new FakeGmail(messages, history, { failGet: new GmailError("auth_revoked") });
    await expect(syncInbox(inbox({ last_history_id: "100" }), gmail, new MemoryStore(), opts)).rejects.toMatchObject({ kind: "auth_revoked", needsReauth: true });
  });
});

describe("helpers", () => {
  it("builds sender-restricted search queries", () => {
    expect(senderQuery(["e.fiverr.com", "x.test"], 1.2)).toBe("(from:e.fiverr.com OR from:x.test) newer_than:2d -in:spam -in:trash");
  });

  it("maps Google errors", () => {
    expect(classifyGoogleError({ response: { status: 400, data: { error: "invalid_grant" } } }).kind).toBe("auth_revoked");
    expect(classifyGoogleError({ response: { status: 401 } }).kind).toBe("auth_revoked");
    expect(classifyGoogleError({ response: { status: 403, data: { error: { errors: [{ reason: "insufficientPermissions" }] } } } }).kind).toBe("insufficient_scope");
    expect(classifyGoogleError({ response: { status: 403, data: { error: { errors: [{ reason: "userRateLimitExceeded" }] } } } }).kind).toBe("rate_limited");
    expect(classifyGoogleError({ response: { status: 429 } }).kind).toBe("rate_limited");
    expect(classifyGoogleError({ response: { status: 404 } }).kind).toBe("history_expired");
    expect(classifyGoogleError({ response: { status: 503 } }).kind).toBe("unavailable");
    expect(classifyGoogleError({ code: "ETIMEDOUT" }).kind).toBe("unavailable");
    expect(classifyGoogleError(new Error("?")).kind).toBe("unknown");
  });
});
