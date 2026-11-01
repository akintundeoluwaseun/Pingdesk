-- PingDesk foundation schema.
-- Replaces the earlier supabase/schema.sql. Apply with `supabase db push`
-- or paste into the Supabase SQL editor on a fresh project.
--
-- Access model
--   * Browser (anon / authenticated roles) may only SELECT its own rows and
--     UPDATE a small set of whitelisted columns. Everything else goes through
--     server code using the service role.
--   * Secrets (refresh tokens, verification code hashes) are never readable
--     by anon/authenticated, even for the owning user.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text check (full_name is null or char_length(full_name) between 1 and 120),
  timezone    text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Connected inboxes (no secrets in this table)
-- ---------------------------------------------------------------------------
create table public.connected_inboxes (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  provider         text not null default 'gmail' check (provider = 'gmail'),
  email_address    text not null check (email_address = lower(email_address) and position('@' in email_address) > 1),
  label            text not null check (char_length(btrim(label)) between 1 and 60),
  status           text not null default 'active'
                   check (status in ('active', 'needs_reauth', 'disconnected', 'error')),
  last_history_id  text,
  last_synced_at   timestamptz,
  last_error_code  text,
  last_error_at    timestamptz,
  connected_at     timestamptz not null default now(),
  disconnected_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, provider, email_address),
  unique (id, user_id)
);
create index connected_inboxes_user_idx on public.connected_inboxes (user_id);
create index connected_inboxes_sync_idx on public.connected_inboxes (status, last_synced_at nulls first);
create trigger connected_inboxes_updated_at before update on public.connected_inboxes
  for each row execute function public.set_updated_at();

-- Encrypted OAuth credentials. Service role only.
create table public.inbox_credentials (
  inbox_id                 uuid primary key references public.connected_inboxes(id) on delete cascade,
  user_id                  uuid not null references auth.users(id) on delete cascade,
  encrypted_refresh_token  text not null,
  key_version              smallint not null default 1,
  granted_scopes           text not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index inbox_credentials_user_idx on public.inbox_credentials (user_id);
create trigger inbox_credentials_updated_at before update on public.inbox_credentials
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Notification preferences (one row per user)
-- ---------------------------------------------------------------------------
create table public.notification_preferences (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  alerts_paused     boolean not null default false,
  buyer_message     boolean not null default true,
  new_order         boolean not null default true,
  order_update      boolean not null default true,
  payment           boolean not null default true,
  policy            boolean not null default true,
  account_security  boolean not null default true,
  general           boolean not null default false,
  unclassified      boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- WhatsApp destination (one per user for the MVP)
-- ---------------------------------------------------------------------------
create table public.whatsapp_connections (
  user_id                  uuid primary key references auth.users(id) on delete cascade,
  phone_e164               text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status                   text not null default 'pending_verification'
                           check (status in ('pending_verification', 'verified', 'opted_out')),
  opt_in_version           text,
  opted_in_at              timestamptz,
  verified_at              timestamptz,
  opted_out_at             timestamptz,
  verification_code_hash   text,
  verification_expires_at  timestamptz,
  verification_attempts    smallint not null default 0,
  verification_sends       smallint not null default 0,
  last_inbound_at          timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (status <> 'verified' or (verified_at is not null and opted_in_at is not null))
);
create trigger whatsapp_connections_updated_at before update on public.whatsapp_connections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Notifications detected from email
-- ---------------------------------------------------------------------------
create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  inbox_id          uuid not null,
  gmail_message_id  text not null,
  gmail_thread_id   text,
  category          text not null check (category in (
                      'buyer_message', 'new_order', 'order_update', 'payment',
                      'policy', 'account_security', 'general', 'unclassified')),
  inbox_label       text not null,
  sender_domain     text not null,
  subject           text check (subject is null or char_length(subject) <= 300),
  auth_evidence     jsonb not null default '{}'::jsonb,
  received_at       timestamptz not null,
  status            text not null default 'received' check (status in (
                      'received', 'queued', 'delivering', 'delivered',
                      'failed', 'skipped')),
  skip_reason       text,
  fingerprint       text not null unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (inbox_id, gmail_message_id),
  -- inbox must belong to the same user
  foreign key (inbox_id, user_id) references public.connected_inboxes(id, user_id) on delete cascade
);
create index notifications_user_received_idx on public.notifications (user_id, received_at desc);
create index notifications_user_status_idx on public.notifications (user_id, status);
create index notifications_user_category_idx on public.notifications (user_id, category);
create trigger notifications_updated_at before update on public.notifications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Delivery logs (one row per send attempt)
-- ---------------------------------------------------------------------------
create table public.delivery_logs (
  id                   uuid primary key default gen_random_uuid(),
  notification_id      uuid not null references public.notifications(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  channel              text not null default 'whatsapp' check (channel = 'whatsapp'),
  attempt              smallint not null default 1 check (attempt >= 1),
  recipient_last4      text check (recipient_last4 is null or recipient_last4 ~ '^[0-9]{4}$'),
  template_name        text,
  provider_message_id  text unique,
  status               text not null default 'pending' check (status in (
                         'pending', 'submitted', 'sent', 'delivered', 'read', 'failed')),
  error_code           text,
  error_title          text,
  pricing_category     text,
  billable             boolean,
  submitted_at         timestamptz,
  sent_at              timestamptz,
  delivered_at         timestamptz,
  read_at              timestamptz,
  failed_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (notification_id, attempt)
);
create index delivery_logs_user_created_idx on public.delivery_logs (user_id, created_at desc);
create index delivery_logs_notification_idx on public.delivery_logs (notification_id);
create trigger delivery_logs_updated_at before update on public.delivery_logs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Durable background jobs. Service role only.
-- ---------------------------------------------------------------------------
create table public.jobs (
  id               uuid primary key default gen_random_uuid(),
  job_type         text not null check (char_length(job_type) between 1 and 64),
  payload          jsonb not null default '{}'::jsonb,
  user_id          uuid references auth.users(id) on delete cascade,
  status           text not null default 'queued'
                   check (status in ('queued', 'running', 'succeeded', 'dead')),
  attempts         smallint not null default 0,
  max_attempts     smallint not null default 8 check (max_attempts between 1 and 50),
  run_at           timestamptz not null default now(),
  locked_by        text,
  locked_until     timestamptz,
  last_error       text,
  idempotency_key  text unique,
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index jobs_ready_idx on public.jobs (run_at) where status = 'queued';
create index jobs_lease_idx on public.jobs (locked_until) where status = 'running';
create index jobs_user_idx on public.jobs (user_id);
create trigger jobs_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- New-user bootstrap
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), '')
  )
  on conflict (id) do nothing;
  insert into public.notification_preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Privileges: start from nothing, then grant the minimum.
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.connected_inboxes, public.inbox_credentials,
  public.notification_preferences, public.whatsapp_connections, public.notifications,
  public.delivery_logs, public.jobs
  from anon, authenticated;

grant select on public.profiles, public.connected_inboxes, public.notification_preferences,
  public.notifications, public.delivery_logs
  to authenticated;

-- verification_code_hash is deliberately not selectable.
grant select (user_id, phone_e164, status, opt_in_version, opted_in_at, verified_at,
  opted_out_at, verification_expires_at, last_inbound_at, created_at, updated_at)
  on public.whatsapp_connections to authenticated;

grant update (full_name, timezone) on public.profiles to authenticated;
grant update (label) on public.connected_inboxes to authenticated;
grant update (alerts_paused, buyer_message, new_order, order_update, payment, policy,
  account_security, general, unclassified)
  on public.notification_preferences to authenticated;

grant all on public.profiles, public.connected_inboxes, public.inbox_credentials,
  public.notification_preferences, public.whatsapp_connections, public.notifications,
  public.delivery_logs, public.jobs
  to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles                 enable row level security;
alter table public.connected_inboxes        enable row level security;
alter table public.inbox_credentials        enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.whatsapp_connections     enable row level security;
alter table public.notifications            enable row level security;
alter table public.delivery_logs            enable row level security;
alter table public.jobs                     enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy inboxes_select_own on public.connected_inboxes
  for select to authenticated using (user_id = (select auth.uid()));
create policy inboxes_update_own on public.connected_inboxes
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy prefs_select_own on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy prefs_update_own on public.notification_preferences
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy whatsapp_select_own on public.whatsapp_connections
  for select to authenticated using (user_id = (select auth.uid()));

create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

create policy delivery_logs_select_own on public.delivery_logs
  for select to authenticated using (user_id = (select auth.uid()));

-- inbox_credentials and jobs: RLS on, no policies => no access except service_role.
