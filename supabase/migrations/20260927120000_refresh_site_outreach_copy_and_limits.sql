-- Keep the live outreach configuration reproducible.
-- The first-email budgets are raised conservatively after a 30-day review
-- showed no recorded bounces or complaints. Follow-up capacity remains
-- governed by the existing per-sender safeguards in run-sequences.

update public.sequence_nodes n
set config = jsonb_set(config, '{max_per_day}', '44'::jsonb, true)
from public.sequences s
where s.id = n.sequence_id
  and s.name = 'Site Demo Outreach'
  and n.node_type = 'throttle';

update public.sequence_nodes n
set config = jsonb_set(config, '{max_per_day}', '18'::jsonb, true)
from public.sequences s
where s.id = n.sequence_id
  and s.name = 'Site Demo Outreach EN'
  and n.node_type = 'throttle';

update public.sequence_nodes n
set config = jsonb_set(config, '{max_per_day}', '24'::jsonb, true)
from public.sequences s
where s.id = n.sequence_id
  and s.name = 'English Audit Outreach'
  and n.node_type = 'throttle';

update public.senders
set daily_limit = 6, updated_at = now()
where from_email in (
  'eric@botlio.email', 'isak@botlio.email',
  'eric@botlio.eu', 'isak@botlio.eu'
)
and daily_limit < 6;

-- English audit outreach. The first subject is intentionally short and
-- deterministic; long company names previously produced awkward subjects.
update public.sequence_nodes
set config = jsonb_set(
  jsonb_set(
    jsonb_set(config, '{subject}', to_jsonb('A thought on your website'::text), true),
    '{subject_prompt}', to_jsonb(''::text), true
  ),
  '{prompt}',
  to_jsonb($prompt$
Write a brief first email in natural British English. It must feel like one person writing after looking at this particular business, not an audit, report or marketing sequence.

Write 38–55 words. Start with "Hi,".

Business: {{company_name}}
Category: {{category}}
Website: {{website}}
Observed issue: {{audit_weakness}}

If the observed issue is specific and customer-visible, mention it once in plain language. If it is vague, simply say you had a look at the website. Say you sketched a practical way to improve that part and ask: "Should I send it across?"

No link, price, audit score, technical language, claim that a finished site exists, signature, hype or invented fact.
Do not use: enhance, enhancement, user experience, tailored, concept, redesign direction, optimise, streamline, trust, opportunity, boost, transform, simple idea, quick question, just reaching out.
Return only the email body.
$prompt$::text), true
)
where id = '40226f28-aac7-4fab-b4c6-db7b5354f052'::uuid;

update public.sequence_nodes
set config = jsonb_set(config, '{prompt}', to_jsonb($prompt$
Write the second email in the same thread in natural British English. They did not reply.

Write 28–42 words. Start with "Hi,".

Business: {{company_name}}
Observed issue: {{audit_weakness}}
Second observation: {{audit_weakness_2}}

Do not repeat the first email. Refer briefly to the most concrete customer-visible observation, say you can send the sketch across, and end with one easy yes-or-no question.

No link, price, audit score, technical wording, signature, hype, guilt or invented fact.
Do not write "following up", "bumping this", "circling back", "simple idea", "enhance" or "user experience".
Return only the email body.
$prompt$::text), true)
where id = '19bbfbe6-43d7-47bc-be5b-07cd0b62a749'::uuid;

update public.sequence_nodes
set config = jsonb_set(config, '{prompt}', to_jsonb($prompt$
Write the final email in the same thread in natural British English.

Write 25–38 words. Start with "Hi,". Say you will leave it there, but you can still send the website sketch if it would be useful. End with one short question.

No link, price, audit score, technical wording, signature, urgency, guilt, hype or invented fact.
Return only the email body.
$prompt$::text), true)
where id = '638d1edb-37c6-4b2f-a7eb-a4298564f9e2'::uuid;

-- Swedish demo sequence. Pricing is deliberately discussed only after a
-- recipient replies; the automated sequence focuses on the finished draft.
update public.sequence_nodes
set config = jsonb_set(
  jsonb_set(config, '{prompt}', to_jsonb($prompt$
Skriv ett kort och personligt första mail på naturlig svenska. Det ska låta som att en riktig person har gjort något konkret för just företaget.

Skriv 50–70 ord. Börja med "Hej,".

Företag: {{company_name}}
Kategori: {{category}}
Auditobservation: {{audit_weakness}}
Färdig demo: {{demo_url}}

Säg att du har gjort ett förslag på en ny hemsida för företaget. Nämn högst en konkret, begriplig detalj från observationen om den är tydlig; annars utelämna den. Låt länken stå ensam på en egen rad exakt en gång:
{{demo_url}}

Avsluta med en enkel fråga om riktningen känns relevant.

Ingen prisuppgift, kritik, teknisk terminologi, påhittat resultat, press, superlativ, emoji, signatur eller annan URL.
Undvik "användarupplevelse", "öka bokningar", "stärka förtroendet", "kort webbdesignförslag", "bara" och "snabbt".
Skriv endast brödtexten.
$prompt$::text), true),
  '{subject_prompt}',
  to_jsonb('Skriv en kort, mänsklig svensk ämnesrad till ett mail som innehåller ett färdigt hemsideförslag. Max 38 tecken och 2–6 ord. Använd {{company_name}} endast om hela ämnesraden förblir kort. Annars skriv exempelvis "Ett förslag till er hemsida" eller "Jag gjorde en hemsideskiss". Ingen clickbait, Re:, emoji, utropstecken, reklamord eller citattecken. Skriv endast ämnesraden.'::text),
  true
)
where id = '71e2623e-9e5c-455f-996c-91567a661734'::uuid;

update public.sequence_nodes
set config = jsonb_set(config, '{prompt}', to_jsonb($prompt$
Skriv mail två i samma tråd på naturlig svenska. De har inte svarat.

Skriv 32–48 ord. Börja med "Hej,".

Företag: {{company_name}}
Kategori: {{category}}
Demo: {{demo_url}}

Fråga kort om de hann titta på förslaget. Nämn en relevant del att titta på, exempelvis tjänster, bokning, offert eller kontakt, utan att lova resultat. Låt länken stå ensam på en egen rad exakt en gång:
{{demo_url}}

Avsluta med en enkel fråga om något borde ändras.

Ingen prisuppgift, kritik, press, signatur, superlativ eller annan URL. Skriv inte "ville bara följa upp".
Skriv endast brödtexten.
$prompt$::text), true)
where id = '2687f5cb-26f1-44be-838b-4cd4c635981f'::uuid;

update public.sequence_nodes
set config = jsonb_set(
  jsonb_set(config, '{prompt}', to_jsonb($prompt$
Skriv mail tre i samma tråd på naturlig svenska. De har inte svarat.

Skriv 30–45 ord. Börja med "Hej,". Referera kort till hemsideförslaget som redan finns i tråden. Säg att du gärna anpassar upplägg, text och sidor om riktningen inte känns rätt. Avsluta med en lågtröskelfråga.

Ingen länk, prisuppgift, kritik, press, FOMO, signatur, superlativ eller påhittade resultat.
Skriv endast brödtexten.
$prompt$::text), true),
  '{subject_prompt}',
  to_jsonb('Skriv en kort, personlig svensk ämnesrad för tredje mailet i samma tråd om hemsideförslaget. Max 38 tecken. Systemet återanvänder normalt originalämnet. Ingen clickbait, prisreferens, Re:, emoji, utropstecken eller VERSALER. Skriv endast ämnesraden.'::text),
  true
)
where id = '3badd1c7-5033-4673-9f62-a9fc4d500e8a'::uuid;

update public.sequence_nodes
set config = jsonb_set(config, '{prompt}', to_jsonb($prompt$
Skriv det fjärde och sista mailet i samma tråd på naturlig svenska, 25–38 ord. Börja med "Hej,". Säg vänligt att du lämnar det där, men att förslaget finns kvar om en ny hemsida blir aktuell. Önska dem allt gott.

Ingen länk, prisuppgift, fråga, skuld, press, FOMO, signatur eller emoji.
Skriv endast brödtexten.
$prompt$::text), true)
where id = 'f0e4dd06-c334-4c6a-b7f8-7980b08948bd'::uuid;

-- English demo sequence, matching the Swedish structure.
update public.sequence_nodes
set config = jsonb_set(
  jsonb_set(config, '{prompt}', to_jsonb($prompt$
Write a short first email in natural British English. It must sound like a real person who made something for this particular business.

Write 50–70 words. Start with "Hi,".

Business: {{company_name}}
Category: {{category}}
Audit observation: {{audit_weakness}}
Finished demo: {{demo_url}}

Say you made a new website draft for the business. Mention at most one clear, customer-visible observation when it is genuinely useful; otherwise omit it. Put the link alone on its own line exactly once:
{{demo_url}}

End with one easy question asking whether the direction feels relevant.

No price, criticism, technical language, invented result, pressure, hype, emoji, signature or other URL.
Avoid "enhance", "user experience", "boost", "stronger trust", "design proposal", "quick draft" and "just".
Return only the email body.
$prompt$::text), true),
  '{subject_prompt}',
  to_jsonb('Write one short, human British English subject line for an email containing a finished website draft. Maximum 38 characters and 2–6 words. Use {{company_name}} only if the complete subject stays short; otherwise use wording such as "A website draft for you" or "I made a website draft". No clickbait, Re:, emoji, exclamation mark, promotional wording or quotation marks. Output only the subject.'::text),
  true
)
where id = '706bf160-a754-464c-a1a5-8e15cc7beaaa'::uuid;

update public.sequence_nodes
set config = jsonb_set(config, '{prompt}', to_jsonb($prompt$
Write email two in the same thread in natural British English. They did not reply.

Write 32–48 words. Start with "Hi,".

Business: {{company_name}}
Category: {{category}}
Demo: {{demo_url}}

Ask briefly whether they had a chance to look. Mention one relevant part to inspect, such as services, booking, quotes or contact details, without promising results. Put the link alone on its own line exactly once:
{{demo_url}}

End with one easy question about anything they would change.

No price, criticism, pressure, signature, hype or other URL. Do not write "just following up".
Return only the email body.
$prompt$::text), true)
where id = '456502a1-d87d-49da-8904-c825a41d853c'::uuid;

update public.sequence_nodes
set config = jsonb_set(
  jsonb_set(config, '{prompt}', to_jsonb($prompt$
Write email three in the same thread in natural British English. They did not reply.

Write 30–45 words. Start with "Hi,". Refer briefly to the website draft already in the thread. Say you are happy to adjust the layout, wording and pages if the direction is not quite right. End with one low-pressure question.

No link, price, criticism, pressure, FOMO, signature, hype or invented result.
Return only the email body.
$prompt$::text), true),
  '{subject_prompt}',
  to_jsonb('Write one short, personal British English subject line for the third email in the existing website-draft thread. Maximum 38 characters. The system normally reuses the original subject. No clickbait, price reference, Re:, emoji, exclamation mark or ALL CAPS. Output only the subject.'::text),
  true
)
where id = 'bb4e0db5-6dfc-43b3-8264-88d7ea045886'::uuid;

update public.sequence_nodes
set config = jsonb_set(config, '{prompt}', to_jsonb($prompt$
Write the fourth and final email in the same thread in natural British English, 25–38 words. Start with "Hi,". Say politely that you will leave it there, but the draft remains available if a new website becomes relevant. Wish them well.

No link, price, question, guilt, pressure, FOMO, signature or emoji.
Return only the email body.
$prompt$::text), true)
where id = 'f6907839-42b0-4f44-9ce4-f30670cf8950'::uuid;
