# Alla demolänkar visar samma sajt (Ekorre-Hem) — orsak och fix

## Vad som faktiskt hänt

Sajterna **byggs korrekt**. Jag kontrollerade innehållet i databasen: varje genererad sajt har eget, korrekt material från just det företagets skrapade hemsida — t.ex. "Grahn's Elektriska AB – Elinstallationer", "Elteam Syd i Lund AB", "Ingenjörsbyrån i HBG". Firecrawl-datan (`source_url_used`, sidtitlar, texter) skiljer sig per lead. Ingen regenerering behövs för att fixa innehållet.

Problemet ligger i **publiceringen**. 27 sajter har exakt samma `demo_site_url`:
`https://demo-byggpartner-i-ska-ne-foremp.vercel.app`

Den adressen är produktionsdomänen för det **delade Vercel-projektet** som infördes när vi löste felet "too_many_projects". Varje ny sajt deployas som *production* i samma projekt, vilket flyttar den delade domänen till senaste deployen. Alla 27 länkar pekar därför på den sist publicerade sajten — just nu Ekorre-Hem.

Två fel i `deploy-site` samverkar:

1. Den läsbara aliasen (`demo-<företag>.vercel.app`) kan inte sättas, eftersom en `.vercel.app`-subdomän måste tillhöra projektet innan den kan aliasas — anropet misslyckas tyst.
2. När aliasen misslyckas väljs nästa kandidat: projektets egna domäner. Det är den delade produktionsdomänen — samma för alla. Den unika deploy-URL:en, som varje sajt redan har sparad i `vercel_deployment_url`, hamnar sist och används aldrig.

## Fix

### 1. Sluta publicera till delad produktionsdomän
Deploya i det delade projektet utan `target: 'production'`. Varje deploy får då en egen, permanent URL (`<projekt>-<hash>-foremp.vercel.app`) och den delade domänen slutar flyttas runt.

### 2. Välj alltid en sajtunik URL
Ändra kandidatordningen i `deploy-site`:
- Först: eget alias, men bara om det verkligen registrerades (lägg till domänen på projektet först, verifiera svaret, annars hoppa över).
- Sedan: den unika deploy-URL:en från Vercel.
- Projektets delade domäner tas **bort** ur kandidatlistan helt — de kan aldrig identifiera en enskild sajt.

Samma regel i den befintliga "reparera trasiga länkar"-rutinen, som idag kan skriva tillbaka den delade domänen på sajter som fungerar.

### 3. Laga de 27 befintliga länkarna
Alla 27 har redan en sparad unik `vercel_deployment_url`. Ett engångsjobb sätter `demo_site_url` (och `site_leads.demo_url`) till den unika URL:en, verifierar att varje adress svarar 200, och markerar de som inte svarar för omdeploy. Ingen ny AI-generering behövs.

### 4. Kontroll av redan utskickade mail
Mail som gått ut med den delade länken har pekat på fel företags sajt. Efter fix nummer 3 pekar samma databaspost på rätt sajt, så länkar i redan skickade mail som läser demo-URL:en dynamiskt blir rätt; de som skickats med hårdkodad text listas så du kan avgöra om de leadsen ska kontaktas igen.

## Verifiering
Öppna 5 slumpade demolänkar från godkännandevyn och bekräfta att varje visar rätt företagsnamn, färger och tjänster. Deploya sedan en ny sajt och kontrollera att dess URL är unik och att inga tidigare länkar ändras.

## Tekniska noteringar
Ändringar enbart i `supabase/functions/deploy-site/index.ts` (deploy-anrop utan production-target, ny kandidatordning, alias endast efter lyckad domänregistrering, `projectDomains` borttagen ur urvalet) plus ett engångs-backfill-anrop mot `generated_sites` och `site_leads`. Ingen ändring i generator, Firecrawl-skrapning, nischlogik eller e-postsekvenser.
