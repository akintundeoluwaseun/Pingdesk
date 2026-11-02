import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal reproduction of the parts of Supabase that the migrations rely on:
 * the anon/authenticated/service_role roles, the auth schema with auth.users
 * and auth.uid(), and Supabase's default "grant all to API roles" behaviour.
 * The default grants matter: they prove our migration's REVOKEs actually work.
 */
const SUPABASE_SHIM = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export async function createTestDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  const dir = join(__dirname, "..", "..", "supabase", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }
  return db;
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

export async function createUser(db: TestDb, email: string, fullName?: string) {
  const res = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify(fullName ? { full_name: fullName } : {})],
  );
  return res.rows[0].id;
}

/** Run fn as a given API role, like PostgREST does for a request. */
export async function as<T>(
  db: TestDb,
  role: "anon" | "authenticated" | "service_role",
  userId: string | null,
  fn: (tx: TestDb) => Promise<T>,
): Promise<T> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
  try {
    return await fn(db);
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
