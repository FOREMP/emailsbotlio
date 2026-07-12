## Del 1 – Audit (idag + de senaste 3 dagarna)

**Sends (0 fails — allt går igenom):**


| Datum                | Agency outreach | Bil handlare London | Totalt | Opens    |
| -------------------- | --------------- | ------------------- | ------ | -------- |
| 11 jul (idag, pågår) | 27              | 32                  | 59     | 28 (47%) |
| 10 jul               | 98              | 98                  | 196    | 70 (36%) |
| 9 jul                | 60              | 57                  | 117    | 42 (36%) |


Öppningsfrekvensen är stark (36–47%), särskilt idag. Ingen bounce/fail-våg — botlio-inboxarna beter sig som de ska.

**Enrollments kvar:**

- **Agency outreach:** 307 aktiva (776 klara, 9 unsub)
- **Bil handlare London:** 352 aktiva (400 klara, 2 unsub)

**Runway per lista (baseline ~50 sends/dag/sequence):**

- Agency London 2 (691 med email): ~6 dagar tills alla aktiva enrollments är genom första + follow-up
- Bilhandlare London 1 (755 med email): ~7 dagar
- Bil firmor LA (230 med email): reserv, inte startad
- Agencys 1 (374 med email): reserv, inte startad

Slutsats: allt rullar rent, inga fel att åtgärda. Vi har ~1 vecka innan vi behöver fylla på med nästa lista.

---

## Del 2 – Site generator: nästa våg av förbättringar

### A. Färger från Firecrawl branding

`scrape-lead-data` frågar redan efter `branding`, men `generate-site` använder bara `primary`/`accent`. Utöka så vi tar med hela paletten (background, textPrimary, textSecondary, buttonPrimary) och fonts (`branding.fonts[].family`) från Firecrawl in i prompten. Om branding saknas → fall tillbaka på nuvarande mörk premium-default.

### B. Skärmdump som design-inspo

Idag använder vi bara markdown. Lägg till:

1. `scrape-lead-data`: begär också `screenshot` i formats, spara base64 (eller URL) i `scraped_content.screenshot`.
2. `generate-site`: skicka skärmdumpen som en `image_url`-del i user-meddelandet till Claude (OpenRouter stödjer multimodal på Sonnet 4.5). Prompt-instruktion: "Använd skärmdumpen ENDAST som stil-inspo (färgkänsla, luftighet, ton) — kopiera inte layout eller texter."

### C. Smartare sub-page discovery

Nu matchar vi bara `omoss`/`tjanster`. Utöka `pickBestUrl`-mönstren till ordnade fallback-listor:

**About-slugs (i prioriteringsordning):**
`om-oss`, `omoss`, `om`, `foretaget`, `foretag`, `om-foretaget`, `historia`, `info`, `information`, `vilka-vi-ar`, `vilka-ar-vi`, `about`, `about-us`, `company`, `who-we-are`

**Services-slugs:**
`tjanster`, `vara-tjanster`, `service`, `services`, `verkstad`, `verkstadstjanster`, `reparation`, `reparationer`, `bilservice`, `erbjudanden`, `sortiment`, `vad-vi-gor`, `what-we-do`, `offerings`

Loopa listan tills första träff. Även: kolla nav-länkarnas ankartext i `rootScrape.links` för att hitta "Om oss"-länkar som ligger på weird slugs (t.ex. `/page-42`).

### D. Extra web-research för mer info och bilder

&nbsp;

1. **Bilder utöver Unsplash:**
  - Behåll `branding.images` (logo, favicon, og-image) från Firecrawl som vi redan får.
  - Plocka riktiga bilder från `pages.home/about/services.images` som är hostade på deras egen domän — dessa är alltid autentiska av företaget.
  - Manuell overrides: lägg ett `custom_fields.extra_images` fält på contact (array av URLs) så du kan klistra in Google Maps-bilder, gamla hemsidebilder osv. `generate-site` prioriterar dessa före Unsplash.
2. E. Prompt-uppdatering i `generate-site`

- Ta emot: full branding-palett, fonts, screenshot (som image content-part), extra_images-URLs, maps-url, kund-citat.
- Regel: använd deras riktiga färger som primär palett om `branding.colors` finns, annars mörk default.
- Regel: använd deras riktiga fonts från Firecrawl om vi hittar dem, annars Space Grotesk + Inter.
- Skärmdumpen är stil-referens, inte layout-kopia.
- Fortsatt: aldrig hitta på fakta.

---

## Teknisk sammanfattning (för dig som utvecklare)

**Filer som ändras:**

- `supabase/functions/scrape-lead-data/index.ts` — utöka slug-listor, lägg till `screenshot` i formats, lägg till valfri Firecrawl `search`-fas, spara branding-full palett + fonts.
- `supabase/functions/generate-site/index.ts` — läs full branding, skicka screenshot som multimodal part till OpenRouter (`content: [{type:'text',...},{type:'image_url', image_url:{url}}]`), inkludera extra_images/maps_url/citat i prompten, mappa deras färger till CSS-variabler.
- `src/pages/Sites.tsx` — ny liten "Extra info"-dialog per lead med fält för `google_maps_url` och `extra_images[]` (sparas i contactens custom_fields).

**Ingen DB-migration behövs** — allt går i befintliga `custom_fields` (jsonb) och `generated_sites.scraped_content` (jsonb).

**Kostnadsnot:** Firecrawl search + screenshot-scrape drar ~2–3 extra credits per lead. OpenRouter multimodal på Sonnet 4.5 kostar lite mer per generering (bilden räknas som ~1000 tokens).

Godkänn så bygger jag i denna ordning: (1) slug-fallbacks + screenshot-capture, (2) branding-färger i generatorn, (3) multimodal prompt med screenshot, (4) Maps + extra bilder UI, (5) Firecrawl search för recensioner.