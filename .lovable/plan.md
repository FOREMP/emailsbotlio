# Ny hemsidesmotor: AI bygger hela sajten från grunden (DeepSeek V4 Flash)

Idag går allt genom mallar: AI skriver bara en innehållsplan (JSON) och `buildSiteFiles` sätter ihop färdig HTML från fasta sektioner per nisch. Den vägen ska finnas kvar orörd. Vi lägger till en **andra motor** vid sidan av, som kan slås på och av.

## 1. Två motorer, en strömbrytare

Ny kolumn `generation_mode` på `generated_sites` med värdena `template` (dagens) och `freeform` (ny). Default styrs av en miljövariabel så att hela systemet kan växlas tillbaka på sekunder utan kodändring.

- Kolumnen sätts när jobbet köas (`generate-site` / `process-site-leads`).
- I `/site-leads` och `/site-approvals`: en väljare "Byggmotor: Mall / AI-fri (DeepSeek V4)" — både som global standard och per lead, samt "Regenerera med andra motorn" så samma lead kan jämföras sida vid sida.
- Ingen befintlig mall-, nisch- eller e-postlogik ändras. Misslyckas freeform-jobbet kan det köas om i template-läge.

## 2. Vad AI:n får med sig (rådata in)

Freeform-motorn skickar in Firecrawl-materialet nästan orört istället för sammanfattat:
hem-, om- och tjänster-sidornas markdown (längre utdrag än idag), titlar, beskrivningar, sammanfattning, Firecrawls branding-objekt, upptäckta bilder, Google Maps-länk, kontaktfakta från lead-raden samt nisch-taggen som kontext (inte som mall).

Färgerna körs fortfarande genom dagens `deriveBrandColors` + kontrastkontroll, och skickas som färdiga CSS-variabler som AI:n **måste** använda — så resultatet ärver kundens riktiga färgprofil precis som idag.

## 3. Så byggs sajten (två steg, sidvis)

**Steg A — Sajtplan (billigt anrop, DeepSeek V4 Flash):** AI läser rådatan och bestämmer själv hur många sidor underlaget räcker till. Regler: alltid minst startsida, om oss och kontakt; fler sidor (tjänster, priser, projekt/galleri, vanliga frågor, orter) bara om källdatan täcker dem — max 6. Returnerar en sidlista med slug, syfte och vilka sektioner varje sida ska ha, plus ett designdirektiv (typografi, layoutkaraktär, rytm) som håller alla sidor visuellt sammanhållna.

**Steg B — Sidbygge, en sida per anrop:** för varje sida i planen genererar DeepSeek V4 Flash komplett HTML. En gemensam `style.css` genereras i första anropet och återanvänds av alla sidor, så designen inte spretar.

Varje färdig sida sparas direkt i `generated_files` och planen/positionen i en `gen_progress`-kolumn. Workern gör **en sida per körning** och lämnar tillbaka jobbet i kön — cron plockar upp nästa minut. Det gör att en sexsidig sajt aldrig slår i tidsgränsen på 75 sekunder som idag stoppar långa jobb. Status sätts till `generated` först när sista sidan är klar.

## 4. Språkpass

När alla sidor är byggda körs ett språkpass med **gpt-4.2-mini** som bara får skriva om texten, inte HTML-strukturen: den får textinnehållet extraherat per sida, returnerar förbättrad svensk copy, och texten sätts tillbaka på samma platser. Samma hårda regler som idag — inga påhittade priser, årtal, certifikat eller kundnamn.

## 5. Hårda spärrar på det AI:n får producera

Innan HTML sparas körs en sanering:

- **Inga formulär** — `<form>`, `<input>`, `<textarea>`, `<button type=submit>` tas bort och ersätts av tel:/mailto:-knappar. Ingen backend behövs per sajt.
- Ingen extern JS, inga trackers, inga iframes utom Google Maps-inbäddning.
- Alla interna länkar måste peka på sidor som faktiskt genererats, annars skrivs de om till startsidan.
- Bild-URL:er begränsas till godkända källor (leadens egen domän, användarens extrabilder, kurerade Unsplash-bilder per nisch).
- Saknas `index.html` eller är en sida orimligt kort → jobbet markeras failed med tydligt felmeddelande och kan köras om.

Resultatet är samma filkarta (`index.html`, `om-oss.html`, ..., `style.css`) som deploy-funktionen redan förväntar sig — publicering till Vercel fungerar oförändrat.

## 6. Verifiering

Kör 3–5 riktiga leads (en per nisch) i freeform-läge, jämför mot mall-versionen av samma lead i godkännande-vyn: rätt antal sidor, kundens färger, svensk text som stämmer med verksamheten, inga formulär, alla länkar och bilder fungerar. Kontrollera samtidigt att ett vanligt mall-jobb genereras exakt som förut.

## Tekniska noteringar

Migration: `generated_sites.generation_mode text default 'template'` + `gen_progress jsonb`. Ny fil `supabase/functions/process-site-jobs/freeform.ts` (plan, sidbygge, sanering, språkpass) som `index.ts` grenar till högst upp i jobbhanteringen — dagens kodväg lämnas oförändrad. Modellkonstanter: `deepseek/deepseek-v4-flash-0731` för bygget, `openai/gpt-4.2-mini` för språket, båda via befintlig OpenRouter-nyckel. UI-ändringar i `src/pages/SiteLeads.tsx` och `src/pages/SiteApprovals.tsx`. Inga ändringar i e-post, sekvenser eller deploy.
