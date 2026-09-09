-- Route foremp.one to Swedish outreach and raise the two smaller Foremp
-- domains conservatively. foremp.email remains unchanged at 12 per sender.
update public.senders
set language = 'sv', daily_limit = 8, updated_at = now()
where is_active = true
  and split_part(lower(from_email), '@', 2) = 'foremp.one';

update public.senders
set language = 'en', daily_limit = 8, updated_at = now()
where is_active = true
  and split_part(lower(from_email), '@', 2) = 'foremp.eu';

update public.sequence_nodes n
set config = jsonb_set(n.config, '{sender_domain}', to_jsonb('foremp.email,foremp.one'::text), true),
    updated_at = now()
from public.sequences s
where n.sequence_id = s.id
  and s.name = 'Site Demo Outreach'
  and n.node_type = 'send_email';

update public.sequence_nodes n
set config = jsonb_set(n.config, '{sender_domain}', to_jsonb('foremp.eu'::text), true),
    updated_at = now()
from public.sequences s
where n.sequence_id = s.id
  and s.name = 'Site Demo Outreach EN'
  and n.node_type = 'send_email';

update public.sequence_nodes n
set config = jsonb_set(n.config, '{max_per_day}', '40'::jsonb, true),
    updated_at = now()
from public.sequences s
where n.sequence_id = s.id
  and s.name = 'Site Demo Outreach'
  and n.node_type = 'throttle';

update public.sequence_nodes n
set config = jsonb_set(n.config, '{max_per_day}', '16'::jsonb, true),
    updated_at = now()
from public.sequences s
where n.sequence_id = s.id
  and s.name = 'Site Demo Outreach EN'
  and n.node_type = 'throttle';

-- Existing English conversations previously pinned to foremp.one continue
-- safely from foremp.eu on their next step.
update public.enrollments e
set assigned_sender_id = null, updated_at = now()
from public.sequences q, public.senders old_sender
where e.sequence_id = q.id
  and e.assigned_sender_id = old_sender.id
  and q.name = 'Site Demo Outreach EN'
  and split_part(lower(old_sender.from_email), '@', 2) = 'foremp.one'
  and e.status in ('active', 'waiting', 'waiting_capacity');
