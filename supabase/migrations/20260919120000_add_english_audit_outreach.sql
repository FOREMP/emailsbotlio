-- English audit-led outreach is deliberately separate from demo outreach.
-- The website builder remains available through the `demo_sites` mode, while
-- `audit_only` (the default) enrolls reliable low-quality English sites
-- directly after audit without generating or deploying a demo.

insert into public.app_settings (key, value)
values (
  'english_outreach_pipeline',
  jsonb_build_object(
    'mode', 'audit_only',
    'sourcing_enabled', true,
    'max_audit_score', 5,
    'require_reliable_audit', true,
    'track_first_email', true,
    'daily_first_touch_limit', 20
  )
)
on conflict (key) do update
set value = public.app_settings.value || excluded.value,
    updated_at = now();

do $$
declare
  owner record;
  list_id uuid;
  sequence_id uuid;
  trigger_id uuid := gen_random_uuid();
  throttle_id uuid := gen_random_uuid();
  schedule_1_id uuid := gen_random_uuid();
  email_1_id uuid := gen_random_uuid();
  wait_1_id uuid := gen_random_uuid();
  schedule_2_id uuid := gen_random_uuid();
  email_2_id uuid := gen_random_uuid();
  wait_2_id uuid := gen_random_uuid();
  schedule_3_id uuid := gen_random_uuid();
  email_3_id uuid := gen_random_uuid();
begin
  for owner in
    select distinct user_id
    from public.sequences
    where name in ('Site Demo Outreach EN', 'Site Demo Outreach')
  loop
    if exists (
      select 1 from public.sequences
      where user_id = owner.user_id and name = 'English Audit Outreach'
    ) then
      continue;
    end if;

    trigger_id := gen_random_uuid();
    throttle_id := gen_random_uuid();
    schedule_1_id := gen_random_uuid();
    email_1_id := gen_random_uuid();
    wait_1_id := gen_random_uuid();
    schedule_2_id := gen_random_uuid();
    email_2_id := gen_random_uuid();
    wait_2_id := gen_random_uuid();
    schedule_3_id := gen_random_uuid();
    email_3_id := gen_random_uuid();

    insert into public.contact_lists (user_id, name, description)
    values (owner.user_id, 'English Audit Outreach', 'English audit-led website outreach without generated demos')
    returning id into list_id;

    insert into public.sequences (user_id, name, contact_list_id, status, sender_rotation, seeded)
    values (owner.user_id, 'English Audit Outreach', list_id, 'active', '[]'::jsonb, true)
    returning id into sequence_id;

    insert into public.sequence_nodes (id, sequence_id, user_id, node_type, position_x, position_y, config)
    values
      (trigger_id, sequence_id, owner.user_id, 'trigger', 0, 100,
        jsonb_build_object('contact_list_id', list_id::text, 'contact_list_name', 'English Audit Outreach')),
      (throttle_id, sequence_id, owner.user_id, 'throttle', 0, 220,
        jsonb_build_object('max_per_day', 20)),
      (schedule_1_id, sequence_id, owner.user_id, 'schedule', 0, 290,
        '{"days":["Mon","Tue","Wed","Thu","Fri"],"time_of_day":"10:00"}'::jsonb),
      (email_1_id, sequence_id, owner.user_id, 'send_email', 0, 360,
        jsonb_build_object(
          'mode', 'ai',
          'brand', 'botlio',
          'model', 'gpt-4o-mini',
          'sender_domain', 'botlio.email,botlio.eu',
          'sender_strategy', 'brand',
          'track_first_email', true,
          'prompt', $prompt$Write the first cold email in natural British English. It must feel individually researched, calm and useful, never like an automated audit report.

Write 65–90 words.

Evidence:
Company: {{company_name}}
Business category: {{category}}
Current website: {{website}}
Primary observed issue: {{audit_weakness}}
Secondary observed issue: {{audit_weakness_2}}

Instructions:
1. Open with a direct, natural reason for writing to this specific company.
2. Mention ONE concrete observed issue only when it is clear and customer-visible. Phrase it neutrally; never insult their current website.
3. Connect that observation to one plausible customer action such as understanding services, trusting the business, enquiring, booking or requesting a quote. Do not invent results, traffic, lost revenue or company facts.
4. Say that we build clear, modern websites for small businesses and ask one low-pressure question about whether improving that part of the site is currently relevant.
5. If the address is clearly generic (info@, office@, hello@ or contact@), you may briefly ask for the person responsible for the website, but only when it reads naturally.

Rules:
No link, demo, price, audit score, technical jargon, urgency, hype, flattery, emoji, signature or unsubscribe text.
Do not call the website bad, outdated, broken or unprofessional.
Do not use “I hope this email finds you well”, “quick question”, “just reaching out”, “boost”, “transform”, “revolutionise” or “skyrocket”.
Write only the email body.$prompt$,
          'subject_prompt', $subject$Write one transparent British-English subject line for a first email to {{company_name}} about one practical website improvement. Maximum 45 characters. Sound personal and specific without pretending there is an existing relationship. No “Re:”, clickbait, emoji, exclamation mark, quotation marks, all caps, “quick question”, “proposal”, “free”, “audit” or “opportunity”. Return only the subject line.$subject$
        )),
      (wait_1_id, sequence_id, owner.user_id, 'wait', 0, 500,
        '{"unit":"days","duration":3}'::jsonb),
      (schedule_2_id, sequence_id, owner.user_id, 'schedule', 0, 570,
        '{"days":["Mon","Tue","Wed","Thu","Fri"],"time_of_day":"10:00"}'::jsonb),
      (email_2_id, sequence_id, owner.user_id, 'send_email', 0, 640,
        jsonb_build_object(
          'mode', 'ai',
          'brand', 'botlio',
          'model', 'gpt-4o-mini',
          'sender_domain', 'botlio.email,botlio.eu',
          'sender_strategy', 'brand',
          'prompt', $prompt$Write the second email in the same thread in natural British English. They have not replied. Do not repeat the introduction.

Write 45–65 words.

Company: {{company_name}}
Category: {{category}}
Primary observed issue: {{audit_weakness}}
Secondary observed issue: {{audit_weakness_2}}

Briefly clarify one practical improvement that would make the site easier for a prospective customer to use. Prefer a different observation from the first email when the secondary observation is specific. Never invent facts. End with one simple either/or question that is easy to answer.

No link, price, audit score, apology, pressure, hype, signature or unsubscribe text. Do not say “following up again”, “bumping this” or “circling back”. Write only the email body.$prompt$,
          'subject_prompt', 'Return one short British-English follow-up subject line, maximum 42 characters. The system normally reuses the original subject for threading. No clickbait, emoji, exclamation mark, quotation marks, all caps or Re:.'
        )),
      (wait_2_id, sequence_id, owner.user_id, 'wait', 0, 780,
        '{"unit":"days","duration":4}'::jsonb),
      (schedule_3_id, sequence_id, owner.user_id, 'schedule', 0, 850,
        '{"days":["Mon","Tue","Wed","Thu","Fri"],"time_of_day":"10:00"}'::jsonb),
      (email_3_id, sequence_id, owner.user_id, 'send_email', 0, 920,
        jsonb_build_object(
          'mode', 'ai',
          'brand', 'botlio',
          'model', 'gpt-4o-mini',
          'sender_domain', 'botlio.email,botlio.eu',
          'sender_strategy', 'brand',
          'prompt', $prompt$Write the final email in the same thread in natural British English. Keep it calm and concise.

Write 45–70 words.

Company: {{company_name}}
Category: {{category}}
Primary observed issue: {{audit_weakness}}

Briefly state that we can redesign and build the website around the pages and functions the business actually needs. Make clear there is no obligation and that you will close the thread if it is not relevant. End with one low-pressure question asking whether they want a short outline of what you would change.

No link, fabricated result, audit score, false urgency, discount, hype, emoji, signature or unsubscribe text. Do not guilt the reader. Write only the email body.$prompt$,
          'subject_prompt', 'Return one calm British-English closing subject line, maximum 42 characters. The system normally reuses the original subject for threading. No clickbait, emoji, exclamation mark, quotation marks, all caps or Re:.'
        ));

    insert into public.sequence_edges (sequence_id, user_id, source_node_id, target_node_id, source_handle)
    values
      (sequence_id, owner.user_id, trigger_id, throttle_id, null),
      (sequence_id, owner.user_id, throttle_id, schedule_1_id, null),
      (sequence_id, owner.user_id, schedule_1_id, email_1_id, null),
      (sequence_id, owner.user_id, email_1_id, wait_1_id, null),
      (sequence_id, owner.user_id, wait_1_id, schedule_2_id, null),
      (sequence_id, owner.user_id, schedule_2_id, email_2_id, null),
      (sequence_id, owner.user_id, email_2_id, wait_2_id, null),
      (sequence_id, owner.user_id, wait_2_id, schedule_3_id, null),
      (sequence_id, owner.user_id, schedule_3_id, email_3_id, null);
  end loop;
end
$$;
