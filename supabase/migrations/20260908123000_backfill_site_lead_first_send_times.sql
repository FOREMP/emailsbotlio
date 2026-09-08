-- The sender now records this field at the moment a first demo email succeeds.
-- Backfill historic demo sends so stock-control does not count old, already
-- contacted leads as unsent inventory.
with first_demo_sends as (
  select
    case when (c.custom_fields ->> 'site_lead_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (c.custom_fields ->> 'site_lead_id')::uuid end as site_lead_id,
    min(se.sent_at) as first_sent_at
  from public.sent_emails se
  join public.contacts c on c.id = se.contact_id
  where se.status = 'sent'
    and c.custom_fields ? 'site_lead_id'
  group by case when (c.custom_fields ->> 'site_lead_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (c.custom_fields ->> 'site_lead_id')::uuid end
)
update public.site_leads lead
set last_email_sent_at = first_demo_sends.first_sent_at
from first_demo_sends
where lead.id = first_demo_sends.site_lead_id
  and first_demo_sends.site_lead_id is not null
  and lead.last_email_sent_at is null;
