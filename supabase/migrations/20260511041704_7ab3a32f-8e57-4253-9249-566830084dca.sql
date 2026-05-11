
SELECT cron.unschedule('run-sequences-every-minute');
SELECT cron.unschedule('keep-alive-daily');

SELECT cron.schedule(
  'run-sequences-every-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url:='https://eyliwidiljmzllsmytdh.supabase.co/functions/v1/run-sequences',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5bGl3aWRpbGptemxsc215dGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzYzMjQsImV4cCI6MjA4OTg1MjMyNH0.hDQxG3SKyOJ06g1IpOW5h-Ubi9zPSL2HjGc4zD2wX2Y"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  );
  $$
);

CREATE INDEX IF NOT EXISTS idx_enrollments_status_next_send_at ON public.enrollments(status, next_send_at);
CREATE INDEX IF NOT EXISTS idx_enrollments_status_last_sent_at ON public.enrollments(status, last_sent_at);
CREATE INDEX IF NOT EXISTS idx_sent_emails_sender_sent ON public.sent_emails(sender_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_sent_emails_sent_at ON public.sent_emails(sent_at);
CREATE INDEX IF NOT EXISTS idx_contact_activity_created_at ON public.contact_activity(created_at);
