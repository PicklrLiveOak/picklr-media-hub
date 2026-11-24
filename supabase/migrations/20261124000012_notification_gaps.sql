-- Picklr Media Hub — notification fixes
--   * notifications.actor_id: who caused it (so chat pushes can show their photo)
--   * "You're assigned to #N" when someone is put on a request
--   * status changes go to the requester AND everyone assigned
--   * people assigned later join the request's comment thread
--   * mute a chat (chat_members.muted): no pushes for that chat, except @mentions

alter table public.notifications add column actor_id uuid references public.profiles (id) on delete set null;

create or replace function public.notify_users(p_users uuid[], p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body, link, actor_id)
  select p.id, p_kind, p_title, p_body, p_link, auth.uid() from profiles p
  where p.active and p.id = any (p_users) and p.id is distinct from auth.uid();
$$;
revoke execute on function public.notify_users(uuid[], text, text, text, text) from public, anon, authenticated;

-- Status changes → requester, whoever filed it, and everyone assigned
create or replace function public.notify_request_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform notify_users(team_members('team.strategy'), 'request.new',
      format('New request #%s', new.number), new.title, format('/r/%s', new.number));
  elsif new.status is distinct from old.status then
    perform notify_users(
      array[new.requester_id, new.created_by] || array(select user_id from request_assignees where request_id = new.id),
      'request.status', format('#%s is now %s', new.number, new.status), new.title, format('/r/%s', new.number));
  end if;
  return new;
end $$;

-- Assigned to a request → tell them, and add them to its comment thread
create or replace function public.on_request_assigned() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select number, title into r from requests where id = new.request_id;
  perform notify_users(array[new.user_id], 'request.assigned',
    format('You''re assigned to #%s', r.number), r.title, format('/r/%s', r.number));
  insert into chat_members (chat_id, user_id, last_read_at)
    select c.id, new.user_id, '-infinity' from chats c where c.request_id = new.request_id
    on conflict do nothing;
  return new;
end $$;
create trigger request_assignees_notify after insert on public.request_assignees
  for each row execute function public.on_request_assigned();

-- Mute a chat for yourself
alter table public.chat_members add column muted boolean not null default false;

create or replace function public.set_chat_muted(cid uuid, p_muted boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_access_chat(cid) then raise exception 'Chat not found'; end if;
  insert into chat_members (chat_id, user_id, muted) values (cid, auth.uid(), p_muted)
    on conflict (chat_id, user_id) do update set muted = excluded.muted;
end $$;
revoke execute on function public.set_chat_muted(uuid, boolean) from public, anon;
grant execute on function public.set_chat_muted(uuid, boolean) to authenticated;
