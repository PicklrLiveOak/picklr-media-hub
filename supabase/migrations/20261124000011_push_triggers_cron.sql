-- Hand new notifications and chat messages to the push-send Edge Function.
-- pg_net queues the HTTP call and sends it after the transaction commits.
-- The function only receives an id; it looks the row up itself and marks it
-- pushed, so a forged call can't invent messages or send anything twice.
-- (Named *_cron so the local test harness, which has no pg_net, skips it.)
create extension if not exists pg_net;

create or replace function public.queue_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url     := 'https://dkfimkjsolqhxtuqxdew.supabase.co/functions/v1/push-send',
    body    := jsonb_build_object('type', tg_argv[0], 'id', new.id),
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  return new;
exception when others then
  return new;  -- never block a message or notification because of push
end $$;

create trigger notifications_push after insert on public.notifications
  for each row execute function public.queue_push('notification');
create trigger messages_push after insert on public.messages
  for each row execute function public.queue_push('message');
