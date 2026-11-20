-- =====================================================================
-- Insights: Instagram + Facebook analytics (synced nightly by the
-- social-sync Edge Function)
-- =====================================================================

-- Meta access tokens live in a schema the website can't reach at all.
-- Only the social-sync function (service role) reads/writes them.
create schema if not exists private;
revoke all on schema private from public;

create table private.social_tokens (
  platform   text primary key check (platform in ('facebook')),
  token      text not null,          -- long-lived Page token (also used for Instagram)
  updated_at timestamptz not null default now()
);

create or replace function public.store_social_token(p_token text) returns void
language sql security definer set search_path = public, private as $$
  insert into private.social_tokens (platform, token) values ('facebook', p_token)
  on conflict (platform) do update set token = excluded.token, updated_at = now();
$$;
create or replace function public.get_social_token() returns text
language sql security definer set search_path = public, private as $$
  select token from private.social_tokens where platform = 'facebook';
$$;
create or replace function public.clear_social_token() returns void
language sql security definer set search_path = public, private as $$
  delete from private.social_tokens;
$$;
revoke execute on function public.store_social_token(text) from public, anon, authenticated;
revoke execute on function public.get_social_token() from public, anon, authenticated;
revoke execute on function public.clear_social_token() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.store_social_token(text), public.get_social_token(), public.clear_social_token() to service_role;
  end if;
end $$;

-- Connected accounts (no secrets here)
create table public.social_accounts (
  platform       text primary key check (platform in ('instagram', 'facebook')),
  external_id    text not null,
  name           text,
  username       text,
  followers      integer,
  connected_at   timestamptz not null default now(),
  last_synced_at timestamptz,
  last_error     text
);

-- One row per platform per day: follower count + account totals
create table public.social_daily (
  platform     text not null check (platform in ('instagram', 'facebook')),
  day          date not null,
  followers    integer,
  reach        integer,
  views        integer,
  interactions integer,
  primary key (platform, day)
);

-- One row per post, refreshed each sync (latest lifetime numbers)
create table public.social_posts (
  id            text primary key,                 -- '<platform>:<id>'
  platform      text not null check (platform in ('instagram', 'facebook')),
  external_id   text not null,
  posted_at     timestamptz not null,
  media_type    text,                             -- REEL, IMAGE, CAROUSEL, VIDEO, STORY, LINK…
  caption       text,
  permalink     text,
  thumbnail_url text,
  views         integer,
  reach         integer,
  likes         integer,
  comments      integer,
  shares        integer,
  saves         integer,
  reposts       integer,
  interactions  integer,
  pillar        text check (pillar in
                  ('People of The Picklr','Event Hype + Recap','Play Here','Gear + Tips','Offers + Bookings')),
  request_id    uuid references public.requests (id) on delete set null,
  synced_at     timestamptz not null default now()
);
create index social_posts_posted_idx on public.social_posts (posted_at desc);

alter table public.social_accounts enable row level security;
alter table public.social_daily    enable row level security;
alter table public.social_posts    enable row level security;

create policy "insights: read accounts" on public.social_accounts for select to authenticated using (has_perm('section.insights'));
create policy "insights: read daily"    on public.social_daily    for select to authenticated using (has_perm('section.insights'));
create policy "insights: read posts"    on public.social_posts    for select to authenticated using (has_perm('section.insights'));
-- Tag a post with a pillar / link it to a request
create policy "insights: tag posts" on public.social_posts for update to authenticated
  using (has_perm('section.insights') and (has_perm('insights.manage') or has_perm('requests.manage')))
  with check (true);

-- Tagging may only change pillar + request link, never the numbers
create or replace function public.guard_post_tagging() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.views, new.reach, new.likes, new.comments, new.shares, new.saves, new.reposts, new.posted_at, new.platform)
     is distinct from (old.views, old.reach, old.likes, old.comments, old.shares, old.saves, old.reposts, old.posted_at, old.platform) then
    raise exception 'Only pillar and request can be changed';
  end if;
  return new;
end $$;
create trigger social_posts_guard before update on public.social_posts
  for each row execute function public.guard_post_tagging();

grant select on public.social_accounts, public.social_daily, public.social_posts to authenticated;
grant update (pillar, request_id) on public.social_posts to authenticated;
