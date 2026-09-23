-- Stop English audit-only sends while the contact queue is revalidated by the
-- new evidence and identity gates in process-site-leads. The UI's pipeline
-- control resumes this sequence when the operator is ready.
update public.app_settings
set value = jsonb_set(coalesce(value, '{}'::jsonb), '{mode}', '"paused"'::jsonb, true),
    updated_at = now()
where key = 'english_outreach_pipeline';

update public.sequences
set status = 'paused', updated_at = now()
where name = 'English Audit Outreach';

-- Existing unsent rows must not slip through under the previous generic copy.
-- They retain their place and will be resumed only after the new function has
-- checked the lead/contact relationship and concrete audit observation.
update public.enrollments e
set status = 'paused', updated_at = now()
from public.sequences s
where e.sequence_id = s.id
  and s.name = 'English Audit Outreach'
  and e.status in ('active', 'waiting', 'waiting_capacity', 'deferred');

-- Replace template-like language with a single evidence-led message. The
-- function only supplies {{audit_outreach_observation}} after it has verified
-- it is a concrete, customer-visible finding; vague cosmetic comments never
-- reach this copy.
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
      jsonb_set(
        jsonb_set(n.config - 'subject', '{prompt}', to_jsonb(case ranked.step
          when 1 then $email1$Write the first email in natural British English. It should read like one person writing to another after actually looking at the company website — useful, calm and specific, not like a cold-email template.

Write 85–115 words.

Facts you may use:
Company: {{company_name}}
Business category: {{category}}
Website: {{website}}
Verified observation: {{audit_outreach_observation}}

Required structure:
1. Open with a short, human reason for writing that naturally names the company.
2. Mention the verified observation plainly in your own words. It must be the only criticism and it must be recognisably specific to this site.
3. Explain one practical consequence for a potential customer, but do not invent business results, traffic, revenue, customers or facts about the company.
4. Say you build straightforward, custom websites for small businesses and that this detail made you think a clearer version could be worthwhile.
5. End with one normal, low-pressure question asking whether they would be open to a short outline of what you mean.

Do not say or imply that a website, mock-up, redesign, concept or proposal is already made. Do not use: "I have a simple idea", "tailored", "enhance", "enhancement", "user experience", "quick question", "just reaching out", "transform", "boost", "opportunity", "audit", "AI", "free", hype, urgency, flattery, emoji, price, link, signature or unsubscribe text. Do not make the email shorter by becoming abrupt. Write only the email body.$email1$
          when 2 then $email2$Write a warm, natural British-English follow-up in the same thread. They have not replied; do not restate the whole first email or sound as if it was sent automatically.

Write 60–85 words.

Company: {{company_name}}
Verified observation: {{audit_outreach_observation}}

Briefly refer back to the particular website detail you noticed. Explain that the outline would be practical and based on the pages and contact journey the business actually needs. Ask one calm question about whether it is worth sending. Do not invent facts or outcomes, and do not say that anything has already been built.

Avoid: "following up", "bumping", "circling back", "tailored", "enhance", "user experience", "quick question", pressure, apology, hype, price, link, signature or unsubscribe text. Write only the email body.$email2$
          when 3 then $email3$Write a final, friendly British-English email in the same thread.

Write 55–80 words.

Company: {{company_name}}
Verified observation: {{audit_outreach_observation}}

Keep it human and specific: mention the website detail once, say you will leave it there if it is not relevant, and ask whether a short outline would be useful. Do not claim a live demo, finished website, guaranteed result or previous relationship.

No generic sales language, no "just checking", no "last chance", no urgency, price, link, signature or unsubscribe text. Write only the email body.$email3$
          else n.config->>'prompt'
        end), true),
        '{subject_prompt}', to_jsonb(case ranked.step
          when 1 then $subject1$Write one calm, natural British-English subject line of 3–7 words. It must relate to this verified website observation: {{audit_outreach_observation}}. Make it sound like a person noticed one useful detail, not a marketing campaign. No company-name-only subject, no clickbait, emoji, exclamation mark, quotation marks, all caps, "quick question", "free", "audit", "proposal", "enhance" or "user experience". Return only the subject line.$subject1$
          else n.config->>'subject_prompt'
        end), true),
      '{track_first_email}', 'true'::jsonb, true),
    updated_at = now()
from ranked
where n.id = ranked.id;
