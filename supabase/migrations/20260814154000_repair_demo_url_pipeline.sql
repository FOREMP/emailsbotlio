-- Canonical demo URL repair:
-- 1) backfill canonical URLs into contacts for rows that already have stable URLs
-- 2) requeue rows that still point at temporary Vercel deployment URLs so the
--    fixed deploy-site function republishes them with a stable public URL

-- Keep canonical rows in sync across generated_sites -> site_leads -> contacts.
update public.site_leads sl
set demo_url = gs.demo_site_url
from public.generated_sites gs
where sl.generated_site_id = gs.id
  and gs.demo_site_url ~ '^https://[^/]+\\.vercel\\.app/?$'
  and gs.demo_site_url !~ '-foremp\\.vercel\\.app/?$'
  and sl.demo_url is distinct from gs.demo_site_url;

update public.contacts c
set demo_site_url = sl.demo_url
from public.site_leads sl
where c.custom_fields->>'site_lead_id' = sl.id::text
  and sl.demo_url ~ '^https://[^/]+\\.vercel\\.app/?$'
  and sl.demo_url !~ '-foremp\\.vercel\\.app/?$'
  and c.demo_site_url is distinct from sl.demo_url;

update public.contacts c
set custom_fields = jsonb_set(
  coalesce(c.custom_fields, '{}'::jsonb),
  '{demo_url}',
  to_jsonb(sl.demo_url),
  true
)
from public.site_leads sl
where c.custom_fields->>'site_lead_id' = sl.id::text
  and sl.demo_url ~ '^https://[^/]+\\.vercel\\.app/?$'
  and sl.demo_url !~ '-foremp\\.vercel\\.app/?$'
  and coalesce(c.custom_fields->>'demo_url', '') is distinct from sl.demo_url;

-- Temporary deployment URLs are not safe to send. Requeue those sites for a
-- fresh deploy so the updated deploy-site function can publish a stable alias.
with bad_live as (
  select gs.id, gs.site_lead_id
  from public.generated_sites gs
  where gs.status = 'live'
    and gs.site_lead_id is not null
    and gs.demo_site_url ~ '-foremp\\.vercel\\.app/?$'
)
update public.generated_sites gs
set status = 'generated',
    demo_site_url = null,
    error_message = 'Requeued on August 14, 2026 to replace temporary Vercel deployment URL with stable public demo URL.'
from bad_live b
where gs.id = b.id;

with bad_live as (
  select gs.site_lead_id
  from public.generated_sites gs
  where gs.status = 'generated'
    and gs.site_lead_id is not null
    and gs.error_message = 'Requeued on August 14, 2026 to replace temporary Vercel deployment URL with stable public demo URL.'
)
update public.site_leads sl
set status = 'generating',
    demo_url = null,
    feedback = null
from bad_live b
where sl.id = b.site_lead_id;
