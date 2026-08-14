# Engelska sajter ska bli helt engelska

Problemet är inte modellen. AI:n skriver faktiskt engelska — men koden runt omkring skriver tillbaka svenska på flera ställen. Nedan är de bekräftade orsakerna, hittade i koden.

## Vad som faktiskt går fel

**1. En språkfilter-funktion kastar bort korrekt engelsk text**
`repairContent` kör varje textfält genom `hasBadLanguage`, som flaggar en text som "dålig" så fort den innehåller två vanliga engelska ord (`the`, `and`, `with`, `for`, `clinic`, `booking` ...). För engelska leads betyder det att nästan all bra engelsk copy klassas som trasig och ersätts med de svenska fallback-texterna. Det här är huvudorsaken till att sidorna blir halvt engelska, halvt svenska.

**2. Fallback-innehållet finns bara på svenska**
`fallbackContent` (hero, intro, sektioner, FAQ, avslut) och tjänstelistorna (`SERVICE_DEFAULTS`, `serviceText`) är helsvenska. Varje gång ett modellanrop misslyckas eller ett fält underkänns landar svensk text på en engelsk sida.

**3. Sidplanen är svensk**
Sidtitlar och slugs kommer från `pagesForTemplate` i `block-templates.ts`: "Kontakt", "Process", "Om oss", "Vanliga frågor", `om-oss.html`, `tjanster.html`, `fragor.html`. Titlarna visas rakt av i meny, sidhuvud, footer och `<title>`.

**4. Fasta rubriker i renderern**
Flera etiketter är hårdkodade utan språkval: sektionsrubriken "Vanliga frågor", eyebrow "Kontakt", "Steg", "Detalj", ankaret `#kontakt`, samt `profile.servicesHeading`-varianter som bara delvis är översatta.

**5. Efterbehandlingen skriver in svenska**
`qualityFixFiles` gör svenska sök-och-ersätt i den färdiga HTML:en ("Personlig rådgivning", "Tydlig information, varm känsla ...", "Här finns", "informationen", "presentation") — den körs även på engelska sajter.

**6. Mallmotorn (v3) är helsvensk och kör aldrig språkpasset**
I `process-site-jobs/index.ts` är `MODEL` och `POLISH_MODEL` båda `gpt-4o-mini`, vilket gör `SKIP_POLISH = true`. Det språkpass som har engelskt stöd hoppas därmed alltid över. Dessutom är planprompten, niche-konfigurationen och hela `buildSiteFiles` (nav "Hem/Om oss/Tjänster", `<html lang="sv">`, "Vanliga frågor", "Boka tid", footer "Demo skapad av Botlio") enbart svenska. Alla leads som körs i template-läge blir alltså svenska oavsett språkval.

## Åtgärder

**A. Fixa språkfiltret (störst effekt)**
Gör `hasBadLanguage` språkmedveten: för engelska leads ska engelska ord inte vara ett fel — då kontrolleras i stället svenska markörord (`och`, `för`, `vi erbjuder`, `behandling` ...). Mojibake-kontrollen behålls för båda språken. Samma sak för `isGoodServiceTitle`, som idag filtrerar på svenska stoppord.

**B. Engelska fallbacks**
Lägg engelska motsvarigheter till `fallbackContent`, `SERVICE_DEFAULTS`, `serviceText` och FAQ-fallbacks, valda via `isEnglish(ctx)`. Svenska strängarna lämnas orörda.

**C. Engelsk sidplan**
`pagesForTemplate` får ett `language`-argument och returnerar engelska titlar och slugs (`about.html`, `services.html`, `contact.html`, `faq.html`, `process.html`) för EN. Interna länkar följer med automatiskt eftersom de byggs från samma slug.

**D. Översätt de fasta etiketterna i renderern**
Alla kvarvarande hårdkodade rubriker, eyebrows, knapptexter och ankaret `#kontakt` görs språkstyrda.

**E. Rensa efterbehandlingen**
`qualityFixFiles` kör de svenska ersättningarna endast för svenska sajter; för engelska sajter körs en engelsk motsvarighet (mojibake-städning plus borttagning av "demo"/"the website").

**F. Prompter renodlas för engelska**
Idag skickas engelska instruktioner blandat med svenska regellistor till modellen, vilket bjuder in svenska svar. För EN-leads skickas hela regelblocket på engelska i både innehålls- och språkpasset.

**G. Mallmotorn (v3) för engelska leads**
Två alternativ — jag föreslår det första:
1. Tvinga engelska leads till freeform-motorn (som efter A–F är helt språkmedveten) och lämna mallmotorn helt orörd för svenska.
2. Alternativt: översätt hela `buildSiteFiles` och niche-konfigurationen — betydligt större jobb och risk att svenska sajter påverkas.

## Verifiering

Kör 2–3 engelska leads genom byggaren och kontrollera: `<html lang="en">`, meny/footer/knappar på engelska, inga svenska ord kvar i HTML:en (sökning på `och|Ring|Boka|Kontakt|Tjänster`), samt att en svensk lead byggd direkt efteråt ser exakt likadan ut som idag.

## Tekniska noteringar

Ändringar sker i `supabase/functions/process-site-jobs/freeform.ts` (`hasBadLanguage`, `isGoodServiceTitle`, `repairContent`, `fallbackContent`, `serviceIdeas`/`serviceText`, `SERVICE_DEFAULTS`, render-hjälparna, `qualityFixFiles`, prompterna) och i `block-templates.ts` (`pagesForTemplate` med språkparameter). Motorvalet för EN görs i `supabase/functions/process-site-leads/index.ts` där `generationMode` sätts. Svenska kodvägar lämnas byte-identiska.
