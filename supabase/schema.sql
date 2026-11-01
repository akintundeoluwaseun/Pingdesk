create extension if not exists pgcrypto;
create table if not exists public.connected_inboxes(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 provider text not null check(provider='gmail'), email_address text not null, display_name text not null,
 encrypted_refresh_token text not null, last_history_id text, watch_expiration timestamptz,
 status text not null default 'pending' check(status in('pending','active','needs_reauth','disconnected','error')),
 created_at timestamptz not null default now(), unique(user_id,provider,email_address)
);
create table if not exists public.notification_preferences(
 user_id uuid primary key references auth.users(id) on delete cascade,
 whatsapp_number text, whatsapp_opt_in boolean not null default false,
 buyer_message boolean not null default true, order_alert boolean not null default true,
 payment_alert boolean not null default true, policy_alert boolean not null default true,
 security_alert boolean not null default true, other_alert boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.notifications(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 inbox_id uuid not null references public.connected_inboxes(id) on delete cascade,
 source_message_id text not null, category text not null check(category in('buyer_message','order','payment','policy','security','other')),
 subject text, received_at timestamptz, fingerprint text not null unique,
 processing_status text not null default 'queued' check(processing_status in('queued','processing','sent','failed','ignored')),
 created_at timestamptz not null default now(), unique(inbox_id,source_message_id)
);
create table if not exists public.delivery_logs(
 id uuid primary key default gen_random_uuid(), notification_id uuid not null references public.notifications(id) on delete cascade,
 channel text not null default 'whatsapp', provider_message_id text,
 delivery_status text not null default 'queued' check(delivery_status in('queued','submitted','sent','delivered','read','failed')),
 error_code text, attempt_count integer not null default 0, sent_at timestamptz, delivered_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.job_queue(
 id uuid primary key default gen_random_uuid(), job_type text not null, payload jsonb not null,
 status text not null default 'queued' check(status in('queued','processing','completed','failed')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 locked_at timestamptz, last_error text, created_at timestamptz not null default now()
);
create index if not exists idx_inboxes_user on public.connected_inboxes(user_id);
create index if not exists idx_notifications_user_created on public.notifications(user_id,created_at desc);
create index if not exists idx_jobs_ready on public.job_queue(status,available_at);
alter table public.connected_inboxes enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;
alter table public.delivery_logs enable row level security;
alter table public.job_queue enable row level security;
create policy "users manage own inboxes" on public.connected_inboxes for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy "users manage own preferences" on public.notification_preferences for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy "users read own notifications" on public.notifications for select using(auth.uid()=user_id);
create policy "users read own delivery logs" on public.delivery_logs for select using(exists(select 1 from public.notifications n where n.id=notification_id and n.user_id=auth.uid()));
-- job_queue intentionally has no user-facing policy; only the service-role worker may access it.
