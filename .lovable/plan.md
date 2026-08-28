# Öppningsspårningen är död — orsak och fix

## Vad jag mätte

- Öppningar per dag i databasen: 17–18 aug fungerade (11 och 15 öppningar). Från **19 aug till 27 aug har inte ett enda mail haft spårning påslagen** (`tracking_enabled = false` på alla 334 mail) — det var följdbuggen som gjorde att varje mail såg ut som ett första mail (första mail skickas medvetet utan pixel).
- I dag: 49 mail har spårning påslagen — men **0 öppningar**.
- Orsaken till dagens nollor: spårningsvärdarna finns inte i DNS. Jag slog upp dem:
  - `t.botlio.email` → NXDOMAIN
  - `t.foremp.email`, `t.foremp.eu`, `t.foremp.one`, `t.botlio.eu` → ingen A/CNAME-post
  - HTTP-anrop mot alla fem → ingen anslutning alls
- Supabase-fallbacken fungerar däremot: `.../track-open/o/<id>.gif` svarar `200 image/gif`.

Så pixeln pekar sedan i dag på `https://t.<domän>/o/<id>.gif`, en adress som inte finns. Mailklienten kan aldrig hämta bilden, och ingen öppning registreras. UI:t visar "Verified" eftersom det bara frågar Vercel om domänen är tillagd i projektet — det kontrollerar aldrig att CNAME faktiskt finns i DNS eller att pixeln svarar.

## Fix

1. **Återställ spårningen direkt:** nolla `tracking_host` på de fem domänerna så pixeln faller tillbaka till Supabase-URL:en som bevisligen svarar. Öppningar börjar registreras vid nästa utskick.
2. **Gör värden hälsokontrollerad, inte bara "tillagd i Vercel":** lägg till `tracking_host_verified_at` på `sending_domains`. `setup-tracking-proxy` gör ett riktigt HTTP-anrop mot `https://t.<domän>/o/<test-id>.gif` och stämplar tiden bara om svaret är `200` med `image/gif`. Misslyckas det visas "DNS saknas" i UI:t i stället för "Verified".
3. **Säker pixelväljare i `send-cold-email`:** använd `tracking_host` endast när `tracking_host_verified_at` är satt och nyare än 7 dygn — annars Supabase-URL:en. Då kan en trasig DNS-post aldrig igen tysta all spårning.
4. **Automatisk återkontroll:** låt `setup-tracking-proxy` kunna köras av cron en gång per dygn och uppdatera stämpeln, så en värd som slutar svara plockas ned automatiskt.
5. **DNS-instruktioner i Domains-vyn per domän:** `foremp.email`, `botlio.email` och `botlio.eu` ligger på Cloudflare (lägg CNAME `t` → `cname.vercel-dns.com`, DNS only / grå molnikon). `foremp.eu` och `foremp.one` ligger på one.com. Vyn visar i dag samma text för alla och säger "Verified" utan täckning.
6. **Analysen:** i statistiken räknas öppningsgrad bara på mail där `tracking_enabled = true`, så perioden 19–27 aug ska visas som "ej spårad" i stället för 0 % öppet.

## Efter fixen
Spårningen fungerar omedelbart via Supabase-värden. Vill du ha egen värd på `t.<domän>` (bättre för leveransen, eftersom bildvärden matchar avsändardomänen) lägger du in CNAME-posterna och kör "Set up tracking host automatically" igen — då stämplas de som verifierade först när pixeln faktiskt svarar, och systemet byter över av sig självt.

## Verifiering
Efter ändringen: skicka ett uppföljningsmail, hämta pixel-URL:en från `sent_emails.body`, anropa den och kontrollera att `opened_at` och `open_count` sätts på raden.
