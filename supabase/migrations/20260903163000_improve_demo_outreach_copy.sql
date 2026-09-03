-- Improve only the Swedish and English website-demo outreach sequences.
-- Existing enrollments pick up the new copy when they reach their next send node.

-- Swedish email 1: lead with the completed work and a niche-relevant outcome.
update public.sequence_nodes n
set config = n.config || jsonb_build_object(
  'prompt', $prompt$Du skriver ett personligt första kontaktmail på naturlig svenska. Det ska kännas som att en riktig person har lagt tid på just företaget, inte som massutskick eller en AI-mall.

Skriv 65–90 ord.

Underlag:
Företag: {{company_name}}
Bransch/kategori: {{category}}
Nuvarande hemsida: {{website}}
Neutral auditobservation: {{audit_weakness}}
Mottagaradress: {{email}}
Färdig demo: {{demo_url}}

Uppgift:
1. Säg direkt att du har tagit fram ett kort webbdesignförslag för {{company_name}}.
2. Koppla förslaget till ETT relevant mål för branschen, till exempel tydligare tjänster, fler bokningar, enklare offertförfrågningar, starkare förtroende eller lättare kontakt. Välj bara något som rimligen följer av kategorin.
3. Du får använda auditobservationen endast om den är konkret, neutral och begriplig. Visa aldrig auditpoäng, intern terminologi eller tekniska fel. Om underlaget är svagt, utelämna observationen helt.
4. Låt länken stå ensam på en egen rad, exakt en gång:
{{demo_url}}
5. Förklara kort att demon visar ett urval av huvudsidor och att en färdig webbplats kan byggas ut med de sidor verksamheten behöver.
6. Avsluta med EN lågtröskelfråga om riktningen känns relevant.
7. Om mottagaradressen tydligt är en gemensam adress som info@ eller kontakt@ får du, endast om det flyter naturligt, be dem vidarebefordra till den som ansvarar för hemsidan.

Regler:
Var saklig och varm, aldrig inställsam.
Kritisera inte den nuvarande hemsidan och hitta inte på fakta.
Skriv inte ”jag snubblade över”, ”bara för skojs skull”, ”snabbt utkast”, ”lite modernare”, ”allt går att ändra” eller liknande formuleringar som förminskar arbetet.
Ingen prisuppgift, falsk brådska, FOMO, superlativ, emoji, signatur eller avregistreringstext.
Skriv ingen annan URL än {{demo_url}} och lämna inga platshållare.
Skriv företagsnamnet normalt, aldrig i VERSALER.
Skriv endast mailets brödtext.$prompt$,
  'subject_prompt', $subject$Skriv EN transparent och personlig svensk ämnesrad till ett första mail där ett färdigt webbdesignförslag för {{company_name}} finns i mailet.

Krav:
Max 46 tecken. Skriv endast ämnesraden.
Nämn gärna förslag, sida eller webbdesign; dölj inte vad mailet handlar om.
Ingen clickbait, fråga som låtsas vara intern, ”Re:”, emoji, utropstecken, citattecken eller VERSALER.
Undvik reklamord som gratis, erbjudande, rabatt och kampanj.
Variera strukturen och använd företagsnamnet bara när det blir naturligt.$subject$,
  'model', 'gpt-4.1-mini'
)
where n.sequence_id = (select id from public.sequences where name = 'Site Demo Outreach' limit 1)
  and n.node_type = 'send_email'
  and n.position_y = 360;

-- Swedish email 2: point to one relevant thing to inspect, without repeating email 1.
update public.sequence_nodes n
set config = n.config || jsonb_build_object(
  'prompt', $prompt$Du skriver mail två i samma tråd efter att {{company_name}} fått ett personligt webbdesignförslag men inte svarat. Skriv naturlig svenska och upprepa inte introduktionen från första mailet.

Skriv 45–68 ord.

Underlag:
Företag: {{company_name}}
Bransch/kategori: {{category}}
Färdig demo: {{demo_url}}

Uppgift:
Påminn kort om förslaget och lyft EN sak som är relevant att titta på för kategorin, exempelvis hur tjänster, behandlingar, bokning, offert eller kontakt presenteras. Hitta inte på något om företaget.
Låt länken stå ensam på en egen rad, exakt en gång:
{{demo_url}}
Avsluta med EN enkel fråga om det finns något de skulle vilja ändra i riktningen.

Regler:
Skriv inte ”ville bara följa upp”, be inte om ursäkt och kritisera inte deras nuvarande sida.
Ingen prisuppgift, press, superlativ, emoji, signatur eller avregistreringstext.
Ingen annan URL och inga platshållare.
Skriv endast mailets brödtext.$prompt$,
  'subject_prompt', $subject$Skriv EN kort svensk ämnesrad till uppföljningen om webbdesignförslaget för {{company_name}}. Max 42 tecken. Skriv endast ämnesraden. Saklig och personlig, utan clickbait, emoji, utropstecken, citattecken, VERSALER eller ”Re:”. Systemet återanvänder normalt originalämnet för trådning.$subject$,
  'model', 'gpt-4.1-mini'
)
where n.sequence_id = (select id from public.sequences where name = 'Site Demo Outreach' limit 1)
  and n.node_type = 'send_email'
  and n.position_y = 640;

-- Swedish email 3: business case and price, no duplicate link.
update public.sequence_nodes n
set config = n.config || jsonb_build_object(
  'prompt', $prompt$Du skriver mail tre i samma tråd om webbdesignförslaget för {{company_name}}. De har inte svarat. Skriv ett lugnt, konkret mail på naturlig svenska, 60–85 ord.

Underlag:
Företag: {{company_name}}
Bransch/kategori: {{category}}

Uppgift:
Referera kort till förslaget som redan finns i tråden, utan att skriva länken igen.
Beskriv ETT rimligt affärsvärde för kategorin: tydligare tjänster, enklare bokning/kontakt/offert eller högre förtroende. Hitta inte på resultat eller fakta.
Förklara priset tydligt: 5 000 kr för att färdigställa och lansera webbplatsen samt 1 000 kr per år för hosting och drift.
Säg att anpassning av design, texter, bilder, funktioner och de ytterligare sidor verksamheten behöver ingår före lansering.
Avsluta med EN enkel fråga om de vill att du förklarar nästa steg.

Regler:
Ingen URL, kritik, falsk brådska, FOMO, superlativ, emoji, signatur eller avregistreringstext.
Börja inte med en ursäkt eller ”jag följer upp igen”.
Skriv endast mailets brödtext.$prompt$,
  'subject_prompt', $subject$Skriv EN kort och saklig svensk ämnesrad för prisuppföljningen till {{company_name}}. Max 42 tecken. Skriv endast ämnesraden. Ingen clickbait, emoji, utropstecken, citattecken, VERSALER eller ”Re:”. Systemet återanvänder normalt originalämnet för trådning.$subject$,
  'model', 'gpt-4.1-mini'
)
where n.sequence_id = (select id from public.sequences where name = 'Site Demo Outreach' limit 1)
  and n.node_type = 'send_email'
  and n.position_y = 920;

-- Swedish email 4: respectful close, no manufactured scarcity.
update public.sequence_nodes n
set config = n.config || jsonb_build_object(
  'prompt', $prompt$Du skriver det fjärde och sista mailet i tråden om webbdesignförslaget för {{company_name}}. Skriv ett vänligt och respektfullt avslut på naturlig svenska, 35–52 ord.

Säg att du lämnar det här så att du inte fortsätter störa. Säg att förslaget och erbjudandet finns kvar om en ny webbplats blir aktuell längre fram. Önska dem allt gott.

Regler:
Ingen länk, prisuppgift, fråga, skuld, press, FOMO, påstående om att demon tas bort, emoji, signatur eller avregistreringstext.
Skriv endast mailets brödtext.$prompt$,
  'subject_prompt', $subject$Skriv EN lugn svensk ämnesrad till det sista avslutningsmailet för {{company_name}}. Max 38 tecken. Skriv endast ämnesraden. Ingen dramatik, clickbait, fråga, FOMO, emoji, utropstecken, VERSALER eller ”Re:”. Systemet återanvänder normalt originalämnet för trådning.$subject$,
  'model', 'gpt-4.1-mini'
)
where n.sequence_id = (select id from public.sequences where name = 'Site Demo Outreach' limit 1)
  and n.node_type = 'send_email'
  and n.position_y = 1200;

-- English email 1.
update public.sequence_nodes n
set config = n.config || jsonb_build_object(
  'prompt', $prompt$Write a personal first-contact email in natural British English. It must sound like a real person spent time on this particular company, not like bulk outreach or an AI template.

Write 65–90 words.

Source material:
Company: {{company_name}}
Industry/category: {{category}}
Current website: {{website}}
Neutral audit observation: {{audit_weakness}}
Recipient address: {{email}}
Finished demo: {{demo_url}}

Task:
1. Say directly that you created a short website design proposal for {{company_name}}.
2. Connect it to ONE sensible outcome for the category, such as clearer services, easier booking, more quote enquiries, stronger trust or simpler contact. Use only an outcome reasonably supported by the category.
3. Use the audit observation only if it is concrete, neutral and understandable. Never reveal an audit score, internal terminology or technical errors. Omit it when the evidence is weak.
4. Put the link alone on its own line, exactly once:
{{demo_url}}
5. Briefly explain that the demo shows selected core pages and that the finished site can include the additional pages the business needs.
6. End with ONE low-friction question asking whether the direction feels relevant.
7. If the recipient is clearly a shared inbox such as info@ or contact@, you may naturally ask them to forward it to the person responsible for the website. Do not add this line otherwise.

Rules:
Be factual, warm and concise. Never invent facts or criticise the current website.
Do not use “came across”, “just for fun”, “quick draft”, “a more modern version”, “everything can be changed” or language that makes the work sound disposable.
No pricing, artificial urgency, FOMO, hype, superlatives, emojis, signature or unsubscribe wording.
Do not include any URL other than {{demo_url}} and leave no placeholders.
Preserve the company's normal capitalisation.
Return only the email body in idiomatic British English.$prompt$,
  'subject_prompt', $subject$Write ONE transparent, personal British English subject line for a first email containing a finished website design proposal for {{company_name}}.

Maximum 46 characters. Output only the subject line.
It may mention a proposal, page or website; do not disguise the topic.
No clickbait, fake internal question, “Re:”, emoji, exclamation mark, quotation marks or ALL CAPS.
Avoid promotional words such as free, offer, discount and deal.
Vary the structure and use the company name only when natural.$subject$,
  'model', 'gpt-4o-mini'
)
where n.sequence_id = (select id from public.sequences where name = 'Site Demo Outreach EN' limit 1)
  and n.node_type = 'send_email'
  and n.position_y = 360;

-- English email 2.
update public.sequence_nodes n
set config = n.config || jsonb_build_object(
  'prompt', $prompt$Write email two in the existing thread after {{company_name}} received a personal website design proposal but did not reply. Use natural British English and do not repeat the first email's introduction.

Write 45–68 words.

Source material:
Company: {{company_name}}
Industry/category: {{category}}
Finished demo: {{demo_url}}

Task:
Briefly remind them about the proposal and point to ONE category-relevant thing to inspect, such as how services, treatments, bookings, quotes or contact details are presented. Do not invent anything about the company.
Put the link alone on its own line, exactly once:
{{demo_url}}
End with ONE simple question asking whether there is anything they would change about the direction.

Rules:
Do not write “just following up”, apologise or criticise their current site.
No pricing, pressure, hype, superlatives, emojis, signature or unsubscribe wording.
No other URL and no placeholders.
Return only the email body in idiomatic British English.$prompt$,
  'subject_prompt', $subject$Write ONE short British English subject line for the follow-up about the website proposal for {{company_name}}. Maximum 42 characters. Output only the subject. Keep it factual and personal, with no clickbait, emoji, exclamation mark, quotation marks, ALL CAPS or “Re:”. The system normally reuses the original subject for threading.$subject$,
  'model', 'gpt-4o-mini'
)
where n.sequence_id = (select id from public.sequences where name = 'Site Demo Outreach EN' limit 1)
  and n.node_type = 'send_email'
  and n.position_y = 640;

-- English email 3.
update public.sequence_nodes n
set config = n.config || jsonb_build_object(
  'prompt', $prompt$Write email three in the existing thread about the website design proposal for {{company_name}}. They have not replied. Use calm, natural British English and write 60–85 words.

Source material:
Company: {{company_name}}
Industry/category: {{category}}

Task:
Briefly refer to the proposal already in the thread without repeating the link.
Describe ONE sensible commercial benefit for the category: clearer services, easier booking/contact/quotes or stronger trust. Never invent results or company facts.
State the price clearly: £800 to complete and launch the website, plus £100 per year for hosting and maintenance.
Explain that adjustments to the design, copy, images and functionality, along with the additional pages the business needs, are included before launch.
End with ONE simple question asking whether they would like the next steps explained.

Rules:
No URL, criticism, artificial urgency, FOMO, hype, superlatives, emojis, signature or unsubscribe wording.
Do not begin with an apology or “just following up again”.
Return only the email body in idiomatic British English.$prompt$,
  'subject_prompt', $subject$Write ONE short, factual British English subject line for the pricing follow-up to {{company_name}}. Maximum 42 characters. Output only the subject. No clickbait, emoji, exclamation mark, quotation marks, ALL CAPS or “Re:”. The system normally reuses the original subject for threading.$subject$,
  'model', 'gpt-4o-mini'
)
where n.sequence_id = (select id from public.sequences where name = 'Site Demo Outreach EN' limit 1)
  and n.node_type = 'send_email'
  and n.position_y = 920;

-- English email 4.
update public.sequence_nodes n
set config = n.config || jsonb_build_object(
  'prompt', $prompt$Write the fourth and final email in the thread about the website design proposal for {{company_name}}. Use friendly, respectful British English and write 35–52 words.

Say you will leave it there so you do not keep bothering them. Say the proposal and offer remain available if a new website becomes relevant later. Wish them well.

Rules:
No link, price, question, guilt, pressure, FOMO, claim that the demo will be removed, emoji, signature or unsubscribe wording.
Return only the email body in idiomatic British English.$prompt$,
  'subject_prompt', $subject$Write ONE calm British English subject line for the final closing email to {{company_name}}. Maximum 38 characters. Output only the subject. No drama, clickbait, question, FOMO, emoji, exclamation mark, ALL CAPS or “Re:”. The system normally reuses the original subject for threading.$subject$,
  'model', 'gpt-4o-mini'
)
where n.sequence_id = (select id from public.sequences where name = 'Site Demo Outreach EN' limit 1)
  and n.node_type = 'send_email'
  and n.position_y = 1200;
