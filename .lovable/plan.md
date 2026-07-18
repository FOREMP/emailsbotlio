## Vad Supabase-mailet betyder

Nano-instansen har en **Disk IO Budget** (burst-krediter för läs/skriv). När vi använder mer än vår sekundliga tilldelning bränner vi krediter — när krediterna tar slut throttlar Postgres. Det är exakt vad som händer nu.

## Rotorsak — vem drar IO:t

Från `pg_stat_statements` (7 dagars fönster) står två saker för nästan all IO, och båda kommer från våra egna cron-jobb, inte från riktiga användare:

| # | Ursprung | Symptom |
|---|---|---|
| 1 | **`run-sequences`** poll-loop | 10 070 "hitta due enrollments"-queries, 22 702 "sortera efter last_sent_at", 48 207 single-row UPDATEs på `enrollments`, 48 377 SELECT på `sequence_nodes`/`sequence_edges` (**en läsning per enrollment, varje pass** — grafen läses från början varje gång) |
| 2 | **`process-site-jobs`** cron | Schemalagd `* * * * *` (varje minut, 1 440 gånger/dag) även när kön är tom — bootar isolat + kör claim-queryn utan anledning |
| 3 | `sent_emails` full scan | 17 anrop, 430 ms medel — en sida som gör `select *` utan filter/limit |
| 4 | `email_unsubscribe_tokens` inserts + lookups | 2 000+ rader — vi skapar en NY token per skickat mail istället för att återanvända |

Kontakter/sender-tabellerna är inte problemet. Det är **skrivvolym på `enrollments` + onödiga cron-tickar** som äter budgeten.

## Plan — sänk IO utan att röra utgåendemailen

### 1. Sluta re-läsa hela sekvens-grafen varje pass (största vinsten)
I `run-sequences/index.ts`: cacha `sequence_nodes` + `sequence_edges` per `sequence_id` i minnet för hela invocation:en. Idag laddas de om per enrollment → 48k läsningar blir ~10–20 per pass.

### 2. Slå ihop enrollment-updates
Idag: 2–3 separata `UPDATE enrollments` per enrollment per pass (updated_at bump, sedan next_send_at, sedan status). Slå ihop till **en enda UPDATE** i slutet av varje enrollment-steg. Sparar ~2/3 av skrivvolymen på den tyngsta tabellen.

### 3. Gör `process-site-jobs`-cron villkorlig
Byt schema från `* * * * *` till `*/5 * * * *` **och** lägg till en `WHERE EXISTS (SELECT 1 FROM generated_sites WHERE status IN ('queued','processing') …)` guard i själva cron-SQL:n så vi inte ens kallar edge-funktionen när kön är tom. `generate-site` kickar redan workern direkt vid enqueue, så cron behövs bara som fallback.

### 4. Återanvänd `email_unsubscribe_tokens`
Slå upp befintlig token per email först; skapa bara ny om den saknas. Tar bort ~2 000 inserts/vecka.

### 5. Fixa `sent_emails select *`-scannen
Hitta callsite (troligen Analytics eller Files-sidan) och lägg till `.limit()` + kolumn-projektion så vi inte drar hela tabellen till klienten.

### 6. Städa döda enrollments
1 746 `completed` + 149 `failed` + 17 `unsubscribed` rader ligger kvar och deltar i varje status-filter/index-scan. Arkivera till en `enrollments_archive`-tabell (eller bara ta bort completed äldre än 30 dagar). Mindre tabell = mindre IO per poll.

### Ordning
Steg 1 + 2 + 3 ger ~80 % av besparingen och är kod-ändringar i två filer + en cron-migration. Gör dem först, mät ett dygn, sedan 4–6 vid behov.

### Vad som INTE ändras
- Cold email-utskicken (`send-cold-email`, sekvenslogik, follow-ups)
- Daily send limits per sender
- Open tracking, deploy-flödet, site generation-kvaliteten

Säg till om jag ska bygga det så kör jag steg 1–3 direkt.