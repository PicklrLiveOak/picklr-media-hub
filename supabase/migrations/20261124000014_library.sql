-- Picklr Media Hub — Library: a shared place for scripts, hooks, shot lists,
-- captions, templates and notes for videos.
--
--   section.library  can open the Library (read everything in it)
--   library.edit     can add and edit docs
-- Media teams + managers get them by default; team members don't.
-- Every save keeps the previous version (library_versions) so nothing is lost.

create table public.library_docs (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(title) between 1 and 200),
  kind        text not null default 'Script'
                check (kind in ('Script', 'Hook', 'Shot list', 'Caption', 'Template', 'Notes', 'Other')),
  pillar      text references public.pillars (name) on update cascade,
  tags        text[] not null default '{}',
  body        text not null default '' check (length(body) <= 50000),
  links       jsonb not null default '[]' check (jsonb_typeof(links) = 'array'),
  request_id  uuid references public.requests (id) on delete set null,
  pinned      boolean not null default false,
  archived    boolean not null default false,
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index library_docs_updated_idx on public.library_docs (updated_at desc);

create table public.library_versions (
  id         bigint generated always as identity primary key,
  doc_id     uuid not null references public.library_docs (id) on delete cascade,
  title      text not null,
  body       text not null,
  saved_by   uuid references public.profiles (id) on delete set null,
  saved_at   timestamptz not null
);
create index library_versions_doc_idx on public.library_versions (doc_id, saved_at desc);

-- On edit: stamp who/when, and keep the old text as a version when it changed
create or replace function public.library_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if new.body is distinct from old.body or new.title is distinct from old.title then
    insert into library_versions (doc_id, title, body, saved_by, saved_at)
      values (old.id, old.title, old.body, old.updated_by, old.updated_at);
  end if;
  return new;
end $$;
create trigger library_docs_before_update before update on public.library_docs
  for each row execute function public.library_before_update();

create or replace function public.log_library_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform log_activity('library.created', 'library', new.id::text, format('%s "%s" added to the Library', new.kind, new.title));
  elsif tg_op = 'DELETE' then
    perform log_activity('library.deleted', 'library', old.id::text, format('%s "%s" deleted from the Library', old.kind, old.title));
  elsif new.archived and not old.archived then
    perform log_activity('library.archived', 'library', new.id::text, format('"%s" archived', new.title));
  elsif new.body is distinct from old.body or new.title is distinct from old.title then
    perform log_activity('library.edited', 'library', new.id::text, format('"%s" edited', new.title));
  end if;
  return coalesce(new, old);
end $$;
create trigger library_docs_log after insert or update or delete on public.library_docs
  for each row execute function public.log_library_changes();

alter table public.library_docs     enable row level security;
alter table public.library_versions enable row level security;

create policy "read library" on public.library_docs for select to authenticated
  using (public.is_active() and has_perm('section.library'));
create policy "add to library" on public.library_docs for insert to authenticated
  with check (has_perm('library.edit') and has_perm('section.library'));
create policy "edit library" on public.library_docs for update to authenticated
  using (has_perm('library.edit') and has_perm('section.library'))
  with check (has_perm('library.edit'));
-- Deleting for good: the admin or whoever created it (everyone else archives)
create policy "delete library" on public.library_docs for delete to authenticated
  using (public.is_admin() or (has_perm('library.edit') and created_by = auth.uid()));

create policy "read versions" on public.library_versions for select to authenticated
  using (public.is_active() and has_perm('section.library'));

grant select, insert, update, delete on public.library_docs to authenticated;
grant select on public.library_versions to authenticated;

-- Default access
update public.role_presets set permissions = permissions || array['section.library', 'library.edit']
  where role in ('admin', 'strategy', 'execution', 'claude');
update public.role_presets set permissions = permissions || array['section.library']
  where role = 'manager';
update public.profiles set permissions = permissions || array['section.library', 'library.edit']
  where role in ('admin', 'strategy', 'execution', 'claude') and not 'section.library' = any (permissions);
update public.profiles set permissions = permissions || array['section.library']
  where role = 'manager' and not 'section.library' = any (permissions);
