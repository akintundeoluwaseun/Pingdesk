-- Atomic inbox lifecycle operations. Called by server code with the service
-- role only; the caller passes a user id taken from a verified session.

create or replace function public.link_gmail_inbox(
  p_user_id uuid,
  p_email text,
  p_encrypted_refresh_token text,
  p_key_version smallint,
  p_scopes text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_id uuid;
  v_was_disconnected boolean;
begin
  if p_user_id is null or v_email is null or position('@' in v_email) < 2 then
    raise exception 'invalid inbox input' using errcode = '22023';
  end if;

  select id, status = 'disconnected' into v_id, v_was_disconnected
  from public.connected_inboxes
  where user_id = p_user_id and provider = 'gmail' and email_address = v_email
  for update;

  if v_id is null then
    insert into public.connected_inboxes (user_id, email_address, label)
    values (p_user_id, v_email, left(v_email, 60))
    returning id into v_id;
  else
    update public.connected_inboxes
       set status = 'active',
           connected_at = now(),
           disconnected_at = null,
           last_error_code = null,
           last_error_at = null,
           -- after a disconnect the old history cursor may be stale
           last_history_id = case when v_was_disconnected then null else last_history_id end
     where id = v_id;
  end if;

  insert into public.inbox_credentials (inbox_id, user_id, encrypted_refresh_token, key_version, granted_scopes)
  values (v_id, p_user_id, p_encrypted_refresh_token, p_key_version, p_scopes)
  on conflict (inbox_id) do update
    set encrypted_refresh_token = excluded.encrypted_refresh_token,
        key_version = excluded.key_version,
        granted_scopes = excluded.granted_scopes;

  return v_id;
end;
$$;

-- Removes stored credentials and marks the inbox disconnected. History is kept
-- unless p_delete_history is true. Returns false if the inbox is not owned by
-- the user (callers must treat that as "not found").
create or replace function public.disconnect_inbox(
  p_user_id uuid,
  p_inbox_id uuid,
  p_delete_history boolean default false
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.connected_inboxes
   where id = p_inbox_id and user_id = p_user_id
   for update;
  if not found then
    return false;
  end if;

  delete from public.inbox_credentials where inbox_id = p_inbox_id;

  if p_delete_history then
    delete from public.connected_inboxes where id = p_inbox_id;
  else
    update public.connected_inboxes
       set status = 'disconnected', disconnected_at = now(), last_history_id = null
     where id = p_inbox_id;
  end if;
  return true;
end;
$$;

revoke all on function public.link_gmail_inbox(uuid, text, text, smallint, text) from public, anon, authenticated;
revoke all on function public.disconnect_inbox(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.link_gmail_inbox(uuid, text, text, smallint, text) to service_role;
grant execute on function public.disconnect_inbox(uuid, uuid, boolean) to service_role;
