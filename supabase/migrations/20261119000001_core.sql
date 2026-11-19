-- =====================================================================
-- Picklr Media Hub — Step 1: departments, profiles, permissions, requests
-- =====================================================================
-- How permissions work (see SPEC.md §3):
--   * profiles.permissions is a list of permission keys (text[]).
--   * role_presets holds the default list for each role. Choosing a role on
--     the Team page copies its preset; the admin can then toggle individual keys.
--   * RLS policies only ever check has_perm('<key>'), never the role name.
--   * role = 'admin' always passes has_perm().
-- =====================================================================

-- ---------- Departments -------------------------------------------------
create table public.departments (
  id   smallint generated always as identity primary key,
  name text not null unique,
  sort smallint not null default 0
);

insert into public.departments (name, sort) values
  ('Management', 1), ('Events & Leagues', 2), ('Sales', 3),
  ('Programs & Academy', 4), ('Operations', 5), ('Front Desk', 6),
  ('Media (Strategy)', 7), ('Media (Execution)', 8);

-- ---------- Role presets (default permission toggles) --------------------
create table public.role_presets (
  role        text primary key,
  label       text not null,
  permissions text[] not null
);

insert into public.role_presets (role, label, permissions) values
  ('admin', 'Admin', array[
    'section.requests','section.board','section.calendar','section.chat','section.insights',
    'requests.view_dept','requests.view_all','requests.manage','requests.internal',
    'calendar.edit','chat.create_groups','insights.manage','team.manage']),
  ('strategy', 'Media Strategy', array[
    'section.requests','section.board','section.calendar','section.chat','section.insights',
    'requests.view_dept','requests.view_all','requests.manage','requests.internal',
    'calendar.edit','chat.create_groups']),
  ('execution', 'Media Execution', array[
    'section.requests','section.board','section.calendar','section.chat','section.insights',
    'requests.view_dept','requests.view_all','requests.manage','requests.internal',
    'calendar.edit','chat.create_groups']),
  ('lead', 'Department Lead', array[
    'section.requests','section.calendar','section.chat','requests.view_dept']),
  ('staff', 'Staff', array[
    'section.requests','section.calendar','section.chat']),
  ('claude', 'Claude (service account)', array[
    'section.requests','section.board','section.calendar','section.chat',
    'requests.view_dept','requests.view_all','requests.manage','requests.internal',
    'calendar.edit']);

-- ---------- Profiles ------------------------------------------------------
-- One row per login. Created by the admin-users Edge Function, never by the browser.
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  username           text not null unique check (username ~ '^[a-z0-9._-]{2,32}$'),
  full_name          text not null,
  role               text not null references public.role_presets (role),
  department_id      smallint references public.departments (id),
  phone              text,
  contact_email      text,
  avatar_path        text,
  permissions        text[] not null default '{}',
  is_service_account boolean not null default false,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  -- Guard rails that no toggle can override:
  constraint service_account_never_admin
    check (not (is_service_account and (role = 'admin' or 'team.manage' = any (permissions))))
);

-- ---------- Permission helpers (used by every policy) ---------------------
-- SECURITY DEFINER so they can read profiles without tripping over RLS.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin');
$$;

create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and active and (role = 'admin' or p = any (permissions))
  );
$$;

create or replace function public.my_department() returns smallint
language sql stable security definer set search_path = public as $$
  select department_id from profiles where id = auth.uid();
$$;

-- Stop people from changing their own access (and stop non-managers from
-- changing anyone's). Admins can still edit everyone else.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;  -- service role / migrations
  if (new.role, new.permissions, new.department_id, new.active, new.username, new.is_service_account)
     is distinct from
     (old.role, old.permissions, old.department_id, old.active, old.username, old.is_service_account) then
    if not has_perm('team.manage') then
      raise exception 'Only the admin can change role, department, username or permissions';
    end if;
    if new.id = auth.uid() then
      raise exception 'You cannot change your own role or permissions';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------- Requests ------------------------------------------------------
create sequence public.request_number_seq start 101;

create table public.requests (
  id            uuid primary key default gen_random_uuid(),
  number        integer not null unique default nextval('public.request_number_seq'),
  title         text not null check (length(title) between 1 and 200),
  requester_id  uuid not null default auth.uid() references public.profiles (id),
  department_id smallint references public.departments (id),
  type          text not null check (type in ('Video','Reel','Graphic','Story','Livestream','Ad','Photo','Other')),
  event_name    text,
  event_date    date,
  needed_by     date,
  details       text,
  status        text not null default 'New' check (status in
                  ('New','In Strategy','Ready for Execution','In Production','Scheduled','Posted','On Hold')),
  section       text not null default 'Strategy' check (section in ('Strategy','Execution')),
  pillar        text check (pillar in
                  ('People of The Picklr','Event Hype + Recap','Play Here','Gear + Tips','Offers + Bookings')),
  priority      text not null default 'Normal' check (priority in ('Low','Normal','High','Urgent')),
  brief         text,
  -- Google Drive / other links: [{"label": "Raw footage", "url": "https://drive..."}]
  drive_links   jsonb not null default '[]' check (jsonb_typeof(drive_links) = 'array'),
  created_by    uuid not null default auth.uid() references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index requests_status_idx on public.requests (status);
create index requests_requester_idx on public.requests (requester_id);

create table public.request_assignees (
  request_id uuid not null references public.requests (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  primary key (request_id, user_id)
);

create table public.request_files (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.requests (id) on delete cascade,
  storage_path text not null unique,          -- path inside the "uploads" bucket
  file_name    text not null,
  mime         text not null check (mime like 'image/%' or mime = 'application/pdf'),
  size_bytes   integer not null check (size_bytes <= 10485760),  -- 10 MB
  uploaded_by  uuid not null default auth.uid() references public.profiles (id),
  created_at   timestamptz not null default now()
);

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

create or replace function public.is_assignee(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from request_assignees where request_id = rid and user_id = auth.uid());
$$;

-- Can the current user see this request? (used by child tables + storage)
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
    )
  );
$$;

-- Can the current user edit this request's basic details / files?
-- Managers always; requesters only while it is still "New".
create or replace function public.can_edit_request(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_view_request(rid) and (
    has_perm('requests.manage')
    or exists (select 1 from requests r where r.id = rid and r.status = 'New'
               and (r.requester_id = auth.uid() or r.created_by = auth.uid()))
  );
$$;

-- Non-managers may only edit the "form" fields, never workflow fields.
create or replace function public.guard_request_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if auth.uid() is null or has_perm('requests.manage') then return new; end if;
  if (new.status, new.section, new.pillar, new.priority, new.brief, new.requester_id, new.number, new.created_by)
     is distinct from
     (old.status, old.section, old.pillar, old.priority, old.brief, old.requester_id, old.number, old.created_by) then
    raise exception 'Only the media team can change status, section, pillar, priority or brief';
  end if;
  return new;
end $$;

create trigger requests_guard before update on public.requests
  for each row execute function public.guard_request_update();

-- New requests from non-managers always start as "New" in Strategy.
create or replace function public.guard_request_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or has_perm('requests.manage') then return new; end if;
  new.status := 'New';
  new.section := 'Strategy';
  new.brief := null;
  new.created_by := auth.uid();
  return new;
end $$;

create trigger requests_guard_insert before insert on public.requests
  for each row execute function public.guard_request_insert();

-- ---------- Row Level Security ------------------------------------------
alter table public.departments       enable row level security;
alter table public.role_presets      enable row level security;
alter table public.profiles          enable row level security;
alter table public.requests          enable row level security;
alter table public.request_assignees enable row level security;
alter table public.request_files     enable row level security;

-- Lookup tables: readable by any signed-in user.
create policy "read departments" on public.departments for select to authenticated using (true);
create policy "read presets"     on public.role_presets for select to authenticated using (true);

-- Profiles: everyone signed in sees the team directory.
-- You can edit yourself (name, phone, photo...); the admin can edit anyone.
-- Inserts/deletes only happen through the admin-users Edge Function.
create policy "read profiles" on public.profiles for select to authenticated using (true);
create policy "update profiles" on public.profiles for update to authenticated
  using (id = auth.uid() or has_perm('team.manage'))
  with check (id = auth.uid() or has_perm('team.manage'));

-- Requests
-- (These policies check the row's own columns instead of calling
--  can_view_request(id), so a brand-new row is visible in INSERT ... RETURNING.)
create policy "view requests" on public.requests for select to authenticated
  using (public.is_active() and (
    requester_id = auth.uid() or created_by = auth.uid()
    or has_perm('requests.view_all')
    or (has_perm('requests.view_dept') and department_id = public.my_department())
    or public.is_assignee(id)
  ));
create policy "create requests" on public.requests for insert to authenticated
  with check (
    has_perm('section.requests')
    and (requester_id = auth.uid() or has_perm('requests.manage'))
  );
create policy "edit requests" on public.requests for update to authenticated
  using (
    has_perm('requests.manage')
    or (public.is_active() and status = 'New' and (requester_id = auth.uid() or created_by = auth.uid()))
  )
  with check (
    has_perm('requests.manage') or requester_id = auth.uid() or created_by = auth.uid()
  );
create policy "delete requests (admin only)" on public.requests for delete to authenticated
  using (public.is_admin());

-- Assignees: visible with the request; only managers change them.
create policy "view assignees" on public.request_assignees for select to authenticated
  using (public.can_view_request(request_id));
create policy "add assignees" on public.request_assignees for insert to authenticated
  with check (has_perm('requests.manage') and public.can_view_request(request_id));
create policy "remove assignees" on public.request_assignees for delete to authenticated
  using (has_perm('requests.manage') and public.can_view_request(request_id));

-- Files: visible with the request; added by anyone who can edit it.
-- Removing a file: the admin, or the uploader while they can still edit the request.
create policy "view files" on public.request_files for select to authenticated
  using (public.can_view_request(request_id));
create policy "add files" on public.request_files for insert to authenticated
  with check (uploaded_by = auth.uid() and public.can_edit_request(request_id));
create policy "remove files" on public.request_files for delete to authenticated
  using (public.is_admin() or (uploaded_by = auth.uid() and public.can_edit_request(request_id)));

-- Table privileges (RLS still applies on top of these).
grant select on public.departments, public.role_presets to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.requests, public.request_assignees, public.request_files to authenticated;
grant usage on sequence public.request_number_seq to authenticated;

-- Live board updates
alter publication supabase_realtime add table public.requests;
