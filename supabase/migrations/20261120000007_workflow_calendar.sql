-- =====================================================================
-- Step 3: General chat for everyone, editable pillars + categories,
--         Strategy → Execution workflow, calendar, in-app notifications
-- =====================================================================

-- ---------- New permission toggles ---------------------------------------
--   team.strategy      receives new requests, can approve them to Execution
--   team.execution     receives approved requests, schedules shoots
--   calendar.view_all  sees everyone's calendar (otherwise only their own)
update public.role_presets set permissions = permissions || array['team.strategy', 'calendar.view_all'] where role = 'strategy';
update public.role_presets set permissions = permissions || array['team.execution', 'calendar.view_all'] where role in ('execution', 'admin');
update public.role_presets set permissions = permissions || array['calendar.view_all'] where role = 'claude';

update public.profiles set permissions = permissions || array['team.strategy', 'calendar.view_all']
  where role = 'strategy' and not 'team.strategy' = any (permissions);
update public.profiles set permissions = permissions || array['team.execution', 'calendar.view_all']
  where role in ('execution', 'admin') and not 'team.execution' = any (permissions);

-- ---------- Editable pillars + categories --------------------------------
create table public.pillars (
  name   text primary key check (length(name) between 1 and 40),
  color  text not null default '#0075E7' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort   smallint not null default 0,
  active boolean not null default true          -- "removed" = hidden from pickers, kept on old items
);
insert into public.pillars (name, color, sort) values
  ('People of The Picklr', '#0075E7', 1), ('Event Hype + Recap', '#E8590C', 2), ('Play Here', '#2F9E44', 3),
  ('Gear + Tips', '#7048E8', 4), ('Offers + Bookings', '#C2255C', 5);

create table public.request_types (
  name   text primary key check (length(name) between 1 and 40),
  sort   smallint not null default 0,
  active boolean not null default true
);
insert into public.request_types (name, sort) values
  ('Video', 1), ('Reel', 2), ('Graphic', 3), ('Story', 4), ('Livestream', 5), ('Ad', 6), ('Photo', 7), ('Other', 8);

-- Swap the fixed CHECK lists for links to the editable tables.
-- ON UPDATE CASCADE: renaming a pillar/category renames it everywhere.
alter table public.requests drop constraint requests_pillar_check;
alter table public.requests drop constraint requests_type_check;
alter table public.requests add constraint requests_pillar_fkey
  foreign key (pillar) references public.pillars (name) on update cascade on delete set null;
alter table public.requests add constraint requests_type_fkey
  foreign key (type) references public.request_types (name) on update cascade;
alter table public.social_posts drop constraint social_posts_pillar_check;
alter table public.social_posts add constraint social_posts_pillar_fkey
  foreign key (pillar) references public.pillars (name) on update cascade on delete set null;

alter table public.pillars enable row level security;
alter table public.request_types enable row level security;
create policy "read pillars" on public.pillars for select to authenticated using (true);
create policy "admin edits pillars" on public.pillars for all to authenticated
  using (has_perm('team.manage')) with check (has_perm('team.manage'));
create policy "read types" on public.request_types for select to authenticated using (true);
create policy "admin edits types" on public.request_types for all to authenticated
  using (has_perm('team.manage')) with check (has_perm('team.manage'));
grant select, insert, update, delete on public.pillars, public.request_types to authenticated;

-- ---------- In-app notifications -----------------------------------------
create table public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null,         -- request.new, request.approved, request.status, calendar.assigned, chat.mention
  title      text not null,
  body       text,
  link       text,                  -- in-app route, e.g. /r/101
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
create policy "my notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "mark mine read" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "clear mine" on public.notifications for delete to authenticated using (user_id = auth.uid());
grant select, update, delete on public.notifications to authenticated;
alter publication supabase_realtime add table public.notifications;

-- Server-side helper: notify a list of people (never the person doing the action).
create or replace function public.notify_users(p_users uuid[], p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body, link)
  select p.id, p_kind, p_title, p_body, p_link from profiles p
  where p.active and p.id = any (p_users) and p.id is distinct from auth.uid();
$$;
revoke execute on function public.notify_users(uuid[], text, text, text, text) from public, anon, authenticated;

-- People on a team (by explicit toggle, so admin bypass doesn't add everyone)
create or replace function public.team_members(p_perm text) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from profiles where active and p_perm = any (permissions);
$$;

-- New request → whole Strategy team.  Status change → the requester.
create or replace function public.notify_request_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform notify_users(team_members('team.strategy'), 'request.new',
      format('New request #%s', new.number), new.title, format('/r/%s', new.number));
  elsif new.status is distinct from old.status then
    perform notify_users(array[new.requester_id], 'request.status',
      format('#%s is now %s', new.number, new.status), new.title, format('/r/%s', new.number));
  end if;
  return new;
end $$;
create trigger requests_notify after insert or update of status on public.requests
  for each row execute function public.notify_request_changes();

-- @mentions in chat → notification
create or replace function public.notify_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; c record;
begin
  if array_length(new.mentions, 1) is null then return new; end if;
  select full_name into who from profiles where id = new.author_id;
  select ch.kind, ch.name, r.number into c from chats ch left join requests r on r.id = ch.request_id where ch.id = new.chat_id;
  perform notify_users(
    -- only people who can actually read it
    array(select m from unnest(new.mentions) m
          where exists (select 1 from chat_members cm where cm.chat_id = new.chat_id and cm.user_id = m)
            and (not new.internal or exists (select 1 from profiles p where p.id = m and ('requests.internal' = any (p.permissions) or p.role = 'admin')))),
    'chat.mention', format('%s mentioned you', who), left(new.body, 140),
    case when c.kind = 'request' then format('/r/%s', c.number) else format('/chat/%s', new.chat_id) end);
  return new;
end $$;
create trigger messages_notify after insert on public.messages
  for each row execute function public.notify_mentions();

-- ---------- Strategy → Execution approval --------------------------------
create or replace function public.approve_request(rid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not (has_perm('team.strategy') or is_admin()) then
    raise exception 'Only the Strategy team can approve requests';
  end if;
  update requests set status = 'Ready for Execution', section = 'Execution'
    where id = rid and status in ('New', 'In Strategy', 'On Hold')
    returning number, title into r;
  if r is null then raise exception 'This request is already past Strategy'; end if;
  perform log_activity('request.approved', 'request', rid::text, format('#%s approved for Execution', r.number));
  perform notify_users(team_members('team.execution'), 'request.approved',
    format('Approved for production: #%s', r.number), r.title, format('/r/%s', r.number));
end $$;

-- ---------- General chat: everyone, automatically ------------------------
alter table public.chats add column is_default boolean not null default false;
insert into public.chats (kind, name, is_default, created_by) values ('group', 'General', true, null);
insert into public.chat_members (chat_id, user_id)
  select c.id, p.id from public.chats c cross join public.profiles p
  where c.is_default and p.active
  on conflict do nothing;

create or replace function public.join_default_chats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.active and (tg_op = 'INSERT' or not old.active) then
    insert into chat_members (chat_id, user_id)
      select id, new.id from chats where is_default
      on conflict do nothing;
  end if;
  return new;
end $$;
create trigger profiles_join_default after insert or update of active on public.profiles
  for each row execute function public.join_default_chats();

-- Nobody can be removed from (or leave) General, and it can't be deleted.
drop policy "leave or remove" on public.chat_members;
create policy "leave or remove" on public.chat_members for delete to authenticated
  using ((user_id = auth.uid() or public.can_manage_chat(chat_id))
         and not exists (select 1 from public.chats c where c.id = chat_id and c.is_default));
drop policy "delete groups (admin)" on public.chats;
create policy "delete groups (admin)" on public.chats for delete to authenticated
  using (public.is_admin() and kind = 'group' and not is_default);

create or replace function public.set_group_members(cid uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_manage_chat(cid) then raise exception 'You cannot manage this group'; end if;
  if exists (select 1 from chats where id = cid and is_default) then
    raise exception 'General always includes everyone';
  end if;
  delete from chat_members where chat_id = cid and not (user_id = any (p_members));
  insert into chat_members (chat_id, user_id)
    select cid, p.id from profiles p where p.active and p.id = any (p_members)
    on conflict do nothing;
end $$;

-- chat_list gains is_default (General pinned first)
drop function public.chat_list();
create or replace function public.chat_list()
returns table (
  id uuid, kind text, name text, request_id uuid, request_number int, request_title text,
  last_message_at timestamptz, last_body text, last_author uuid, unread int, mentioned boolean,
  other_user uuid, member_count int, is_default boolean
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
    (select count(*)::int from chat_members cm where cm.chat_id = c.id),
    c.is_default
  from chats c
  join chat_members me on me.chat_id = c.id and me.user_id = auth.uid()
  left join requests r on r.id = c.request_id
  left join lateral (
    select m.body, m.author_id from messages m
    where m.chat_id = c.id and (not m.internal or has_perm('requests.internal'))
    order by m.created_at desc limit 1
  ) lm on true
  where can_access_chat(c.id)
  order by c.is_default desc, c.last_message_at desc;
$$;

-- ---------- Calendar ------------------------------------------------------
create table public.calendar_items (
  id            uuid primary key default gen_random_uuid(),
  type          text not null check (type in ('Shoot', 'Club Event', 'Post', 'Livestream', 'Meeting', 'Deadline')),
  title         text not null check (length(title) between 1 and 200),
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  all_day       boolean not null default false,
  location      text,
  notes         text,
  request_id    uuid references public.requests (id) on delete set null,
  platform      text,                                   -- Post items
  caption_draft text,
  post_status   text check (post_status in ('Draft', 'Ready', 'Scheduled', 'Posted')),
  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index calendar_items_start_idx on public.calendar_items (starts_at);

create table public.calendar_assignees (
  item_id uuid not null references public.calendar_items (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (item_id, user_id)
);

create or replace function public.is_calendar_assignee(iid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from calendar_assignees where item_id = iid and user_id = auth.uid());
$$;
create or replace function public.can_view_calendar_item(iid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_active() and has_perm('section.calendar') and exists (
    select 1 from calendar_items i where i.id = iid
      and (has_perm('calendar.view_all') or i.created_by = auth.uid() or is_calendar_assignee(i.id)));
$$;

alter table public.calendar_items     enable row level security;
alter table public.calendar_assignees enable row level security;

create policy "view calendar" on public.calendar_items for select to authenticated
  using (public.is_active() and has_perm('section.calendar')
         and (has_perm('calendar.view_all') or created_by = auth.uid() or public.is_calendar_assignee(id)));
create policy "add calendar" on public.calendar_items for insert to authenticated
  with check (has_perm('calendar.edit') and created_by = auth.uid());
create policy "edit calendar" on public.calendar_items for update to authenticated
  using (has_perm('calendar.edit') and (has_perm('calendar.view_all') or created_by = auth.uid() or public.is_calendar_assignee(id)))
  with check (has_perm('calendar.edit'));
create policy "delete calendar" on public.calendar_items for delete to authenticated
  using (has_perm('calendar.edit') and (created_by = auth.uid() or public.is_admin()));

create policy "view cal people" on public.calendar_assignees for select to authenticated
  using (public.can_view_calendar_item(item_id));
create policy "add cal people" on public.calendar_assignees for insert to authenticated
  with check (has_perm('calendar.edit') and public.can_view_calendar_item(item_id));
create policy "remove cal people" on public.calendar_assignees for delete to authenticated
  using (has_perm('calendar.edit') and public.can_view_calendar_item(item_id));

grant select, insert, update, delete on public.calendar_items, public.calendar_assignees to authenticated;
alter publication supabase_realtime add table public.calendar_items;

create or replace function public.touch_calendar_item() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger calendar_items_touch before update on public.calendar_items
  for each row execute function public.touch_calendar_item();

-- Scheduled someone → tell them (and log it)
create or replace function public.notify_calendar_assignee() returns trigger
language plpgsql security definer set search_path = public as $$
declare i record; p text;
begin
  select type, title, starts_at, all_day into i from calendar_items where id = new.item_id;
  select full_name into p from profiles where id = new.user_id;
  perform notify_users(array[new.user_id], 'calendar.assigned',
    format('You''re scheduled: %s', i.type),
    format('%s — %s', i.title, to_char(i.starts_at at time zone 'America/Chicago',
      case when i.all_day then 'Dy Mon DD' else 'Dy Mon DD, HH12:MI AM' end)),
    format('/calendar?date=%s', to_char(i.starts_at at time zone 'America/Chicago', 'YYYY-MM-DD')));
  perform log_activity('calendar.assigned', 'calendar', new.item_id::text, format('%s scheduled for %s "%s"', p, i.type, i.title));
  return new;
end $$;
create trigger calendar_assignees_notify after insert on public.calendar_assignees
  for each row execute function public.notify_calendar_assignee();

create or replace function public.log_calendar_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform log_activity('calendar.created', 'calendar', new.id::text, format('%s added: "%s"', new.type, new.title));
  elsif tg_op = 'DELETE' then
    perform log_activity('calendar.deleted', 'calendar', old.id::text, format('%s removed: "%s"', old.type, old.title));
  elsif (new.starts_at, new.ends_at, new.title) is distinct from (old.starts_at, old.ends_at, old.title) then
    perform log_activity('calendar.edited', 'calendar', new.id::text, format('%s changed: "%s"', new.type, new.title));
  end if;
  return coalesce(new, old);
end $$;
create trigger calendar_items_log after insert or update or delete on public.calendar_items
  for each row execute function public.log_calendar_changes();
