-- Nightly Instagram + Facebook sync at 2:15 AM San Antonio time (08:15 UTC).
-- pg_cron runs the schedule; pg_net makes the HTTP call to the Edge Function.
-- (Skipped by the local test harness, which has no pg_cron.)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'social-sync-nightly',
  '15 8 * * *',
  $$ select net.http_post(
       url     := 'https://dkfimkjsolqhxtuqxdew.supabase.co/functions/v1/social-sync',
       body    := '{"action":"cron"}'::jsonb,
       headers := '{"Content-Type":"application/json"}'::jsonb
     ); $$
);
