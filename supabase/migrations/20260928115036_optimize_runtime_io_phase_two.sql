-- Spread the three busiest workers across the clock. They previously started
-- together at :00/:10/etc, which caused database and Edge Function startup
-- contention without increasing throughput.
do $$
declare
  target_job_id bigint;
begin
  select jobid into target_job_id from cron.job where jobname = 'process-site-jobs';
  if target_job_id is not null then
    perform cron.alter_job(target_job_id, schedule := '1-59/5 * * * *');
  end if;

  select jobid into target_job_id from cron.job where jobname = 'process-site-leads';
  if target_job_id is not null then
    perform cron.alter_job(target_job_id, schedule := '3-59/10 * * * *');
  end if;

  select jobid into target_job_id from cron.job where jobname = 'run-sequences-every-10min';
  if target_job_id is not null then
    perform cron.alter_job(target_job_id, schedule := '7-59/10 * * * *');
  end if;
end
$$;

-- Evaluate auth.uid() once per statement instead of once per row. This keeps
-- the exact same access rules while reducing CPU on the application's hottest
-- tables (Supabase's auth_rls_initplan recommendation).
alter policy "Users can manage their own contacts"
  on public.contacts
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "Users manage own enrollments"
  on public.enrollments
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "Users manage own generated sites"
  on public.generated_sites
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "Users manage own sent_emails"
  on public.sent_emails
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "Users manage own site_leads"
  on public.site_leads
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
