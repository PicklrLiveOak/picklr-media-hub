-- Picklr Media Hub — access levels, stage-scoped visibility, posting goals
--
-- Access levels (role presets) after this migration:
--   Admin        everything
--   Manager      sees everything (every request, everyone's calendar, insights)
--   Media Strategy / Media Execution
--                see only requests at their team's stage (+ their own), and
--                only their own calendar
--   Department Lead  their department's requests
--   Team member  only requests, calendar items and progress tied to them
-- Every toggle can still be changed per person (Admin → People / Access).

alter table public.role_presets add column sort smallint not null default 50;

insert into public.role_presets (role, label, permissions) values
  ('manager', 'Manager', array[
    'section.requests','section.board','section.calendar','section.chat','section.insights',
    'requests.view_dept','requests.view_all','requests.internal',
    'calendar.view_all','chat.create_groups']);

update public.role_presets set label = 'Team member',
  permissions = array['section.requests','section.board','section.calendar','section.chat']
  where role = 'staff';
update public.role_presets set
  permissions = array['section.requests','section.board','section.calendar','section.chat','requests.view_dept']
  where role = 'lead';
update public.role_presets set permissions = array[
    'section.requests','section.board','section.calendar','section.chat','section.insights',
    'requests.manage','requests.internal','calendar.edit','chat.create_groups','team.strategy']
  where role = 'strategy';
update public.role_presets set permissions = array[
    'section.requests','section.board','section.calendar','section.chat','section.insights',
    'requests.manage','requests.internal','calendar.edit','chat.create_groups','team.execution']
  where role = 'execution';

update public.role_presets set sort = s from (values
  ('admin', 1), ('manager', 2), ('strategy', 3), ('execution', 4), ('lead', 5), ('staff', 6), ('claude', 9)
) v(r, s) where role = v.r;

-- Bring existing Strategy / Execution people in line with their new defaults
update public.profiles
  set permissions = array(select unnest(permissions) except select unnest(array['requests.view_all','requests.view_dept','calendar.view_all']))
  where role in ('strategy', 'execution');

-- ---------- Keep the stage in step with the status --------------------------
-- Moving a card on the board (e.g. to "In Production") moves it to Execution,
-- so it shows up for the right team. "On Hold" keeps its current stage.
create or replace function public.sync_request_section() returns trigger
language plpgsql as $$
begin
  if new.status in ('New', 'In Strategy') then new.section := 'Strategy';
  elsif new.status in ('Ready for Execution', 'In Production', 'Scheduled', 'Posted') then new.section := 'Execution';
  end if;
  return new;
end $$;
-- Named so it runs after requests_guard / requests_guard_insert
create trigger requests_section_sync before insert or update of status on public.requests
  for each row execute function public.sync_request_section();
update public.requests set status = status;

-- ---------- Stage-scoped visibility ---------------------------------------
-- Strategy team sees requests in the Strategy stage; Execution team sees the
-- Execution stage. (Plus, as before: their own, assigned, department, etc.)
create or replace function public.sees_stage(sec text) returns boolean
language sql stable security definer set search_path = public as $$
  select (sec = 'Strategy' and has_perm('team.strategy'))
      or (sec = 'Execution' and has_perm('team.execution'));
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
      or sees_stage(r.section)
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
    or public.sees_stage(section)
    or public.is_assignee(id)
    or public.is_request_chat_member(id)
  ));

-- Managers who can only view shouldn't be able to edit: editing already
-- requires requests.manage (or being the requester while it's New).
-- Media-team editors only edit what they can see:
drop policy "edit requests" on public.requests;
create policy "edit requests" on public.requests for update to authenticated
  using (
    (has_perm('requests.manage') and (has_perm('requests.view_all') or public.sees_stage(section)
       or requester_id = auth.uid() or created_by = auth.uid() or public.is_assignee(id)))
    or (public.is_active() and status = 'New' and (requester_id = auth.uid() or created_by = auth.uid()))
  )
  with check (
    has_perm('requests.manage') or requester_id = auth.uid() or created_by = auth.uid()
  );

-- ---------- Posting goals (Admin → Setup) ---------------------------------
-- kind: which posts count. reel = Reels/videos, graphic = photos + carousels,
-- carousel = carousels only, story = Instagram stories, any = every post.
create table public.content_goals (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 40),
  kind       text not null check (kind in ('reel', 'graphic', 'carousel', 'story', 'any')),
  platform   text not null default 'instagram' check (platform in ('instagram', 'facebook', 'all')),
  target     smallint not null check (target between 1 and 200),
  period     text not null default 'week' check (period in ('week', 'month')),
  sort       smallint not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.content_goals (name, kind, platform, target, period, sort) values
  ('Reels', 'reel', 'instagram', 3, 'week', 1),
  ('Graphics', 'graphic', 'instagram', 2, 'week', 2);

alter table public.content_goals enable row level security;
create policy "read goals" on public.content_goals for select to authenticated using (true);
create policy "admin edits goals" on public.content_goals for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.content_goals to authenticated;
