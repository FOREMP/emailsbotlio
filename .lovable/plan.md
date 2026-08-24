# Varför alla sajter ser likadana ut – och hur vi fixar det

## Vad jag hittade

Alla sajter byggs idag av freeform-motorn (`process-site-jobs/freeform.ts`). Den väljer en "template family" per lead, och det valet fungerar faktiskt bra: av de 490 sajter som byggts de senaste tre veckorna fick 280 familjen `salon_editorial_luxury`, 89 `byggform_architectural_trust`, resten klinik/restaurang/service.

Problemet är att familjevalet nästan inte påverkar hur sajten ser ut.

1. **Samma HTML-skelett för alla.** Varje sida renderas från exakt samma åtta block: hero, intro, tjänster, sektioner, galleri, FAQ, kontakt, CTA (`freeform.ts:713-749`). Familjen får bara ändra **ordningen** på dessa block. Sektionsnamnen i mall-biblioteket (`hero_private_clinic_statement`, `care_paths_editorial_rows`, `people_and_approach_split` ...) finns i planen men renderas aldrig som egen markup – de kastas bort.
2. **Bara två familjer har egen CSS.** I `buildCss` finns visuella överskrivningar enbart för `bistro_atmospheric_landing` och `byggform_architectural_trust`. `salon_editorial_luxury`, `clinic_private_care`, `mechanic_precision_workshop` och `service_company_modern` får den identiska bas-stilen. Det är därför frisörsalongerna – vår största grupp – ser ut som "generella" sajter: de *har* frisörmallen men mallen har inget eget utseende.
3. **Referensmallarna används inte.** `generate-site/reference-templates/hair_salon_v1` (den editoriella vin/guld-designen) och `service_company_v1` ligger kvar som döda filer. Ingen kod läser dem.
4. **Ingen variation inom en nisch.** Två frisörsalonger med liknande färger får bokstavligen samma sida. Det finns ingen variantväxel alls.

## Vad vi bygger

### 1. Riktiga sektionsrenderare istället för ett fast skelett
Sektionslistorna som redan finns i `_shared/block-templates.ts` blir det som faktiskt styr renderingen. Vi lägger till en sektionsregister-modul där varje sektionsnyckel har en egen HTML-renderare, och sidan byggs genom att loopa planens `sections` i ordning.

Prioritet – vi bygger egen markup för de sektioner som förekommer i frisör-/skönhets- och verkstadsfamiljerna först (de täcker merparten av volymen), och låter övriga sektionsnycklar falla tillbaka på dagens generiska block så ingenting slutar fungera.

Nya, tydligt olika hero-typer:
- **Editorial (salong/skönhet):** split-hero med stor porträttbild till höger, serif-display, tunn versal-eyebrow, ingen glaskort-ruta.
- **Klinik:** lugn, ljus hero utan bakgrundsbild, centrerad text, mjuk panel med öppettider/kontakt.
- **Verkstad:** mörk, kantig hero med bild i helbredd, stora versaler, hårda hörn.
- **Bygg** och **restaurang:** behåller dagens (de har redan egen känsla).

### 2. Eget utseende per familj
CSS-överskrivningar för de fyra familjer som saknar dem. Varje familj får sin egen radie, typografi, sektionsrytm, kortstil och knappform – fortfarande ovanpå kundens riktiga färger från Firecrawl, så färgprofilen ärvs som idag.

- Salong: serif-display, radie 0–4px, generöst luftrum, kort utan skugga, linjer istället för ramar.
- Klinik: mjuka radier, ljus bakgrund, lugn typografi, låg kontrast.
- Verkstad: raka hörn, kraftig sans, mörk sektionsväxling, industriell känsla.
- Service company: kompaktare rutnät, kraftigare kortkontrast, tydligare CTA-band.

### 3. Varianter inom varje familj
Varje familj får 2–3 layoutvarianter (t.ex. salong A = bildtung editorial, salong B = typografidriven med minimal bildanvändning). Varianten väljs deterministiskt från lead-ID, så två salonger i samma vecka inte blir identiska – och samma lead ger samma resultat vid omkörning. Varianten sparas i `gen_progress` så den syns i godkännande-vyn.

### 4. Bättre familjeträff för salonger
Regexen som väljer familj kollas igenom: kliniktermen `vård` matchar idag även "hudvård" och "hårvård", vilket kan dra en salong till klinikmallen. Skönhetsträffar prioriteras före klinik för salongsord.

## Vad som inte ändras

Innehållsgenerering (DeepSeek V4 Flash + gpt-4o-mini-polish), färgutvinning, bildkällor, språkhantering, e-post, sekvenser, triage och deploy till Vercel rörs inte. Inga extra AI-anrop tillkommer – all variation sker i renderaren, så kostnaden per sajt är oförändrad.

## Verifiering

Bygg om 6 leads i olika nischer (2 frisör, 1 klinik, 1 verkstad, 1 bygg, 1 service) och jämför sida vid sida i godkännande-vyn: de två frisörerna ska ha olika layout från varandra och tydligt annan känsla än verkstaden. Kontrollera mobilvyn, att alla länkar går till genererade sidor, att inga formulär smugit in och att kundens färger används.

## Tekniska noteringar

- Ny fil `supabase/functions/process-site-jobs/sections.ts`: `SECTION_RENDERERS: Record<string, (args) => string>` + `renderSections(plan, page, ...)` med fallback till dagens block.
- `freeform.ts`: `familyBody()` byter till sektionsdriven rendering; `buildCss()` får familj- och variantspecifika CSS-block; `buildPlan()` sätter `variant`.
- `_shared/block-templates.ts`: justerad prioritetsordning i `selectBlockTemplateFamily`, plus variantdefinitioner per familj.
- `VERSION` i `freeform.ts` höjs så pågående jobb byggs om från början istället för att blanda gammal och ny struktur.
- Inga databasmigrationer krävs (`gen_progress` är jsonb).
