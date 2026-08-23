# Höj avsändarvolymen + lägg till foremp.one på engelska

## Vad datan visar (senaste 21 dagarna)

| Avsändare | Domän | Först skickat | Toppdag | Bounces | Klagomål | Öppningar |
| --- | --- | --- | --- | --- | --- | --- |
| eric@foremp.email | foremp.email | 3 aug | 32 | 0 | 0 | ~45 % |
| isak@foremp.email | foremp.email | 3 aug | 28 | 0 | 0 | ~50 % |
| eric@foremp.eu | foremp.eu | 17 aug | 6 | 0 | 0 | ~60 % |
| isak@foremp.eu | foremp.eu | 17 aug | 3 | 0 | 0 | ~33 % |

Noll bounces, noll klagomål, hög öppningsgrad på båda domänerna. foremp.email har tre veckors historik, foremp.eu knappt en vecka.

Nuvarande inställningar: foremp.email 8 nya/dag/avsändare, foremp.eu 3 nya/dag/avsändare, uppföljningsmultiplikator 3× överallt. Throttle-noden är 16/dag på svenska sekvensen och 6/dag på engelska — dvs exakt 2 × dagsgränsen, så throttlen måste höjas i takt med avsändarna.

`foremp.one` är verifierad och aktiv men har aldrig skickat ett mail. Dess två avsändare finns redan men står som svenska med 25/dag — de ska ställas om till engelska och startas lågt.

## Plan

### 1. Höj foremp.email (svensk outreach)

Trappa i två steg, en vecka mellan:

- Nu: 8 → **12** nya/dag/avsändare (24 nya + 72 uppföljningar på domänen)
- Om ~7 dagar utan bounces/klagomål: 12 → **15** (30 nya + 90 uppföljningar)

Throttle-noden på "Site Demo Outreach" höjs 16 → **24** nu, och till 30 i steg två.

### 2. Höj foremp.eu (engelsk outreach)

Bara en vecka gammal, så mindre steg:

- Nu: 3 → **5** nya/dag/avsändare
- Om ~7 dagar: 5 → **8**

Throttle-noden på "Site Demo Outreach EN" höjs 6 → **10** nu (och 16 i steg två, när foremp.one också är uppvärmd).

### 3. Lägg till foremp.one som andra engelsk domän

- Ställ om `eric@foremp.one` och `isak@foremp.one` till `language = 'en'`, `daily_limit = 3`, uppvärmning påslagen med start idag och mål 15.
- Uppvärmningskurvan i databasen ger dag 1 = 5, vilket är högre än önskade 3. Därför sätts `daily_limit = 3` som hårt tak de första dagarna — funktionen tar alltid det lägsta av dagsgräns och uppvärmningsramp, så resultatet blir 3/dag/avsändare. Efter ~5 dagar höjs `daily_limit` manuellt och rampen tar över.
- Uppföljningar följer samma 3×-regel, alltså 9/dag/avsändare.

### 4. Låt engelska sekvensen använda båda domänerna

Sekvensnoderna har idag `sender_domain: "foremp.eu"` — ett enda domännamn, så foremp.one skulle aldrig väljas. Det behöver bli en lista:

- `run-sequences` uppdateras så `sender_domain` accepterar antingen en sträng eller flera domäner separerade med komma, både i sticky-sender-kontrollen och i rotationsfiltret.
- De fyra send-noderna i "Site Demo Outreach EN" sätts till `foremp.eu,foremp.one`.
- Node-inspektorn i sekvenskanvasen får en hjälptext om att flera domäner kan anges kommaseparerat.

Rotationen väljer sedan den avsändare som har mest kvot kvar, så foremp.one får sin lilla andel utan att foremp.eu bromsas.

### 5. Kapacitet efter steg 1

| Sekvens | Nya/dag | Uppföljningar/dag |
| --- | --- | --- |
| Svensk (foremp.email) | 24 | 72 |
| Engelsk (foremp.eu + foremp.one) | 16 | 48 |

Domäntaket i koden (`PER_DOMAIN_DAILY_CAP`, 80) räknas redan dynamiskt från avsändarnas kvoter, så det behöver inte röras.

## Teknisk sammanfattning

| Var | Ändring |
| --- | --- |
| `senders` (data) | foremp.email → 12; foremp.eu → 5; foremp.one → language `en`, limit 3, warmup på |
| `sequence_nodes` (data) | throttle SV 16→24, EN 6→10; EN send-noder `sender_domain` → `foremp.eu,foremp.one` |
| `supabase/functions/run-sequences/index.ts` | `sender_domain` tolkas som kommaseparerad lista |
| `src/components/sequence-canvas/NodeInspector.tsx` | hjälptext för flera domäner |

Inget i mailinnehåll, prompter eller sidgenerering ändras.
