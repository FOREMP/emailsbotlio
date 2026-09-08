-- `process-site-leads` also invokes the authenticated lead-sourcing planner.
-- The previous cron SQL only ran when there was already audit/build work,
-- which made an empty Swedish lane unable to discover its first new lead.
-- Keep the same 10-minute cadence but wake the orchestrator unconditionally.

do $$
declare
  existing_job bigint;
begin
  for existing_job in select jobid from cron.job where jobname = 'process-site-leads'
  loop
    perform cron.unschedule(existing_job);
  end loop;
end;
$$;

select cron.schedule(
  'process-site-leads',
  '*/10 * * * *',
  $cron$
  select net.http_post(
    url := 'https://eyliwidiljmzllsmytdh.supabase.co/functions/v1/process-site-leads',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5bGl3aWRpbGptemxsc215dGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzYzMjQsImV4cCI6MjA4OTg1MjMyNH0.hDQxG3SKyOJ06g1IpOW5h-Ubi9zPSL2HjGc4zD2wX2Y"}'::jsonb,
    body := '{}'::jsonb
  );
  $cron$
);
