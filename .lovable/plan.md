## Mål

Höja kvaliteten på genererade sajter dramatiskt genom att ge Claude Sonnet 4.5 ett bibliotek av handplockade premium-sektioner att remixa — istället för att låta den improvisera från noll varje gång.

## Så funkar det

Vi bygger en katalog med 8–12 premium HTML-sektioner (hero, tjänste-grid, process, galleri, CTA-band, kontakt, footer, om-oss-hero, service-detalj, FAQ, testimonial-block, trust-strip). Varje sektion är:

- Ren HTML + inline CSS, ingen JS
- Använder CSS-variabler för färger (`var(--primary)` etc) så vi kan swap:a in kundens branding
- Bild-URLer är `{{IMAGE_1}}`-tokens som ersätts vid generering
- Text-innehåll är korta lorem-liknande placeholders — Claude skriver om med kundens riktiga innehåll

Claude får hela biblioteket i prompten + instruktion: "Välj 5–7 sektioner per sida som passar denna verkstad. Remixa dem, byt inte layout. Fyll med kundens riktiga inneåll. Byt CSS-variabler till deras färger."

## Filer som ändras

**Nytt:** `supabase/functions/generate-site/templates.ts`

Exporterar `SECTION_LIBRARY` som record: `{ hero_fullbleed: {name, description, html}, hero_split: {...}, services_grid_3col: {...}, ... }`. Varje sektion är 60–150 rader polerad HTML/CSS baserad på award-winning verkstads/service-sajter (asymmetriska layouts, generös whitespace, dramatiska hovers, layered depth). Jag skriver dessa själv i handkodad premium-kvalitet.

**Uppdateras:** `supabase/functions/generate-site/index.ts`

- Importera `SECTION_LIBRARY`
- Ny system-prompt-sektion: "SEKTIONSBIBLIOTEK — välj och remixa från dessa, hitta inte på egna layouts från noll"
- Skicka hela biblioteket som JSON i user-content
- Instruera: hem = 5–7 sektioner, om-oss = 4–5, tjänster = 5–6, aldrig samma sektion två gånger på samma sida
- Behåll all befintlig logik: branding-färger via CSS-variabler, screenshot som stil-inspo, bild-pool, sticky nav, aldrig hitta på fakta

## Sektionsbiblioteket — konkret innehåll

**Heros (3):** full-bleed image + gradient overlay + stor typografi | split 60/40 med bild höger | video-feel med parallax-känsla via CSS

**Trust/social proof (2):** logotyp-strip av bilmärken | statistik-band (år i branschen, antal servicear, etc — bara om vi har fakta)

**Tjänster (3):** 3-kol kort med ikoner | asymmetriskt bento-grid | lista med thumbnails vänster

**Process (1):** 4-stegs horisontell tidslinje med numrerade steg

**Galleri (2):** masonry 3-kol | full-bredd carousel-liknande grid

**Om-oss (2):** stor bild vänster + text höger med värderingar | citat-block med bakgrundsbild

**Kontakt (2):** split med Maps-embed höger | centrerad med telefon/adress-kort

**CTA-band (1):** full-bredd med bakgrundsbild + gradient + stor knapp

**Footer (1):** 3-kol med länkar + kontakt + copyright

Totalt: 17 sektioner, ~1500 rader HTML — får plats i Claude's kontext (~8k tokens av bibliotek + resten till kundens data).

## Vad detta ger

- Genererade sajter ser ut som "riktiga" premium-sajter, inte som AI-skräp
- Konsekvent kvalitet — även om Claude har en dålig dag kan den inte generera fula sektioner
- Variation mellan sajter genom att Claude väljer olika kombinationer per lead
- Kundens riktiga färger appliceras automatiskt via CSS-variabler
- Ingen extra kostnad per generering (bara lite fler tokens i prompten)

## Vad detta INTE fixar

- Om Firecrawl skrapar tunt innehåll → sajten blir fortfarande tom (samma problem som nu)
- Om vi inte har riktiga bilder → Unsplash-fallback ser fortfarande generisk ut
- Detta löser design-kvaliteten, inte innehålls-kvaliteten

## Efter godkännande

Jag bygger templates.ts, uppdaterar generate-site, deployar, och du testar Generate på en befintlig lead. Om du vill fler/färre sektionstyper efter första testet är det trivialt att lägga till.
