# Fix: 404 på demo-länkar + hur deploy faktiskt fungerar

## Så fungerar det idag (inte som du trodde)

Det finns **ingen GitHub inblandad**. Därför ser du inga repon på det kopplade GitHub-kontot — systemet skapar aldrig några.

Flödet är:

```text
scrape (Firecrawl) -> generate (AI, HTML/CSS sparas i databasen)
   -> deploy-site: POST https://api.vercel.com/v13/deployments
      med filerna inline (index.html, style.css ...)
   -> demo_site_url sparas på generated_sites + site_leads
```

`deploy-site` skickar alltså filerna direkt till Vercels API som en statisk deploy. Kolumnen `github_repo_url` finns i databasen men används inte.

## Varför vissa länkar ger 404 DEPLOYMENT_NOT_FOUND

Verifierat mot databasen och live-länkarna:

- 156 sajter har status `live`. Stickprov: de flesta svarar 200, men t.ex.
  `https://demo-bost-elektro-solceller-elinstallation-projekt.vercel.app`
  svarar 404 DEPLOYMENT_NOT_FOUND.
- Orsak: `deploy-site` **gissar** adressen. Den bygger strängen
  `https://<projektnamn>.vercel.app` själv (rad 118-120) istället för att läsa
  den riktiga aliasen från Vercels svar. Om Vercel inte ger projektet exakt det
  namnet — globalt upptaget namn, för långt namn, eller projektet hamnar under
  team-scope (`...-foremp.vercel.app`) — pekar den sparade länken på en domän
  som inte finns. Sajten är deployad, men länken i mailet är fel.
- Ingen verifiering görs: status sätts till `live` utan att någon kontrollerat
  att URL:en faktiskt svarar 200.
- Fallback-logiken körs bara på HTTP 409/403. Alias-krockar syns inte där.

Separat, för de sajter som aldrig blir klara alls (46 st `failed`):
- 34 st: "Worker died mid-generation (>10 min)" — genereringen dör, inte deployen.
- 7 st: "Root page failed on all variants" (Firecrawl klarar inte källsajten, ofta Facebook-sidor).

## Vad som ska göras

### 1. Sluta gissa URL:en (huvudfixen)
I `supabase/functions/deploy-site/index.ts`:
- Läs den faktiska produktionsaliasen från Vercels API istället för att bygga
  strängen: efter deploy, hämta `GET /v9/projects/<projectId>/domains` (eller
  `alias`-fältet på deployment) och välj den kortaste `.vercel.app`-domänen som
  Vercel faktiskt tilldelat.
- Sätt alltid en aliaskandidat explicit via `POST /v2/deployments/<id>/aliases`
  när önskat namn är ledigt, så vi får den snygga `demo-<företag>`-adressen på
  riktigt istället för av en slump.
- Fall tillbaka till deployment-URL:en (`deployData.url`) om inget alias går att
  bekräfta — hellre ful länk som funkar än snygg länk som 404:ar.

### 2. Verifiera innan status blir `live`
- Gör en `HEAD`/`GET` mot den valda URL:en (med kort retry, deployen behöver
  några sekunder). Endast 200 → `status='live'`.
- Annars: prova nästa kandidat, och om ingen svarar → `status='failed'` med
  tydligt felmeddelande, så leaden inte går vidare till mailutskick med en död
  länk.

### 3. Kortare, säkrare projektnamn
- Korta företagsslugen till ~30 tecken (idag 45/52) och lägg alltid på ett kort
  unikt suffix vid krock. Det minskar risken för globala namnkrockar och för
  långa värdnamn.

### 4. Städa befintliga döda länkar
- Engångsjobb: gå igenom alla `generated_sites` med `status='live'`, pinga
  `demo_site_url`, och för de som inte svarar 200 — hämta rätt alias från Vercel
  och uppdatera både `generated_sites.demo_site_url` och `site_leads.demo_url`.
  Går inte det: markera för omdeploy.
- Viktigt eftersom redan skickade mail kan innehålla trasiga länkar; de som
  ligger i kö får rätt länk efter städningen.

### 5. Minska "Worker died mid-generation"
- Separat och mindre akut, men de 34 misslyckade beror på att genereringen
  timeoutar. Förslag: låt watchdogen automatiskt köa om dem en gång istället för
  att kräva manuell "Generate"-klick.

## Teknisk sammanfattning
Filer som berörs: `supabase/functions/deploy-site/index.ts` (alias-hämtning,
verifiering, namnlängd), `supabase/functions/process-site-leads/index.ts`
(hantera nytt `failed`-läge från deploy), samt ett engångs-städjobb mot Vercel
API + databasen. Inga ändringar i mailinnehåll eller sekvenslogik.
