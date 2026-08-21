# Automatisk tracking-host via edge function

Målet: du ska slippa bygga något manuellt i Vercel. En ny edge function sätter upp en liten proxy-sajt på Vercel som vidarebefordrar `t.<domän>/o/<id>.gif` till `track-open`, kopplar subdomänen, och skriver in `tracking_host` i databasen. Det enda du gör själv är att klistra in en CNAME-rad per domän hos din DNS-leverantör.

## Vad som byggs

**Ny edge function: `setup-tracking-proxy`**

1. Hämtar alla aktiva + verifierade rader i `sending_domains`.
2. Skapar (en gång) ett Vercel-projekt `foremp-tracking` och deployar en minimal statisk sajt vars `vercel.json` innehåller en rewrite:
   - `/o/:file` → `https://<supabase>/functions/v1/track-open/o/:file`
   - `/*` → samma funktion (fallback)
   Deployen görs med samma v13-inline-files-mönster och `VERCEL_TEAM_ID`-scoping som `deploy-site` redan använder.
3. För varje domän: lägger till `t.<domän>` som domän på projektet via Vercel Domains-API och läser ut verifieringsstatus.
4. Skriver `tracking_host = https://t.<domän>` i `sending_domains` — men bara när Vercel rapporterar domänen som verifierad, så att en okopplad subdomän aldrig kan bryta pixeln.
5. Returnerar en lista per domän: `{ domain, tracking_host, verified, dns: { type: "CNAME", name: "t", value: "cname.vercel-dns.com" } }`.

**UI i `src/pages/Domains.tsx`**

- Knapp "Sätt upp tracking-host automatiskt" som anropar funktionen.
- Resultatet visas i en liten tabell med exakt DNS-rad att klistra in, samt status (Verifierad / Väntar på DNS).
- Funktionen är idempotent: kör den igen efter att DNS spridit sig så fylls `tracking_host` i automatiskt.

## Säkerhet och robusthet

- Funktionen kräver inloggad användare (JWT valideras i koden) — den skriver till `sending_domains` med service role.
- `send-cold-email` ändras inte: den läser redan `tracking_host` och faller tillbaka på Supabase-URL:en när den är tom. Så inget mail slutar fungera under tiden DNS pekas om.
- `track-open` ändras inte — den accepterar redan `/o/<id>.gif`.
- Inget rör cold email-prompts, sekvenser eller sajtgenerering.

## Vad du gör manuellt (en gång per domän)

Lägg till hos DNS-leverantören:

```text
Typ: CNAME   Namn: t   Värde: cname.vercel-dns.com
```

Sedan trycker du på knappen igen så markeras domänen som klar.

## Kostnad

En edge function + en liten UI-sektion. Inga AI-anrop, inga extra kostnader per mail.
