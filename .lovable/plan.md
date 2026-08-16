# Bättre ämnesrader + länkstrategi (SV + EN)

Mål: ämnesrader som faktiskt får folk att öppna, och en länkstrategi där mail 1 inte innehåller någon demolänk (skonar domänens rykte) medan mail 2–4 gör det.

## Vad som ändras

Alla prompts ligger i databasen på sequence-noderna (`sequence_nodes.config.prompt` och `.subject_prompt`) för de två sekvenserna:
- Site Demo Outreach (svenska, foremp.email)
- Site Demo Outreach EN (engelska, foremp.eu)

Den engelska sekvensen har idag bara enradiga prompts och statiska ämnesrader — den byggs om till exakt samma struktur och kvalitet som den svenska.

### Mail 1 — nyfikenhet, ingen länk
- Brödtext: samma ton som idag (hittade företaget, blev nyfiken, byggde en snabb demo) men **ingen `{{demo_url}}`** och ingen URL alls. Avslutar med en fråga i stil med "Vill ni att jag skickar länken?".
- Ämnesrad: bort från "Vi byggde en hemsida"-formuleringarna som avslöjar hela erbjudandet. Nya regler: max 42 tecken, gemener-känsla, konkret och personligt, ska väcka nyfikenhet utan att sälja. Exempel som ges till modellen: "En idé till {{company_name}}", "Snabb fråga, {{company_name}}", "Något jag gjorde åt er", "Kollade in {{company_name}}". Förbjudet: emojis, utropstecken, versaler, "gratis", "erbjudande", "rabatt", clickbait, ordet "hemsida" i mail 1.

### Mail 2 — leveransen, med länk
- Brödtext: "här är den" — kort, konkret, länken ensam på egen rad (`{{demo_url}}`), allt går att ändra, avslutas med enkel fråga.
- Ämnesrad: tydlig leverans. Exempel: "Här är hemsidan för {{company_name}}", "Din nya sida ligger uppe", "Demon är klar". Max 45 tecken.

### Mail 3 — värde + pris, med länk
- Behåller dagens innehåll (5 000 kr + 1 000 kr/år, ändringar ingår) men skärps: kortare, ett konkret värde för branschen, länken på egen rad.
- Ämnesrad: personlig, inte erbjudande-doftande. Exempel: "Om ni vill gå vidare", "Vad tänker ni om sidan?", "En tanke kring {{company_name}}".

### Mail 4 — vänlig avslutning, med länk
- Behåller dagens ton (tar bort demon om inget svar), kortas ner, länken kvar.
- Ämnesrad: exempel "Ska jag ta bort demon?", "Behåller jag sidan?", "En sista fråga".

### Generella promptregler som läggs till i alla 8 noder
- Ämnesrad-prompten får en explicit "variera mellan mottagare"-regel så att inte alla mail får samma rad.
- Ingen "Re:"-fejk, inga hakparenteser/platshållare kvar i utdata, aldrig företagsnamn i VERSALER.
- Brödtext-prompten får en regel: skriv aldrig ut någon URL utom exakt `{{demo_url}}` (och i mail 1: ingen URL alls).

### Engelska versionen
Exakt samma fyra steg, samma regler, översatta och anpassade idiomatiskt (inte ordagrant). Priset skrivs i mail 3 EN som motsvarande belopp — behöver bekräftas: behåll SEK eller ange EUR/USD?

## Teknisk del

- En databasmigration som gör `UPDATE sequence_nodes SET config = config || jsonb_build_object('prompt', ..., 'subject_prompt', ...)` för de 8 `send_email`-noderna (4 SV + 4 EN), matchade på nod-id. Inga schemaändringar.
- Ingen kodändring behövs i `generate-email` (den kör redan ett separat subject-anrop) eller i `run-sequences`.
- Viktigt att verifiera: `send-cold-email` kräver en giltig demo-URL så fort kontakten har `site_lead_id`, även om mail 1 inte innehåller länken. Det behålls — vi mailar bara leads vars demo redan är byggd, mail 1 nämner den bara inte.
- EN-noderna körs på `gpt-4o-mini`, SV på `gpt-4.1-mini` — lämnas som de är.

## Efter implementation
Skickar en förhandsgranskning av genererad ämnesrad + brödtext för alla fyra steg på ett riktigt lead (utan att skicka mail), så du kan godkänna tonen innan nästa körning.
