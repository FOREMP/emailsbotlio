
SELECT cron.schedule(
  'keep-alive-daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url:='https://eyliwidiljmzllsmytdh.supabase.co/functions/v1/keep-alive',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5bGl3aWRpbGptemxsc215dGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzYzMjQsImV4cCI6MjA4OTg1MjMyNH0.hDQxG3SKyOJ06g1IpOW5h-Ubi9zPSL2HjGc4zD2wX2Y"}'::jsonb,
    body:='{"type": "keep-alive"}'::jsonb
  ) AS request_id;
  $$
);
