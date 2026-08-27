# Öppningsspårningen är trasig — orsaker och fix (SV + EN)

Data från databasen: fram till 18 augusti registrerades öppningar normalt (t.ex. 22 mail / 15 öppnade). Från 19 augusti och framåt: **0 öppningar på samtliga 300+ mail**, i alla sekvenser och båda språken. Inga "Re:"-ämnesrader finns heller på något mail, någonsin.

## Problem 1 (huvudorsaken): inget mail flaggas som uppföljning

I `run-sequences` avgörs `is_followup` genom att söka tidigare skickade mail i enrollment med filtret `sent_at >= enr.updated_at`. Men `updated_at` sätts om av en databas-trigger vid varje uppdatering av enrollment — den är alltså alltid "nyss". Sökningen hittar därför aldrig ett tidigare mail, `isFollowup` blir alltid `false`.

Konsekvenser:
- `send-cold-email` behandlar varje mail som "första kontakt" → skickas som ren text **utan spårningspixel** → 0 öppningar för alla steg.
- Ingen "Re:"-ämnesrad → uppföljningarna trådas inte i mottagarens inkorg (bekräftat: 0 "Re:" i hela historiken).

**Fix:** basera fönstret på när enrollment senast (åter)aktiverades istället för `updated_at`. Enklast och säkrast: använd `enr.last_sent_at` som bevis på att mail redan gått ut — om `last_sent_at` finns är det per definition en uppföljning — och hämta originalämnet utan `updated_at`-filtret (istället begränsat till t.ex. mail skickade efter `created_at`, senaste 20 raderna, plocka senaste icke-"Re:"-ämnet). Då blir både pixeln och trådningen korrekt igen.

## Problem 2: `tracking_host` är tomt för alla domäner

Alla sex rader i `sending_domains` (foremp.email, foremp.eu, foremp.one, botlio.email, botlio.eu, botlio.io) har `tracking_host = null`. Pixeln faller därför tillbaka på `*.supabase.co`, vilket är en av de starkaste "massutskick"-signalerna för Gmail — och gör att öppningsstatistiken riskerar att bli sämre även när pixeln är på plats igen.

**Fix:** kör `setup-tracking-proxy` igen från Domains-sidan och sätt `t.<domän>` för de aktiva domänerna, alternativt sätt `TRACKING_BASE_URL` som fallback. Ingen kodändring krävs — funktionen och UI:t finns redan. Detta är ett DNS-steg du gör en gång per domän.

Verifierat: själva pixel-endpointen fungerar (`/functions/v1/track-open/o/<id>.gif` svarar 200 image/gif, `verify_jwt = false`), så inget är fel i `track-open`.

## Problem 3: öppningsgraden räknas på mail som aldrig kunde spåras

Mail 1 skickas medvetet utan pixel (inboxplacering). I statistiken räknas de ändå i nämnaren, vilket gör att öppningsgraden alltid ser låg ut och att man inte kan skilja "inte öppnat" från "inte spårbart".

**Fix:** markera vid utskick om mailet hade pixel — ny kolumn `tracking_enabled boolean not null default false` på `sent_emails`, satt av `send-cold-email`. Analys-vyerna (`useAnalytics`, Demo Outreach-statistiken och stegtabellen) räknar öppningsgrad endast på mail med `tracking_enabled = true` och visar "ospårade" separat.

## Problem 4: gamla mail sedan 19 aug går inte att rädda

De ~300 mail som redan skickats utan pixel kommer aldrig få öppningsdata. De bör markeras som ospårade (samma kolumn som ovan, backfill: allt före 19 aug = spårat, allt efter = ospårat tills fixen är ute) så att grafen inte visar en falsk kollaps i öppningsgrad.

## Teknisk sammanfattning av ändringarna

1. `supabase/functions/run-sequences/index.ts` — rätta detekteringen av uppföljning (ta bort `updated_at`-fönstret), så att `is_followup` och `subject_override` fungerar.
2. Migration — `alter table public.sent_emails add column tracking_enabled boolean not null default false` + backfill av historiken.
3. `supabase/functions/send-cold-email/index.ts` — sätt `tracking_enabled: true` när pixeln bäddas in (uppföljningar).
4. `src/hooks/useAnalytics.ts` + `src/pages/SiteOutreach.tsx` — öppningsgrad beräknas på spårbara mail; ospårade visas som egen kolumn.
5. Manuellt (du): kör "Sätt upp tracking-host" på Domains och lägg CNAME `t` för foremp.email, foremp.eu, foremp.one, botlio.email, botlio.eu.

Gäller båda språken — svenska och engelska sekvenser går genom exakt samma kodväg, så ingen språkspecifik logik behövs.
