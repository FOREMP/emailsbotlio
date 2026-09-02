# Lugnare UI: ingen auto-omladdning, hopfällda listor, paginerad kö

Tre problem: sidorna laddar om sig själva var 30:e sekund, kön på Demo Outreach visar alla enrollments på en gång, och både kön och approval-listan renderas direkt när sidan öppnas (långt scrollande och laggigt).

## 1. Stoppa auto-omladdningen

- `SiteOutreach.tsx` och `SiteApprovals.tsx`: ta bort `setInterval(load, 30_000)`. Data laddas vid sidöppning, vid filterbyte och när du gör en åtgärd (godkänn, ta ut, kör tick) — precis som idag.
- Varje sida får en tydlig "Uppdatera"-knapp i sidhuvudet med tidsstämpel ("Senast uppdaterad 11:42") så du själv styr när färsk data hämtas.
- `SitePipelineAlert` (den lilla varningsbannern överst) slutar också polla var 30:e sekund; den hämtas en gång per sidladdning. Den är liten och orsakar inte laggen, men den triggar nätverksanrop i bakgrunden.

## 2. Kön på Demo Outreach: hopfälld + 20 per sida

- "Kö"-kortet visar bara rubriken med antal (t.ex. "Kö · 34 väntande") och en pil. Klick fäller ut tabellen.
- Utfälld visar den 20 rader per sida med Föregående/Nästa och "Sida 1 av 2 · visar 20 av 34".
- Enrollment-raderna hämtas först när du fäller ut kortet, inte vid sidladdning. Övriga delar av sidan (KPI:er, stegtabell, senaste mailen) laddas som vanligt direkt, eftersom de är sammanfattningar och inte långa listor.

## 3. Approvals: hopfälld lista

- Samma mönster på Approvals-sidan: statuskorten/filterraden och rubriken med antal syns direkt, själva lead-listan är hopfälld tills du klickar.
- Listan hämtas först vid utfällning. Paginering finns redan (20 per sida) och behålls.
- Utfällt/hopfällt-läget kommer ihåg sig i `localStorage` per sida, så om du alltid vill ha kön öppen behöver du inte klicka varje gång.

## Tekniska detaljer

- Collapse byggs med befintlig shadcn `Collapsible` (`@/components/ui/collapsible`).
- Lazy load: `load()` delas upp så att den tunga enrollment-/lead-hämtningen körs via en `hasLoadedList`-flagga som sätts vid första utfällning; efterföljande utfällningar använder cachad data tills du trycker Uppdatera eller gör en åtgärd.
- Kö-pagineringen görs klientsidigt över redan hämtade enrollments (`QUEUE_PAGE_SIZE = 20`) — kön räknas fortfarande in i KPI-siffrorna som idag.
- Inga ändringar i edge functions, databas eller utskickslogik.
