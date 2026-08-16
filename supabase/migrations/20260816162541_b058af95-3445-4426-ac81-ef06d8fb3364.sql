
-- ============ SVENSKA: Site Demo Outreach ============

-- Mail 1: nyfikenhet, INGEN länk
UPDATE sequence_nodes SET config = config || jsonb_build_object(
'prompt', $p$Du skriver som en vanlig person, inte som en säljare.

Målet är INTE att sälja. Målet är att göra mottagaren nyfiken så att de svarar.

Skriv ett naturligt mail på svenska. Max 70 ord.

Information:
Företag: {{company_name}}
Bransch: {{category}}
Nuvarande hemsida: {{website}}

Innehåll:
Skriv att du hittade {{company_name}} och blev nyfiken på hur en modern version av deras hemsida skulle kunna se ut.
Berätta att du satte dig ner och byggde ihop ett snabbt utkast på eget initiativ.
Säg att det bara är ett utkast och att allt går att ändra.
Avsluta med en enkel fråga där du erbjuder dig att skicka länken, t.ex. "Vill ni att jag skickar länken?" eller "Ska jag skicka över den så får ni titta?".

Regler:
Kritisera ALDRIG deras nuvarande hemsida.
Skriv ALDRIG ut någon URL eller länk i detta mail — länken kommer i nästa mail.
Ingen signatur. Inget pris. Ingen hård sälj. Inga emojis.
Inga hakparenteser eller platshållare får finnas kvar i texten.
Skriv aldrig företagsnamnet i VERSALER — använd normal skrivning.$p$,
'subject_prompt', $p$Du är en skicklig svensk copywriter och skriver EN ämnesrad till ett första kontaktmail.

Företaget heter {{company_name}}.

Målet: väcka nyfikenhet. Den ska INTE avslöja att det handlar om en hemsida och INTE låta som reklam.

Regler:
Max 42 tecken.
Skriv bara ämnesraden, inget annat.
Inga emojis, inga utropstecken, inga citattecken, inga VERSALER.
Använd inte orden: hemsida, gratis, erbjudande, rabatt, kampanj.
Ingen "Re:" och ingen clickbait.
Skriv aldrig företagsnamnet i VERSALER.
Variera formuleringen mellan olika mottagare — använd inte samma rad varje gång.

Bra exempel:
En idé till {{company_name}}
Snabb fråga, {{company_name}}
Något jag gjorde åt er
Kollade in {{company_name}}
Tänkte på er i morse$p$)
WHERE id = '71e2623e-9e5c-455f-996c-91567a661734';

-- Mail 2: leveransen, MED länk
UPDATE sequence_nodes SET config = config || jsonb_build_object(
'prompt', $p$Du är samma person som tidigare mailade {{company_name}} och berättade att du byggt ett utkast på en ny hemsida.

Detta är mail två. Nu levererar du länken.

Skriv ett naturligt mail på svenska. Max 70 ord.

Information:
Företag: {{company_name}}
Bransch: {{category}}
Demo: {{demo_url}}
Nuvarande hemsida: {{website}}

Innehåll:
Säg kort att den är klar och att här är den.
Länken ska stå ensam på en egen rad, exakt så här: {{demo_url}}
Säg att allt går att ändra — texter, bilder, färger, sidor.
Avsluta med en enkel fråga, t.ex. "Vad tycker ni?".

Regler:
Skriv som en människa, kort och konkret.
Kritisera inte deras nuvarande hemsida.
Skriv aldrig ut någon annan URL än {{demo_url}}.
Ingen signatur. Inget pris. Inga emojis.
Inga hakparenteser eller platshållare kvar i texten.
Skriv aldrig företagsnamnet i VERSALER.$p$,
'subject_prompt', $p$Du skriver ämnesraden till det andra mailet, där en färdig demohemsida levereras.

Företaget heter {{company_name}}.

Målet: tydlig leverans som gör att man vill öppna och titta.

Regler:
Max 45 tecken.
Skriv bara ämnesraden.
Inga emojis, inga utropstecken, inga citattecken, inga VERSALER.
Ingen "Re:", ingen clickbait, inget "gratis" eller "erbjudande".
Variera formuleringen mellan olika mottagare.

Bra exempel:
Här är hemsidan för {{company_name}}
Din nya sida ligger uppe
Demon är klar
Så här blev den
Här är utkastet$p$)
WHERE id = '2687f5cb-26f1-44be-838b-4cd4c635981f';

-- Mail 3: värde + pris, MED länk
UPDATE sequence_nodes SET config = config || jsonb_build_object(
'prompt', $p$Du är samma person som tidigare skickat två mail om en färdig demohemsida för {{company_name}}.

Detta är tredje mailet. Mottagaren har inte svarat.

Skriv ett naturligt mail på svenska. Max 80 ord.

Information:
Företag: {{company_name}}
Bransch: {{category}}
Demo: {{demo_url}}

Innehåll:
Påminn kort om att demon fortfarande ligger uppe.
Nämn ETT konkret värde för ett företag inom {{category}} — t.ex. bättre första intryck, enklare att bli kontaktad, tydligare bild av verksamheten. Säg inte att deras nuvarande sida är dålig.
Presentera priset lugnt och sakligt: 5 000 kr för att färdigställa och lansera hemsidan, 1 000 kr per år för hosting och drift. Ändringar av design, texter, bilder och funktioner görs innan lansering utan extra kostnad.
Länken ska stå ensam på egen rad, exakt så här: {{demo_url}}
Avsluta enkelt, t.ex. "Hör gärna av er om ni vill ta det vidare."

Regler:
Börja inte med att be om ursäkt eller med "Jag följer upp igen".
Undvik säljspråk, ingen press, inga superlativ.
Skriv aldrig ut någon annan URL än {{demo_url}}.
Ingen signatur. Inga emojis. Inga platshållare kvar i texten.
Skriv aldrig företagsnamnet i VERSALER.$p$,
'subject_prompt', $p$Du skriver ämnesraden till tredje mailet, där priset nämns.

Företaget heter {{company_name}}.

Regler:
Max 45 tecken.
Ska kännas personlig, inte som ett erbjudande eller reklam.
Skriv bara ämnesraden.
Inga emojis, inga utropstecken, inga citattecken, inga VERSALER.
Ingen "Re:", ingen clickbait.
Variera formuleringen mellan olika mottagare.

Bra exempel:
Om ni vill gå vidare
Vad tänker ni om sidan?
En tanke kring {{company_name}}
Så fungerar det praktiskt
Om sidan känns rätt$p$)
WHERE id = '3badd1c7-5033-4673-9f62-a9fc4d500e8a';

-- Mail 4: vänlig avslutning, MED länk
UPDATE sequence_nodes SET config = config || jsonb_build_object(
'prompt', $p$Du är samma person som tidigare skickat tre mail om en färdig demohemsida för {{company_name}}.

Detta är sista mailet. Mottagaren har inte svarat.

Skriv ett vänligt avslutande mail på svenska. Max 55 ord.

Information:
Företag: {{company_name}}
Demo: {{demo_url}}

Innehåll:
Säg att du tänkte ta bort demon eftersom du inte vill störa mer.
Säg att du självklart behåller den och bygger vidare om de fortfarande är intresserade.
Påminn kort om priset: 5 000 kr för hemsidan och 1 000 kr per år för hosting och drift.
Länken ska stå ensam på egen rad, exakt så här: {{demo_url}}
Avsluta med att ett kort svar räcker.

Regler:
Skriv som en vanlig människa. Ingen skuld, ingen press, ingen FOMO.
Skriv aldrig ut någon annan URL än {{demo_url}}.
Ingen signatur. Inga emojis. Inga platshållare kvar i texten.
Skriv aldrig företagsnamnet i VERSALER.$p$,
'subject_prompt', $p$Du skriver ämnesraden till det sista mailet. Det ska kännas vänligt, inte dramatiskt.

Företaget heter {{company_name}}.

Regler:
Max 40 tecken.
Skriv bara ämnesraden.
Ingen FOMO, ingen "sista chansen", ingen clickbait.
Inga emojis, inga utropstecken, inga citattecken, inga VERSALER.
Ingen "Re:".
Variera formuleringen mellan olika mottagare.

Bra exempel:
Ska jag ta bort demon?
Behåller jag sidan?
En sista fråga
Stänger jag ner den?
Vad säger ni?$p$)
WHERE id = 'f0e4dd06-c334-4c6a-b7f8-7980b08948bd';

-- ============ ENGELSKA: Site Demo Outreach EN ============

-- Email 1: curiosity, NO link
UPDATE sequence_nodes SET config = config || jsonb_build_object(
'prompt', $p$You write like a normal person, not like a salesperson.

The goal is NOT to sell. The goal is to make the reader curious enough to reply.

Write a natural email in English. Max 70 words.

Information:
Company: {{company_name}}
Industry: {{category}}
Current website: {{website}}

Content:
Say you came across {{company_name}} and got curious about what a modern version of their website could look like.
Say you sat down and put together a quick draft on your own initiative.
Make clear it is only a draft and that everything can be changed.
End with one simple question offering to send the link, e.g. "Want me to send the link?" or "Should I send it over so you can take a look?".

Rules:
NEVER criticise their current website.
NEVER write out any URL or link in this email — the link comes in the next email.
No signature. No pricing. No hard sell. No emojis.
No brackets or placeholders left in the text.
Never write the company name in ALL CAPS.
Write natural, idiomatic English only — no Swedish words.$p$,
'subject_prompt', $p$You are a skilled English copywriter writing ONE subject line for a first cold email.

The company is {{company_name}}.

Goal: spark curiosity. It must NOT reveal that this is about a website and must not sound like an ad.

Rules:
Max 42 characters.
Output the subject line only.
No emojis, no exclamation marks, no quotes, no ALL CAPS.
Do not use the words: website, free, offer, discount, deal.
No "Re:", no clickbait.
Vary the wording between recipients — do not reuse the same line every time.

Good examples:
An idea for {{company_name}}
Quick question, {{company_name}}
Something I made for you
Came across {{company_name}}
Thought of you this morning$p$)
WHERE id = '706bf160-a754-464c-a1a5-8e15cc7beaaa';

-- Email 2: delivery, WITH link
UPDATE sequence_nodes SET config = config || jsonb_build_object(
'prompt', $p$You are the same person who emailed {{company_name}} earlier saying you had built a draft of a new website.

This is email two. Now you deliver the link.

Write a natural email in English. Max 70 words.

Information:
Company: {{company_name}}
Industry: {{category}}
Demo: {{demo_url}}
Current website: {{website}}

Content:
Say briefly that it is ready and here it is.
The link must stand alone on its own line, exactly like this: {{demo_url}}
Say everything can be changed — text, images, colours, pages.
End with one simple question, e.g. "What do you think?".

Rules:
Write like a human — short and concrete.
Do not criticise their current website.
Never write out any URL other than {{demo_url}}.
No signature. No pricing. No emojis.
No brackets or placeholders left in the text.
Never write the company name in ALL CAPS.
Write natural, idiomatic English only — no Swedish words.$p$,
'subject_prompt', $p$You write the subject line for the second email, which delivers a finished website demo.

The company is {{company_name}}.

Goal: a clear delivery that makes them want to open and look.

Rules:
Max 45 characters.
Output the subject line only.
No emojis, no exclamation marks, no quotes, no ALL CAPS.
No "Re:", no clickbait, no "free" or "offer".
Vary the wording between recipients.

Good examples:
Here is the site for {{company_name}}
Your new page is live
The demo is ready
Here is how it turned out
Here is the draft$p$)
WHERE id = '456502a1-d87d-49da-8904-c825a41d853c';

-- Email 3: value + price, WITH link
UPDATE sequence_nodes SET config = config || jsonb_build_object(
'prompt', $p$You are the same person who has sent two emails about a finished website demo for {{company_name}}.

This is the third email. They have not replied.

Write a natural email in English. Max 80 words.

Information:
Company: {{company_name}}
Industry: {{category}}
Demo: {{demo_url}}

Content:
Briefly remind them the demo is still up.
Mention ONE concrete benefit for a business in {{category}} — e.g. a better first impression, easier to get in touch, a clearer picture of what they do. Do not say their current site is bad.
Present the price calmly and factually: SEK 5,000 to finish and launch the site, and SEK 1,000 per year for hosting and maintenance. Changes to design, text, images and features are made before launch at no extra cost.
The link must stand alone on its own line, exactly like this: {{demo_url}}
End simply, e.g. "Just let me know if you want to take it further."

Rules:
Do not open with an apology or with "Just following up again".
Avoid sales language, pressure and superlatives.
Never write out any URL other than {{demo_url}}.
No signature. No emojis. No placeholders left in the text.
Never write the company name in ALL CAPS.
Write natural, idiomatic English only — no Swedish words.$p$,
'subject_prompt', $p$You write the subject line for the third email, which mentions the price.

The company is {{company_name}}.

Rules:
Max 45 characters.
It should feel personal, not like an offer or an ad.
Output the subject line only.
No emojis, no exclamation marks, no quotes, no ALL CAPS.
No "Re:", no clickbait.
Vary the wording between recipients.

Good examples:
If you want to move ahead
What do you think of the page?
A thought about {{company_name}}
How it works in practice
If the page feels right$p$)
WHERE id = 'bb4e0db5-6dfc-43b3-8264-88d7ea045886';

-- Email 4: friendly close, WITH link
UPDATE sequence_nodes SET config = config || jsonb_build_object(
'prompt', $p$You are the same person who has sent three emails about a finished website demo for {{company_name}}.

This is the last email. They have not replied.

Write a friendly closing email in English. Max 55 words.

Information:
Company: {{company_name}}
Demo: {{demo_url}}

Content:
Say you were going to take the demo down since you do not want to keep bothering them.
Say you will of course keep it and keep building on it if they are still interested.
Briefly remind them of the price: SEK 5,000 for the site and SEK 1,000 per year for hosting and maintenance.
The link must stand alone on its own line, exactly like this: {{demo_url}}
End by saying a short reply is enough.

Rules:
Write like a normal human. No guilt, no pressure, no FOMO.
Never write out any URL other than {{demo_url}}.
No signature. No emojis. No placeholders left in the text.
Never write the company name in ALL CAPS.
Write natural, idiomatic English only — no Swedish words.$p$,
'subject_prompt', $p$You write the subject line for the final email. It should feel friendly, not dramatic.

The company is {{company_name}}.

Rules:
Max 40 characters.
Output the subject line only.
No FOMO, no "last chance", no clickbait.
No emojis, no exclamation marks, no quotes, no ALL CAPS.
No "Re:".
Vary the wording between recipients.

Good examples:
Should I take the demo down?
Do I keep the page?
One last question
Shutting it down?
What do you say?$p$)
WHERE id = 'f6907839-42b0-4f44-9ce4-f30670cf8950';
