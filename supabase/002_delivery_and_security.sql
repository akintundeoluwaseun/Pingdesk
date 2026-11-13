-- PingDesk migration 002: delivery worker, incremental sync and token privacy.
-- Run after schema.sql. Safe to run more than once.

-- Incremental Gmail sync and error reporting
alter table public.connected_inboxes add column if not exists last_synced_at timestamptz;
alter table public.connected_inboxes add column if not exists last_error text;

-- Delivery retries
alter table public.notifications add column if not exists attempts integer not null default 0;
alter table public.notifications add column if not exists next_attempt_at timestamptz not null default now();
alter table public.notifications add column if not exists updated_at timestamptz not null default now();
alter table public.notifications add column if not exists skip_reason text;
create index if not exists idx_notifications_due on public.notifications(processing_status, next_attempt_at);
alter table public.delivery_logs add column if not exists error_message text;
create index if not exists idx_delivery_provider_msg on public.delivery_logs(provider_message_id);

-- Preferences: timezone for alert times, and digits-only international numbers (what Meta expects)
alter table public.notification_preferences add column if not exists timezone text not null default 'UTC';
alter table public.notification_preferences drop constraint if exists whatsapp_number_format;
alter table public.notification_preferences add constraint whatsapp_number_format
  check (whatsapp_number is null or whatsapp_number ~ '^[1-9][0-9]{7,14}$');

-- Token privacy: signed-in users can see and remove their inboxes, but never read or
-- change the encrypted refresh token. Inserts and updates go through the server only.
drop policy if exists "users manage own inboxes" on public.connected_inboxes;
drop policy if exists "users read own inboxes" on public.connected_inboxes;
drop policy if exists "users delete own inboxes" on public.connected_inboxes;
create policy "users read own inboxes" on public.connected_inboxes for select using (auth.uid() = user_id);
create policy "users delete own inboxes" on public.connected_inboxes for delete using (auth.uid() = user_id);
revoke all on public.connected_inboxes from anon, authenticated;
grant select (id, user_id, provider, email_address, display_name, status, created_at, last_synced_at, last_error)
  on public.connected_inboxes to authenticated;
grant delete on public.connected_inboxes to authenticated;
