CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule('check-tracking-hosts-daily')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'check-tracking-hosts-daily'
);

SELECT cron.schedule(
  'check-tracking-hosts-daily',
  '17 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://eyliwidiljmzllsmytdh.supabase.co/functions/v1/check-tracking-hosts',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"source":"cron"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

