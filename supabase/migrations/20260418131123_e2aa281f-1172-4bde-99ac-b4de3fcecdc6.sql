
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any prior schedule with the same name
DO $$
BEGIN
  PERFORM cron.unschedule('run-sequences-every-minute')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-sequences-every-minute');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'run-sequences-every-minute',
  '* * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://eyliwidiljmzllsmytdh.supabase.co/functions/v1/run-sequences',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5bGl3aWRpbGptemxsc215dGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzYzMjQsImV4cCI6MjA4OTg1MjMyNH0.hDQxG3SKyOJ06g1IpOW5h-Ubi9zPSL2HjGc4zD2wX2Y"}'::jsonb,
    body := '{}'::jsonb
  );
  $cmd$
);
