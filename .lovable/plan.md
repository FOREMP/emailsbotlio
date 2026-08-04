# Kökontroll + separat kvot för uppföljningsmail

## Vad jag hittade i datan

**1. "Väntar kapacitet" gick 28 → 34: inget fel, men missvisande**

Site Demo Outreach har just nu 48 aktiva och 34 i `waiting_capacity`. Alla 34 har `last_sent_at = null` (aldrig fått mail) och felmeddelandet "all eligible senders at daily cap".

Anledningen till att siffran steg trots 16 utskick: nya enrollments tillkom när fler demosidor blev klara — 11 skapade 3 aug och 11 skapade 4 aug. Alltså 28 − 16 + 22 = 34. Kön räknar alltså rätt, men UI:t visar bara en klumpsumma så det ser ut som att inget lämnade kön.

**2. Uppföljningar delar samma kvot som nya mail — det är ett verkligt problem**

- Sekvensen skickar bara från `foremp.email` (`sender_domain` på alla send-noder).
- `eric@foremp.email` och `isak@foremp.email` har `daily_limit = 8` var → 16 platser/dygn.
- Databasfunktionen `sender_daily_remaining` räknar **alla** mail från avsändaren idag, oavsett om det är förstamail eller uppföljning.
- Throttle-noden har `max_per_day = 16`, dvs samma tak.

Resultat: 3 aug och 4 aug skickades 16 mail per dag, alla förstamail, noll uppföljningar. Så fort de 48 aktiva trådarna blir förfallna (5–7 aug) kommer uppföljningar och nya mail att slåss om samma 16 platser, och totalen kan aldrig överstiga 16/dag.

## Vad som ska byggas

### A. Separat uppföljningskvot (3× avsändarens dagsgräns)

Ny logik: förstamail räknas mot `daily_limit`, uppföljningar mot `daily_limit × followup_multiplier` (default 3). Med 8/dag betyder det 8 nya + 24 uppföljningar per avsändare, 16 nya + 48 uppföljningar på domänen.

- Migration: lägg till `senders.followup_multiplier integer not null default 3`.
- Migration: ny funktion `sender_capacity_remaining(_sender_id uuid, _is_followup boolean)` som delar dagens utskick i förstamail (första `sent_emails`-raden per enrollment) och uppföljningar, och returnerar rätt återstående kvot. `sender_daily_remaining` behålls för bakåtkompatibilitet men blir ett anrop till den nya med `false`.
- `run-sequences`: avgör tidigt om enrollment är uppföljning (`last_sent_at is not null`) och använd `sender_capacity_remaining` i både sticky-sender-kontrollen och rotationen.
- Domäntaket `PER_DOMAIN_DAILY_CAP` höjs från 80 till ett beräknat tak (summa av avsändarnas nya + uppföljningskvot på domänen) så det inte blir den nya flaskhalsen.
- Throttle-noden (`max_per_day = 16`) rör vi inte — den gäller redan bara förstamail.

### B. Tydligare kö-UI på /site-outreach

- Dela upp "Väntar kapacitet" i **Väntar på första mail** och **Väntar på uppföljning**.
- Lägg till dagens siffror uppdelat: *nya skickade i dag X/16* och *uppföljningar i dag Y/48*.
- Visa antal enrollments som tillkommit senaste 24h, så en växande kö går att förklara direkt.

### C. Avsändarinställning i UI

- På /senders: fält för uppföljningsmultiplikator per avsändare (default 3), med hjälptext "8 nya + 24 uppföljningar per dag".

## Teknisk sammanfattning

| Fil | Ändring |
| --- | --- |
| migration | `followup_multiplier`-kolumn + `sender_capacity_remaining()` |
| `supabase/functions/run-sequences/index.ts` | följ-upp-flagga före avsändarval, ny RPC, dynamiskt domäntak |
| `src/pages/SiteOutreach.tsx` | uppdelade köräknare + dagens nya/uppföljningar |
| `src/pages/Senders.tsx` | fält för uppföljningsmultiplikator |

Inget i cold-mail-innehållet, mallarna eller sidgeneratorn ändras.
