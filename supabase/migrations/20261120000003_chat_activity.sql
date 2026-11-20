-- =====================================================================
-- Step 2: department text box, chat (DMs / groups / request threads),
--         activity log for the admin dashboard
-- =====================================================================

-- ---------- Requests: free-text department ------------------------------
-- The form now has a text box. department_id is still filled in
-- automatically from the requester's profile so department leads keep
-- seeing their team's requests.
alter table public.requests add column department_label text
  check (department_label is null or length(department_label) <= 80);

create or replace function public.default_request_department() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.department_id is null then
    select department_id into new.department_id from profiles where id = new.requester_id;
  end if;
  return new;
end $$;

create trigger requests_default_dept before insert on public.requests
  for each row execute function public.default_request_department();

-- ---------- Chat tables ---------------------------------------------------
create table public.chats (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('dm', 'group', 'request')),
  name            text check (name is null or length(name) between 1 and 80),
  request_id      uuid unique references public.requests (id) on delete cascade,
  created_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  check ((kind = 'request') = (request_id is not null)),
  check (kind <> 'group' or name is not null)
);

create table public.chat_members (
  chat_id      uuid not null references public.chats (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  added_at     timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create index chat_members_user_idx on public.chat_members (user_id);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  chat_id         uuid not null references public.chats (id) on delete cascade,
  author_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body            text not null default '' check (length(body) <= 4000),
  mentions        uuid[] not null default '{}',     -- people @mentioned
  attachment_path text,                              -- image in the uploads bucket
  link_url        text check (link_url is null or link_url ~ '^https?://'),
  internal        boolean not null default false,    -- request threads: media team only
  created_at      timestamptz not null default now(),
  check (length(body) > 0 or attachment_path is not null or link_url is not null)
);
create index messages_chat_idx on public.messages (chat_id, created_at desc);
create index messages_mentions_idx on public.messages using gin (mentions);

-- ---------- Chat permission helpers --------------------------------------
create or replace function public.is_chat_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from chat_members where chat_id = cid and user_id = auth.uid());
$$;

-- People added to a request's thread (e.g. @mentioned by the media team)
-- can also open that request.
create or replace function public.is_request_chat_member(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from chats c join chat_members m on m.chat_id = c.id
                 where c.request_id = rid and m.user_id = auth.uid());
$$;

create or replace function public.can_view_request(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from requests r
    where r.id = rid and is_active() and (
      r.requester_id = auth.uid()
      or r.created_by = auth.uid()
      or has_perm('requests.view_all')
      or (has_perm('requests.view_dept') and r.department_id = my_department())
      or exists (select 1 from request_assignees a where a.request_id = r.id and a.user_id = auth.uid())
      or is_request_chat_member(r.id)
    )
  );
$$;

drop policy "view requests" on public.requests;
create policy "view requests" on public.requests for select to authenticated
  using (public.is_active() and (
    requester_id = auth.uid() or created_by = auth.uid()
    or has_perm('requests.view_all')
    or (has_perm('requests.view_dept') and department_id = public.my_department())
    or public.is_assignee(id)
    or public.is_request_chat_member(id)
  ));

-- Who can open a chat:
--   request thread → anyone who can see the request
--   DM / group     → members (with the Chat section on); admins see every group
create or replace function public.can_access_chat(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_active() and exists (
    select 1 from chats c where c.id = cid and (
      (c.kind = 'request' and can_view_request(c.request_id))
      or (has_perm('section.chat') and (
            exists (select 1 from chat_members m where m.chat_id = c.id and m.user_id = auth.uid())
            or (c.kind = 'group' and has_perm('team.manage'))))
    )
  );
$$;

-- Who can rename a group / change its members: the admin, or the person
-- who created it (if they're allowed to create groups).
create or replace function public.can_manage_chat(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from chats c where c.id = cid and c.kind = 'group'
      and (has_perm('team.manage') or (has_perm('chat.create_groups') and c.created_by = auth.uid()))
  );
$$;

-- ---------- Chat actions (called from the app) ---------------------------
-- Open (or create) a direct message with someone.
create or replace function public.start_dm(other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not has_perm('section.chat') then raise exception 'Chat is turned off for your account'; end if;
  if other = auth.uid() then raise exception 'Pick someone else'; end if;
  if not exists (select 1 from profiles where id = other and active) then raise exception 'That person is not active'; end if;
  select c.id into cid from chats c
    where c.kind = 'dm'
      and exists (select 1 from chat_members where chat_id = c.id and user_id = auth.uid())
      and exists (select 1 from chat_members where chat_id = c.id and user_id = other)
    limit 1;
  if cid is null then
    insert into chats (kind, created_by) values ('dm', auth.uid()) returning id into cid;
    insert into chat_members (chat_id, user_id) values (cid, auth.uid()), (cid, other);
  end if;
  return cid;
end $$;

-- Create a group chat (needs "Create group chats").
create or replace function public.create_group(p_name text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not has_perm('chat.create_groups') then raise exception 'You are not allowed to create group chats'; end if;
  insert into chats (kind, name, created_by) values ('group', trim(p_name), auth.uid()) returning id into cid;
  insert into chat_members (chat_id, user_id)
    select cid, p.id from profiles p where p.active and (p.id = auth.uid() or p.id = any (p_members))
    on conflict do nothing;
  return cid;
end $$;

-- Replace a group's member list.
create or replace function public.set_group_members(cid uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_manage_chat(cid) then raise exception 'You cannot manage this group'; end if;
  delete from chat_members where chat_id = cid and not (user_id = any (p_members));
  insert into chat_members (chat_id, user_id)
    select cid, p.id from profiles p where p.active and p.id = any (p_members)
    on conflict do nothing;
end $$;

-- Get (or create) the comment thread for a request. The requester and
-- assignees are added so it shows in their chat list.
create or replace function public.request_chat(rid uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not can_view_request(rid) then raise exception 'Request not found'; end if;
  select id into cid from chats where request_id = rid;
  if cid is null then
    insert into chats (kind, request_id, created_by) values ('request', rid, auth.uid())
      on conflict (request_id) do nothing returning id into cid;
    if cid is null then select id into cid from chats where request_id = rid; end if;
    insert into chat_members (chat_id, user_id)
      select cid, r.requester_id from requests r where r.id = rid
      union select cid, a.user_id from request_assignees a where a.request_id = rid
      on conflict do nothing;
  end if;
  return cid;
end $$;

-- Mark a chat as read (creates the membership row for request threads).
create or replace function public.mark_read(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_access_chat(cid) then return; end if;
  insert into chat_members (chat_id, user_id, last_read_at) values (cid, auth.uid(), now())
    on conflict (chat_id, user_id) do update set last_read_at = now();
end $$;

-- After a message: bump the chat, mark it read for the author, and loop in
-- people the media team @mentions in a request thread.
create or replace function public.after_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  update chats set last_message_at = new.created_at where id = new.chat_id returning kind into k;
  insert into chat_members (chat_id, user_id, last_read_at) values (new.chat_id, new.author_id, new.created_at)
    on conflict (chat_id, user_id) do update set last_read_at = excluded.last_read_at;
  if k = 'request' and array_length(new.mentions, 1) > 0 and has_perm('requests.manage') and not new.internal then
    insert into chat_members (chat_id, user_id, last_read_at)
      select new.chat_id, p.id, '-infinity' from profiles p where p.active and p.id = any (new.mentions)
      on conflict do nothing;
  end if;
  return new;
end $$;

create trigger messages_after_insert after insert on public.messages
  for each row execute function public.after_message();

-- The chat list: every chat I'm in, newest first, with unread counts.
create or replace function public.chat_list()
returns table (
  id uuid, kind text, name text, request_id uuid, request_number int, request_title text,
  last_message_at timestamptz, last_body text, last_author uuid, unread int, mentioned boolean,
  other_user uuid, member_count int
)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.name, c.request_id, r.number, r.title, c.last_message_at,
    lm.body, lm.author_id,
    (select count(*)::int from messages m
       where m.chat_id = c.id and m.author_id <> auth.uid() and m.created_at > me.last_read_at
         and (not m.internal or has_perm('requests.internal'))),
    exists (select 1 from messages m
       where m.chat_id = c.id and m.created_at > me.last_read_at and auth.uid() = any (m.mentions)
         and (not m.internal or has_perm('requests.internal'))),
    (select cm.user_id from chat_members cm where cm.chat_id = c.id and cm.user_id <> auth.uid() limit 1),
    (select count(*)::int from chat_members cm where cm.chat_id = c.id)
  from chats c
  join chat_members me on me.chat_id = c.id and me.user_id = auth.uid()
  left join requests r on r.id = c.request_id
  left join lateral (
    select m.body, m.author_id from messages m
    where m.chat_id = c.id and (not m.internal or has_perm('requests.internal'))
    order by m.created_at desc limit 1
  ) lm on true
  where can_access_chat(c.id)
  order by c.last_message_at desc;
$$;

-- ---------- Chat RLS -----------------------------------------------------
alter table public.chats        enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages     enable row level security;

create policy "view chats" on public.chats for select to authenticated using (public.can_access_chat(id));
create policy "rename groups" on public.chats for update to authenticated
  using (public.can_manage_chat(id)) with check (kind = 'group');
create policy "delete groups (admin)" on public.chats for delete to authenticated
  using (public.is_admin() and kind = 'group');

create policy "view members" on public.chat_members for select to authenticated
  using (public.can_access_chat(chat_id));
create policy "update my read marker" on public.chat_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "leave or remove" on public.chat_members for delete to authenticated
  using (user_id = auth.uid() or public.can_manage_chat(chat_id));

create policy "read messages" on public.messages for select to authenticated
  using (public.can_access_chat(chat_id) and (not internal or has_perm('requests.internal')));
create policy "send messages" on public.messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_access_chat(chat_id)
    and (not internal or (has_perm('requests.internal')
         and exists (select 1 from chats c where c.id = chat_id and c.kind = 'request')))
  );
create policy "delete own messages" on public.messages for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

grant select, update, delete on public.chats to authenticated;
grant select, update, delete on public.chat_members to authenticated;
grant select, insert, delete on public.messages to authenticated;

alter publication supabase_realtime add table public.messages;

-- Starter group chats. The admin adds members from the Admin → Chats page.
insert into public.chats (kind, name, created_by)
select 'group', n, null from unnest(array[
  'Media Team', 'Strategy ↔ Execution', 'Management', 'Events & Leagues', 'Sales',
  'Programs & Academy', 'Operations', 'Front Desk']) as n;
insert into public.chat_members (chat_id, user_id)
select c.id, p.id from public.chats c cross join public.profiles p
where c.kind = 'group' and p.role = 'admin';

-- Chat image uploads: chat/<chat_id>/<file>
create policy "uploads: chat read" on storage.objects for select to authenticated using (
  bucket_id = 'uploads' and split_part(name, '/', 1) = 'chat' and public.can_access_chat(public.path_uuid(name, 2)));
create policy "uploads: chat add" on storage.objects for insert to authenticated with check (
  bucket_id = 'uploads' and split_part(name, '/', 1) = 'chat' and public.can_access_chat(public.path_uuid(name, 2)));

-- ---------- Activity log (Admin → Activity) ------------------------------
create table public.activity_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid references public.profiles (id) on delete set null default auth.uid(),
  source      text not null default 'app' check (source in ('app', 'mcp', 'system')),
  action      text not null,          -- e.g. request.status, user.permissions
  target_type text,
  target_id   text,
  summary     text not null,
  details     jsonb
);
create index activity_log_at_idx on public.activity_log (at desc);

alter table public.activity_log enable row level security;
create policy "admin reads activity" on public.activity_log for select to authenticated
  using (has_perm('team.manage'));
grant select on public.activity_log to authenticated;

create or replace function public.log_activity(p_action text, p_type text, p_id text, p_summary text, p_details jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into activity_log (actor_id, action, target_type, target_id, summary, details)
  values (auth.uid(), p_action, p_type, p_id, p_summary, p_details);
$$;
revoke execute on function public.log_activity(text, text, text, text, jsonb) from public, anon, authenticated;

-- Requests
create or replace function public.log_request_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform log_activity('request.created', 'request', new.id::text, format('#%s %s', new.number, new.title));
  elsif tg_op = 'DELETE' then
    perform log_activity('request.deleted', 'request', old.id::text, format('#%s %s', old.number, old.title));
  else
    if new.status is distinct from old.status then
      perform log_activity('request.status', 'request', new.id::text,
        format('#%s %s → %s', new.number, old.status, new.status));
    end if;
    if new.brief is distinct from old.brief then
      perform log_activity('request.brief', 'request', new.id::text, format('#%s brief/script updated', new.number));
    end if;
    if (new.title, new.details, new.needed_by, new.event_date, new.pillar, new.priority, new.section, new.drive_links)
       is distinct from (old.title, old.details, old.needed_by, old.event_date, old.pillar, old.priority, old.section, old.drive_links) then
      perform log_activity('request.edited', 'request', new.id::text, format('#%s details edited', new.number));
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger requests_log after insert or update or delete on public.requests
  for each row execute function public.log_request_changes();

create or replace function public.log_assignee_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; p text;
begin
  select number, title into r from requests where id = coalesce(new.request_id, old.request_id);
  select full_name into p from profiles where id = coalesce(new.user_id, old.user_id);
  if r is null then return null; end if;  -- request is being deleted
  if tg_op = 'INSERT' then
    perform log_activity('request.assigned', 'request', new.request_id::text, format('#%s assigned to %s', r.number, p));
  else
    perform log_activity('request.unassigned', 'request', old.request_id::text, format('#%s: %s removed', r.number, p));
  end if;
  return null;
end $$;
create trigger assignees_log after insert or delete on public.request_assignees
  for each row execute function public.log_assignee_changes();

-- People: role / permission / department / active changes
create or replace function public.log_profile_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare added text[]; removed text[];
begin
  if new.permissions is distinct from old.permissions or new.role is distinct from old.role then
    select array_agg(x) into added from unnest(new.permissions) x where not x = any (old.permissions);
    select array_agg(x) into removed from unnest(old.permissions) x where not x = any (new.permissions);
    perform log_activity('user.permissions', 'user', new.id::text,
      format('%s: access changed%s', new.full_name, case when new.role <> old.role then format(' (role %s → %s)', old.role, new.role) else '' end),
      jsonb_build_object('added', coalesce(added, '{}'), 'removed', coalesce(removed, '{}')));
  end if;
  if new.active is distinct from old.active then
    perform log_activity(case when new.active then 'user.reactivated' else 'user.deactivated' end, 'user', new.id::text,
      format('%s %s', new.full_name, case when new.active then 'reactivated' else 'deactivated' end));
  end if;
  if new.department_id is distinct from old.department_id then
    perform log_activity('user.department', 'user', new.id::text, format('%s moved department', new.full_name));
  end if;
  return new;
end $$;
create trigger profiles_log after update on public.profiles
  for each row execute function public.log_profile_changes();

-- Group chats
create or replace function public.log_chat_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.kind = 'group' then
    perform log_activity('chat.created', 'chat', new.id::text, format('Group "%s" created', new.name));
  elsif tg_op = 'UPDATE' and new.name is distinct from old.name then
    perform log_activity('chat.renamed', 'chat', new.id::text, format('Group "%s" renamed to "%s"', old.name, new.name));
  elsif tg_op = 'DELETE' and old.kind = 'group' then
    perform log_activity('chat.deleted', 'chat', old.id::text, format('Group "%s" deleted', old.name));
  end if;
  return coalesce(new, old);
end $$;
create trigger chats_log after insert or update or delete on public.chats
  for each row execute function public.log_chat_changes();

create or replace function public.log_member_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record; p text;
begin
  select kind, name into c from chats where id = coalesce(new.chat_id, old.chat_id);
  if c is null or c.kind <> 'group' or auth.uid() is null then return null; end if;
  select full_name into p from profiles where id = coalesce(new.user_id, old.user_id);
  if tg_op = 'INSERT' then
    perform log_activity('chat.member_added', 'chat', new.chat_id::text, format('%s added to "%s"', p, c.name));
  else
    perform log_activity('chat.member_removed', 'chat', old.chat_id::text, format('%s removed from "%s"', p, c.name));
  end if;
  return null;
end $$;
create trigger chat_members_log after insert or delete on public.chat_members
  for each row execute function public.log_member_changes();
