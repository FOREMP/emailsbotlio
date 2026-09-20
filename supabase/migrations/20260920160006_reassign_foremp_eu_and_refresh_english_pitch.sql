-- Reserve every Foremp mailbox for Swedish outreach. English outreach,
-- including the optional demo mode, is sent exclusively from Botlio.
update public.senders
set language = 'sv', updated_at = now()
where split_part(lower(from_email), '@', 2) = 'foremp.eu';

update public.sequence_nodes n
set config = jsonb_set(n.config, '{sender_domain}', to_jsonb('foremp.email,foremp.one,foremp.eu'::text), true),
    updated_at = now()
from public.sequences s
where n.sequence_id = s.id
  and s.name = 'Site Demo Outreach'
  and n.node_type = 'send_email';

update public.sequence_nodes n
set config = jsonb_set(
      jsonb_set(n.config, '{sender_domain}', to_jsonb('botlio.email,botlio.eu'::text), true),
      '{brand}',
      to_jsonb('botlio'::text),
      true
    ),
    updated_at = now()
from public.sequences s
where n.sequence_id = s.id
  and s.name in ('Site Demo Outreach EN', 'English Audit Outreach')
  and n.node_type = 'send_email';

-- Existing English demo conversations must select a Botlio sender on their
-- next step instead of retaining a now-Swedish foremp.eu assignment.
update public.enrollments e
set assigned_sender_id = null, updated_at = now()
from public.sequences q, public.senders old_sender
where e.sequence_id = q.id
  and e.assigned_sender_id = old_sender.id
  and q.name = 'Site Demo Outreach EN'
  and split_part(lower(old_sender.from_email), '@', 2) = 'foremp.eu'
  and e.status in ('active', 'waiting', 'waiting_capacity', 'deferred', 'paused');

-- Refresh the audit-only copy. It keeps the proven redesign angle without
-- falsely claiming that a live demo exists when this mode intentionally skips
-- website generation.
with ranked as (
  select n.id,
         row_number() over (partition by n.sequence_id order by n.position_y, n.id) as step
  from public.sequence_nodes n
  join public.sequences s on s.id = n.sequence_id
  where s.name = 'English Audit Outreach'
    and n.node_type = 'send_email'
)
update public.sequence_nodes n
set config = jsonb_set(
      n.config,
      '{prompt}',
      to_jsonb(case ranked.step
        when 1 then $email1$Write the first cold email in natural British English. It must feel individually researched, calm and useful, never like an automated audit report.

Write 65–90 words.

Evidence:
Company: {{company_name}}
Business category: {{category}}
Current website: {{website}}
Primary observed issue: {{audit_weakness}}
Secondary observed issue: {{audit_weakness_2}}

Instructions:
1. Open with a direct, natural reason for writing to this specific company.
2. Mention one or two concrete, customer-visible observations only when the evidence is specific. Phrase them neutrally; never insult their current website.
3. Say that you used those observations to put together a tailored redesign concept for their website. This is a design direction, not a finished or live website, so never claim that a complete demo has already been built.
4. Briefly explain what the concept improves, for example clearer services, easier enquiries, stronger trust or a better mobile path. Do not invent results, traffic, lost revenue or company facts.
5. End by asking whether they would like to see the redesign direction. If the address is clearly generic, you may instead ask whether it can be forwarded to the person responsible for the website.

Rules:
No link, price, audit score, technical jargon, urgency, hype, flattery, emoji, signature or unsubscribe text.
Do not call the website bad, outdated, broken or unprofessional.
Do not use “I hope this email finds you well”, “quick question”, “just reaching out”, “boost”, “transform”, “revolutionise” or “skyrocket”.
Write only the email body.$email1$
        when 2 then $email2$Write the second email in the same thread in natural British English. They have not replied. Do not repeat the introduction.

Write 45–65 words.

Company: {{company_name}}
Category: {{category}}
Primary observed issue: {{audit_weakness}}
Secondary observed issue: {{audit_weakness_2}}

Refer naturally to the tailored redesign direction mentioned earlier. Briefly clarify one practical improvement that would make the site easier for a prospective customer to use. Prefer a different verified observation from the first email when the secondary observation is specific. Never invent facts or claim a finished website exists. End by asking whether they want you to send the short redesign outline.

No link, price, audit score, apology, pressure, hype, signature or unsubscribe text. Do not say “following up again”, “bumping this” or “circling back”. Write only the email body.$email2$
        when 3 then $email3$Write the final email in the same thread in natural British English. Keep it calm and concise.

Write 45–70 words.

Company: {{company_name}}
Category: {{category}}
Primary observed issue: {{audit_weakness}}

Briefly state that the redesign concept can be developed around the pages and functions the business actually needs. Make clear there is no obligation and that you will close the thread if it is not relevant. End with one low-pressure question asking whether they want you to send the direction you prepared. Never claim a complete or live website exists.

No link, fabricated result, audit score, false urgency, discount, hype, emoji, signature or unsubscribe text. Do not guilt the reader. Write only the email body.$email3$
        else n.config->>'prompt'
      end),
      true
    ),
    updated_at = now()
from ranked
where n.id = ranked.id;
