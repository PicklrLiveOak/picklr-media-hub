-- Sync Instagram + Facebook every 6 hours instead of nightly, so Instagram
-- stories (only visible to the API for 24 hours) get counted toward goals.
-- (Skipped by the local test harness, which has no pg_cron.)
select cron.unschedule('social-sync-nightly');

select cron.schedule(
  'social-sync-6h',
  '15 */6 * * *',
  $$ select net.http_post(
       url     := 'https://dkfimkjsolqhxtuqxdew.supabase.co/functions/v1/social-sync',
       body    := '{"action":"cron"}'::jsonb,
       headers := '{"Content-Type":"application/json"}'::jsonb
     ); $$
);
