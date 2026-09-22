-- Register the two email-only website outreach subdomains. They intentionally
-- remain unverified until Lovable Emails has accepted the corresponding
-- notify.<domain> sending domains and DNS delegation is complete.
insert into public.sending_domains (
  domain,
  brand,
  reply_to_email,
  sender_subdomain,
  is_active,
  is_verified,
  postal_address
)
values
  ('website.foremp.email', 'foremp', 'eric@foremp.se', 'notify', true, false, 'FOREMP, Lund, Sweden'),
  ('website.botlio.email', 'botlio', 'eric@foremp.se', 'notify', true, false, 'FOREMP, Lund, Sweden')
on conflict (domain) do update
set brand = excluded.brand,
    reply_to_email = excluded.reply_to_email,
    sender_subdomain = excluded.sender_subdomain,
    is_active = excluded.is_active,
    postal_address = excluded.postal_address,
    updated_at = now();

-- Provision Eric and Isak for every existing outreach-system owner. Warm-up
-- stays disabled until the Lovable sending domains are really verified; this
-- prevents the ramp clock advancing while the domains cannot send.
insert into public.senders (
  user_id,
  from_name,
  from_email,
  reply_to,
  is_active,
  daily_limit,
  followup_multiplier,
  warmup_enabled,
  warmup_started_at,
  warmup_target,
  language
)
select
  owner.user_id,
  identity.from_name,
  identity.local_part || '@' || domain_config.domain,
  'eric@foremp.se',
  false,
  5,
  3,
  false,
  null,
  15,
  domain_config.language
from (select distinct user_id from public.senders) owner
cross join (values
  ('Eric Wahlbom'::text, 'eric'::text),
  ('Isak Andersson'::text, 'isak'::text)
) identity(from_name, local_part)
cross join (values
  ('website.foremp.email'::text, 'sv'::text),
  ('website.botlio.email'::text, 'en'::text)
) domain_config(domain, language)
on conflict (user_id, from_email) do nothing;

-- Make the new domains eligible in the same sequences as their parent brands.
-- The runtime still filters out unverified domains, so these entries are inert
-- until Lovable Emails verification is complete.
update public.sequence_nodes n
set config = jsonb_set(
      n.config,
      '{sender_domain}',
      to_jsonb('foremp.email,foremp.one,foremp.eu,website.foremp.email'::text),
      true
    ),
    updated_at = now()
from public.sequences s
where n.sequence_id = s.id
  and s.name = 'Site Demo Outreach'
  and n.node_type = 'send_email';

update public.sequence_nodes n
set config = jsonb_set(
      n.config,
      '{sender_domain}',
      to_jsonb('botlio.email,botlio.eu,website.botlio.email'::text),
      true
    ),
    updated_at = now()
from public.sequences s
where n.sequence_id = s.id
  and s.name in ('Site Demo Outreach EN', 'English Audit Outreach', 'US Website Offer (TX)')
  and n.node_type = 'send_email';
