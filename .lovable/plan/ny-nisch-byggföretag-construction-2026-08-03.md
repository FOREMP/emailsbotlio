# Ny nisch: Byggföretag (`construction`)

Samma flöde som bilverkstad och frisör — men med egen mall, egen copy-hjärna och ett eget visuellt tema som ska se dyrt ut.

## 1. Så kopplas nischen in (samma logik som idag)

Fyra ställen behöver känna till `construction`:

- **Import** (`import-site-leads`): lägg `construction` i den tillåtna nisch-listan.
- **Import-UI** (`src/pages/SiteLeads.tsx`): nytt val "Byggföretag / entreprenad" i nisch-dropdown, i filtret och i bulk-/redigera-väljaren.
- **Lead-pipeline** (`process-site-leads`): mappa `construction` → mallen `construction_v1`, och lägg till nyckelord i `inferLeadNiche` (bygg, byggfirma, entreprenad, snickeri, snickare, mureri, murare, tak, takläggare, plattsättning, badrum, renovering, mark, anläggning, VVS, el, betong, husbyggare, totalentreprenad).
- **Generatorn** (`process-site-jobs`): ny nyckel i `NICHE_CONFIG` och mappning i `nicheFromTemplate` (`construction_v1` → construction). Ingen ny databaskolumn behövs — `niche` finns redan.

## 2. Vad som ska finnas i mallen (innehåll)

Byggkunder köper på trygghet och bevis, inte på "vi är proffs". Sidstrukturen blir samma fyra sidor (hem / om oss / tjänster / kontakt), men sektionerna vinklas om:

- **Hero**: stor bygg-/projektbild, ortnamn i eyebrow ("Byggfirma i Uppsala"), rubrik i två rader, tre trygghetsmarkörer (t.ex. F-skatt, försäkrat arbete, fast kontaktperson) — bara om det finns täckning i källdata.
- **Vägar in** (pathways, 4 st): Renovering av badrum/kök · Tillbyggnad & nybygg · Tak, fasad & yttre · Mark & grund. Varje kort med "när passar detta".
- **Tjänster** (5–7): stora bildrader med "När:"-rad, samma mönster som frisörmallen men bygg-vokabulär.
- **Så jobbar vi** (process, 3–4 steg): Platsbesök & behovsbild → Offert och tidplan → Utförande med löpande avstämning → Slutbesiktning & överlämning.
- **Projekt-scenarier** (3 st): typiska uppdrag, inte påhittade referenser — kategori, situation, vad leveransen innebar.
- **Varför oss** (differentiators, 4 st): fast pris/tydlig offert, en kontaktperson genom hela projektet, egna hantverkare, dokumenterad slutbesiktning.
- **Trygghet & administration**: ROT-avdrag, försäkring, garanti, behörigheter — formulerat generellt, aldrig med påhittade nummer eller certifikat.
- **FAQ** (4–6) och **CTA-band** med telefon/mejl. Inget kontaktformulär (samma regel som övriga mallar).

## 3. Så får den wow-faktor (visuellt)

Nytt tema `theme-build` bredvid `theme-salon` i CSS-genereringen, drivet av samma brand-färger som redan hämtas från leadens gamla sajt:

- **Mörk, arkitektonisk bas**: djup grafit/betong-yta i hero och band, ljus sektion emellan — hög kontrast istället för salongens ljusa mjukhet.
- **Typografi**: kraftig grotesk display (Archivo/Space Grotesk-karaktär), tight radavstånd, versala eyebrows med brett teckenmellanrum. Body i Inter.
- **Rutnätsdetalj**: subtil ritnings-/måttlinje-grafik som bakgrundslager i hero och i process-sektionen — signalerar bygghandling utan bilder.
- **Skarpa kanter**: liten radie (4–6px) istället för salongens 28px — bygg ska kännas exakt, inte mjukt.
- **Stor projektmosaik**: asymmetriskt bildgalleri (1 hög + 2 låga) för före/under/efter-känsla.
- **Numrerade steg** i stort format (01 / 02 / 03) med linje emellan.
- **Accentfärg** från leadens befintliga sajt (ofta gul/orange i branschen) används på siffror, streck och knappar — samma `deriveBrandColors` som idag.
- **Bildpool**: ~12 kurerade Unsplash-bilder (byggarbetsplats i bra ljus, färdig renovering, takarbete, snickeri, arkitektoniskt exteriör). `useLeadImages: false` som för frisör — byggföretags egna bilder är ofta lågupplösta och sänker intrycket.

## 4. Så byggs AI-delen (custom för generatorn)

- Egen `systemPrompt` för construction: svensk copywriter för byggsajter, ton = konkret, ordhållig, yrkesstolt. Samma JSON-schema som idag (inget nytt kontrakt) så HTML-byggaren kan återanvändas rakt av.
- Samma `businessType`/`venueNoun`/`serviceNoun`-profil som salongen använder, så en takläggare eller markentreprenör under bygg-taggen får rätt ord istället för generiskt "byggföretag" — `adaptNicheConfig` utökas till att gälla även construction.
- Fullständiga fallbacks (tjänster, värden, FAQ, pathways) så att en sajt blir komplett även när scrapen ger tunt underlag.
- Samma hårda regler: inga påhittade priser, årtal, certifikat, kundnamn eller referensprojekt.

## 5. Verifiering

Tagga 2–3 riktiga byggleads som `construction`, kör generering manuellt via Site Leads-sidan, granska: rätt mall, svensk bygg-copy utan bil-/salongsord, färger tagna från gamla sajten, alla bilder laddar. Kontrollera samtidigt att en verkstads- och en salongslead fortfarande genererar oförändrat.

## Tekniska noteringar

Filer som ändras: `supabase/functions/process-site-jobs/index.ts` (NICHE_CONFIG + `nicheFromTemplate` + `theme-build`-CSS + construction-grenar i `buildSiteFiles`), `supabase/functions/process-site-leads/index.ts` (mall-mappning + `inferLeadNiche`), `supabase/functions/import-site-leads/index.ts` (tillåten nisch), `src/pages/SiteLeads.tsx` (nisch-val). Ingen migration, ingen ändring av e-postutskick eller sekvenser.
