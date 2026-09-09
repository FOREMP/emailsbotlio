-- A score of 7–10 means the current website is already good enough. Enforce
-- that rule in the database as well as the edge function so a stale function
-- deployment, manual import, or alternate audit path cannot leave those leads
-- in the manual audit queue.

create or replace function public.enforce_high_quality_audit_disposition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.audit_score >= 7
     and new.status in ('awaiting_audit_approval', 'needs_triage') then
    new.status := 'site_good_enough';
    new.auto_send := false;
    new.triaged_at := coalesce(new.triaged_at, now());
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_high_quality_audit_disposition() from public;

drop trigger if exists enforce_high_quality_audit_disposition on public.site_leads;
create trigger enforce_high_quality_audit_disposition
before insert or update of audit_score, status on public.site_leads
for each row
execute function public.enforce_high_quality_audit_disposition();

-- Repair only untouched audit decisions. Do not disturb leads that have
-- already entered manual demo approval or an outreach enrollment.
update public.site_leads
set
  status = 'site_good_enough',
  auto_send = false,
  triaged_at = coalesce(triaged_at, now())
where status in ('awaiting_audit_approval', 'needs_triage')
  and audit_score >= 7;
