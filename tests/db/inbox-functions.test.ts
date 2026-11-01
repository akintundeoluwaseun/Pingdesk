import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb, createUser, type TestDb } from "./harness";

let db: TestDb;
let alice: string;
let bob: string;

const link = (tx: TestDb, user: string, email: string, token = "v1:a:b:c") =>
  tx.query<{ id: string }>("select public.link_gmail_inbox($1, $2, $3, 1::smallint, 'gmail.readonly') as id", [
    user,
    email,
    token,
  ]);

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, "alice@example.test");
  bob = await createUser(db, "bob@example.test");
});

describe("link_gmail_inbox", () => {
  it("is not callable by API users", async () => {
    await as(db, "authenticated", alice, async (tx) => {
      await expect(link(tx, alice, "alice@gmail.test")).rejects.toThrow(/permission denied/);
    });
    await as(db, "anon", null, async (tx) => {
      await expect(link(tx, alice, "alice@gmail.test")).rejects.toThrow(/permission denied/);
    });
  });

  it("creates an inbox with credentials and a default label", async () => {
    const id = await as(db, "service_role", null, async (tx) => (await link(tx, alice, " Alice@Gmail.test ")).rows[0].id);
    const inbox = await db.query<{ email_address: string; label: string; status: string }>(
      "select email_address, label, status from public.connected_inboxes where id = $1",
      [id],
    );
    expect(inbox.rows[0]).toEqual({ email_address: "alice@gmail.test", label: "alice@gmail.test", status: "active" });
    const cred = await db.query("select 1 from public.inbox_credentials where inbox_id = $1", [id]);
    expect(cred.rows).toHaveLength(1);
  });

  it("reconnecting keeps the label and replaces the token", async () => {
    const first = (await link(db, alice, "work@gmail.test", "v1:old:x:y")).rows[0].id;
    await db.query("update public.connected_inboxes set label = 'Fiverr' where id = $1", [first]);
    await db.query("update public.connected_inboxes set status = 'needs_reauth' where id = $1", [first]);
    const second = (await link(db, alice, "work@gmail.test", "v1:new:x:y")).rows[0].id;
    expect(second).toBe(first);
    const row = await db.query<{ label: string; status: string; token: string }>(
      `select i.label, i.status, c.encrypted_refresh_token as token
         from public.connected_inboxes i join public.inbox_credentials c on c.inbox_id = i.id where i.id = $1`,
      [first],
    );
    expect(row.rows[0]).toEqual({ label: "Fiverr", status: "active", token: "v1:new:x:y" });
  });

  it("the same Gmail can be linked by two separate PingDesk users", async () => {
    const a = (await link(db, alice, "shared@gmail.test")).rows[0].id;
    const b = (await link(db, bob, "shared@gmail.test")).rows[0].id;
    expect(a).not.toBe(b);
  });
});

describe("disconnect_inbox", () => {
  it("refuses to touch another user's inbox", async () => {
    const id = (await link(db, alice, "private@gmail.test")).rows[0].id;
    const r = await db.query<{ ok: boolean }>("select public.disconnect_inbox($1, $2) as ok", [bob, id]);
    expect(r.rows[0].ok).toBe(false);
    const cred = await db.query("select 1 from public.inbox_credentials where inbox_id = $1", [id]);
    expect(cred.rows).toHaveLength(1);
  });

  it("deletes credentials and keeps history by default", async () => {
    const id = (await link(db, alice, "keep@gmail.test")).rows[0].id;
    await db.query("update public.connected_inboxes set last_history_id = '123' where id = $1", [id]);
    const r = await db.query<{ ok: boolean }>("select public.disconnect_inbox($1, $2) as ok", [alice, id]);
    expect(r.rows[0].ok).toBe(true);
    const inbox = await db.query<{ status: string; last_history_id: string | null }>(
      "select status, last_history_id from public.connected_inboxes where id = $1",
      [id],
    );
    expect(inbox.rows[0]).toEqual({ status: "disconnected", last_history_id: null });
    const cred = await db.query("select 1 from public.inbox_credentials where inbox_id = $1", [id]);
    expect(cred.rows).toHaveLength(0);
  });

  it("can remove the inbox and its notification history", async () => {
    const id = (await link(db, alice, "gone@gmail.test")).rows[0].id;
    await db.query(
      `insert into public.notifications (user_id, inbox_id, gmail_message_id, category, inbox_label, sender_domain, received_at, fingerprint)
       values ($1, $2, 'm1', 'general', 'x', 'verified.test', now(), 'fp-gone')`,
      [alice, id],
    );
    await db.query("select public.disconnect_inbox($1, $2, true)", [alice, id]);
    const n = await db.query("select 1 from public.notifications where inbox_id = $1", [id]);
    expect(n.rows).toHaveLength(0);
  });
});
