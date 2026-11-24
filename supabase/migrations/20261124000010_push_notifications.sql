-- Picklr Media Hub — phone push notifications (Web Push, no email)
--
--   push_subscriptions  one row per phone/computer that tapped "Turn on notifications"
--   profiles.notify_prefs  which pushes each person wants; missing key = on.
--                       Each person edits their own (Me); the admin can edit anyone's.
--   pushed_at           set by the push-send Edge Function so nothing is sent twice
--
-- The triggers that call the Edge Function live in ..._push_triggers_cron.sql
-- (they use pg_net, which the local test harness doesn't have).

create table public.push_subscriptions (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  endpoint     text not null unique check (endpoint ~ '^https://'),
  p256dh       text not null,
  auth         text not null,
  device       text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy "my devices" on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());   -- admin can see who has notifications on
create policy "remove my devices" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
grant select, delete on public.push_subscriptions to authenticated;

-- Save this device for the signed-in person. If someone else used to be
-- signed in on the same phone, the device moves to the new person.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_device text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_active() then raise exception 'Not signed in'; end if;
  delete from push_subscriptions where endpoint = p_endpoint and user_id <> auth.uid();
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, device)
    values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_device, 120))
    on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device;
end $$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- Per-person notification settings, e.g. {"chat.general": false}
alter table public.profiles add column notify_prefs jsonb not null default '{}'::jsonb
  check (jsonb_typeof(notify_prefs) = 'object');

alter table public.notifications add column pushed_at timestamptz;
alter table public.messages add column pushed_at timestamptz;
