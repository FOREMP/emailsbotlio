-- Keep the TX acquisition cap at 40/day, but route most of it through the
-- materially better-performing botlio.email domain while botlio.eu matures.
update public.senders
set daily_limit = 15,
    warmup_target = 15,
    updated_at = now()
where is_active = true
  and split_part(lower(from_email), '@', 2) = 'botlio.email';

update public.senders
set daily_limit = 5,
    warmup_target = 5,
    updated_at = now()
where is_active = true
  and split_part(lower(from_email), '@', 2) = 'botlio.eu';

-- Remove the mandatory phrases that made every first email look alike.
update public.sequence_nodes n
set config = jsonb_set(
      jsonb_set(
        n.config,
        '{prompt}',
        to_jsonb($prompt$
Write a concise first-contact email in natural American English. It should read like an individual note, not a sales template. The only goal is to learn whether the recipient is open to seeing a website direction.

Source material:
Company: {{company_name}}
Industry: {{category}}
Current website: {{website}}

Write 55–75 words.

Start with a company-specific, plain observation based only on the company name, industry, and the fact that it has a website. Vary the opening structure naturally between recipients. Explain that you have sketched a possible website direction for the business and can send it if useful. Mention one sensible category-relevant benefit, such as clearer services, easier contact, quote requests, booking, or stronger trust. End with one short, low-pressure question.

Do not use the phrases “came across”, “due for an update”, “quick question”, “quick draft”, “just reaching out”, or “want me to send it over”.
Do not claim the current website is bad, broken, outdated, or that you know its results.
Never include a URL, price, signature, emoji, hype, urgency, placeholder, or invented fact.
Preserve the company’s normal capitalisation.
Return only the email body.
$prompt$::text),
        true
      ),
      '{subject_prompt}',
      to_jsonb($subject$
Write one transparent subject line in natural American English for an individual email about a possible website direction for {{company_name}}.

Maximum 42 characters. Output only the subject line.
Make the topic clear without sounding promotional. Vary syntax rather than relying on a fixed formula.
Do not use “quick question”, “an idea for”, “came across”, “free”, “offer”, “deal”, “Re:”, clickbait, emoji, exclamation marks, quotation marks, or ALL CAPS.
Use the company name only when it fits naturally.
$subject$::text),
      true
    ),
    updated_at = now()
from public.sequences q
where n.sequence_id = q.id
  and q.name = 'US Website Offer (TX)'
  and n.node_type = 'send_email'
  and n.config->>'prompt' like '%The goal is NOT to sell%';
