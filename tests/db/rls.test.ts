import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb, createUser, type TestDb } from "./harness";

let db: TestDb;
let alice: string;
let bob: string;
let aliceInbox: string;
let bobInbox: string;

async function seedInbox(userId: string, email: string) {
  const r = await db.query<{ id: string }>(
    "insert into public.connected_inboxes (user_id, email_address, label) values ($1, $2, $3) returning id",
    [userId, email, "Main"],
  );
  const id = r.rows[0].id;
  await db.query(
    "insert into public.inbox_credentials (inbox_id, user_id, encrypted_refresh_token, granted_scopes) values ($1, $2, 'v1:secret', 'gmail.readonly')",
    [id, userId],
  );
  await db.query(
    `insert into public.notifications (user_id, inbox_id, gmail_message_id, category, inbox_label, sender_domain, received_at, fingerprint)
     values ($1, $2, $3, 'new_order', 'Main', 'verified.test', now(), $4)`,
    [userId, id, `m-${id}`, `fp-${id}`],
  );
  return id;
}

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, "alice@example.test", "Alice");
  bob = await createUser(db, "bob@example.test");
  aliceInbox = await seedInbox(alice, "alice@gmail.test");
  bobInbox = await seedInbox(bob, "bob@gmail.test");
  await db.query(
    `insert into public.whatsapp_connections (user_id, phone_e164, verification_code_hash) values ($1, '+2348000000001', 'hash-a')`,
    [alice],
  );
});

describe("new user bootstrap", () => {
  it("creates profile and default preferences", async () => {
    const p = await db.query<{ full_name: string | null }>("select full_name from public.profiles where id = $1", [alice]);
    expect(p.rows[0].full_name).toBe("Alice");
    const prefs = await db.query<{ general: boolean; new_order: boolean }>(
      "select general, new_order from public.notification_preferences where user_id = $1",
      [bob],
    );
    expect(prefs.rows[0]).toEqual({ general: false, new_order: true });
  });
});

describe("row level security", () => {
  it("users only see their own inboxes and notifications", async () => {
    await as(db, "authenticated", alice, async (tx) => {
      const inboxes = await tx.query<{ id: string }>("select id from public.connected_inboxes");
      expect(inboxes.rows.map((r) => r.id)).toEqual([aliceInbox]);
      const notes = await tx.query<{ inbox_id: string }>("select inbox_id from public.notifications");
      expect(notes.rows.map((r) => r.inbox_id)).toEqual([aliceInbox]);
      const prefs = await tx.query("select user_id from public.notification_preferences");
      expect(prefs.rows).toHaveLength(1);
    });
  });

  it("anon sees nothing", async () => {
    await as(db, "anon", null, async (tx) => {
      await expect(tx.query("select * from public.connected_inboxes")).rejects.toThrow(/permission denied/);
      await expect(tx.query("select * from public.notifications")).rejects.toThrow(/permission denied/);
    });
  });

  it("refresh tokens are unreadable even by their owner", async () => {
    await as(db, "authenticated", alice, async (tx) => {
      await expect(tx.query("select * from public.inbox_credentials")).rejects.toThrow(/permission denied/);
    });
  });

  it("jobs are unreadable by API users", async () => {
    await as(db, "authenticated", alice, async (tx) => {
      await expect(tx.query("select * from public.jobs")).rejects.toThrow(/permission denied/);
    });
  });

  it("verification code hash is not selectable", async () => {
    await as(db, "authenticated", alice, async (tx) => {
      await expect(tx.query("select verification_code_hash from public.whatsapp_connections")).rejects.toThrow(
        /permission denied/,
      );
      const ok = await tx.query<{ status: string }>("select status from public.whatsapp_connections");
      expect(ok.rows).toEqual([{ status: "pending_verification" }]);
    });
  });

  it("users can rename their own inbox but nothing else", async () => {
    await as(db, "authenticated", alice, async (tx) => {
      await tx.query("update public.connected_inboxes set label = 'Fiverr seller' where id = $1", [aliceInbox]);
      await expect(
        tx.query("update public.connected_inboxes set status = 'active' where id = $1", [aliceInbox]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        tx.query("update public.connected_inboxes set user_id = $1 where id = $2", [bob, aliceInbox]),
      ).rejects.toThrow(/permission denied/);
      const res = await tx.query("update public.connected_inboxes set label = 'hijack' where id = $1", [bobInbox]);
      expect(res.affectedRows ?? 0).toBe(0);
    });
    const bobLabel = await db.query<{ label: string }>("select label from public.connected_inboxes where id = $1", [bobInbox]);
    expect(bobLabel.rows[0].label).toBe("Main");
  });

  it("users cannot insert or delete rows directly", async () => {
    await as(db, "authenticated", alice, async (tx) => {
      await expect(
        tx.query("insert into public.connected_inboxes (user_id, email_address, label) values ($1, 'x@gmail.test', 'x')", [alice]),
      ).rejects.toThrow(/permission denied/);
      await expect(tx.query("delete from public.notifications")).rejects.toThrow(/permission denied/);
      await expect(
        tx.query("update public.whatsapp_connections set status = 'verified'"),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("users can toggle their own preferences only", async () => {
    await as(db, "authenticated", bob, async (tx) => {
      await tx.query("update public.notification_preferences set general = true");
    });
    const rows = await db.query<{ user_id: string; general: boolean }>(
      "select user_id, general from public.notification_preferences order by general",
    );
    expect(rows.rows.find((r) => r.user_id === bob)?.general).toBe(true);
    expect(rows.rows.find((r) => r.user_id === alice)?.general).toBe(false);
  });
});

describe("integrity constraints", () => {
  it("rejects a notification pointing at another user's inbox", async () => {
    await expect(
      db.query(
        `insert into public.notifications (user_id, inbox_id, gmail_message_id, category, inbox_label, sender_domain, received_at, fingerprint)
         values ($1, $2, 'cross', 'general', 'x', 'verified.test', now(), 'fp-cross')`,
        [alice, bobInbox],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("prevents duplicate notifications for the same Gmail message", async () => {
    await expect(
      db.query(
        `insert into public.notifications (user_id, inbox_id, gmail_message_id, category, inbox_label, sender_domain, received_at, fingerprint)
         values ($1, $2, $3, 'general', 'x', 'verified.test', now(), 'fp-other')`,
        [alice, aliceInbox, `m-${aliceInbox}`],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("rejects invalid phone numbers and unverified 'verified' rows", async () => {
    await expect(
      db.query("insert into public.whatsapp_connections (user_id, phone_e164) values ($1, '08012345678')", [bob]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query("insert into public.whatsapp_connections (user_id, phone_e164, status) values ($1, '+2348000000002', 'verified')", [bob]),
    ).rejects.toThrow(/check constraint/);
  });

  it("deleting a user cascades all their data", async () => {
    const carol = await createUser(db, "carol@example.test");
    await seedInbox(carol, "carol@gmail.test");
    await db.query("delete from auth.users where id = $1", [carol]);
    for (const t of ["connected_inboxes", "inbox_credentials", "notifications", "notification_preferences"]) {
      const r = await db.query<{ n: number }>(`select count(*)::int as n from public.${t} where user_id = $1`, [carol]);
      expect(r.rows[0].n, t).toBe(0);
    }
  });
});
