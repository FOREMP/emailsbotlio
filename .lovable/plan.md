# Dagsgränsen för nya mail följs inte — orsak och fix

UI:t har rätt. Jag räknade i databasen: i dag (Stockholm-tid) har den engelska demo-sekvensen skickat **16 första mail** trots gränsen 10, och den svenska har skickat **1 första mail** trots gränsen 24 (27 kontakter står och väntar). Det är alltså backend, inte statistiken.

## Vad som faktiskt är fel

**1. Throttle-räknaren matchar noll rader — taket slår aldrig till.**
`run-sequences` räknar dagens första mail i `contact_activity` med filtret `metadata->>is_followup = 'false'`. Kontroll av verkliga rader: **inget** `email_sent`-event har fältet `is_followup` alls (bara `sender_id`, `from`, `subject`, `message_id`, `throttle_node_id`). Filtret ger därför alltid 0 av 10, och sekvensgränsen blockerar aldrig. Det som i praktiken styr volymen är i stället summan av sendernas `daily_limit`: 5+5+3+3 = 16 — exakt de 16 mail som gick ut.

**2. `throttle_node_id` sätts nästan aldrig.**
Av dagens 107 send-events har **ett enda** ett `throttle_node_id`. Id:t skickas vidare via `enrollments.last_error` med prefixet `__pending_throttle:`, men samma fält skrivs över av pacing- och statusmeddelanden ("paced: waiting 12 min…") innan mailet går. Även om punkt 1 fixas skulle räkningen fortsätta missa nästan allt.

**3. Svenska sidan svälts av pacing.**
Alla 27 svenska förstamail står med `last_error: "paced: waiting 10–16 min before next send from this sender"`. Pacing använder **en gemensam klocka per sender** för både förstamail och uppföljningar. Med 42 uppföljningar i dag nollställs klockan hela tiden, så förstamailen får aldrig sin lucka — därav 1 av 24.

**4. Spara-knappen för dagsgränsen träffar fel senders.**
`saveDailyLimit` i `SiteOutreach.tsx` skriver ut gränsen på *alla* aktiva senders med samma språk. Botlio-sendrarna (US Website Offer) är också `language = 'en'`, så en ändring av den engelska demo-gränsen skriver om US-sekvensens senders.

## Fix

1. Räkna dagens förstamail från `sent_emails` i stället för `contact_activity`-metadata: mail i dag (Stockholm) kopplade till enrollments i sekvensen, där enrollmentet inte har någon tidigare send. Det är samma logik som `sender_capacity_remaining` redan använder och är oberoende av metadata som kanske saknas.
2. Ta bort beroendet av `metadata.is_followup` / `throttle_node_id` i både throttle-noden och den globala sekvensgränsen i `run-sequences`. Sluta använda `last_error` som bärare av throttle-id.
3. Fortsätt ändå stämpla `is_followup` och `budget_kind` i `send-cold-email` för statistik, men låt inget tak vara beroende av det.
4. Dela pacing-klockan per sender **och** typ (förstamail vs uppföljning), så uppföljningar inte äter förstamailens luckor. Räkna även spacing mot rätt kvot för respektive typ.
5. Justera `saveDailyLimit` så den bara uppdaterar senders som ingår i den aktuella sekvensens rotation (foremp.email för svenska, foremp.eu/foremp.one för engelska) — aldrig botlio-sendrarna.
6. Låt UI:t räkna dygnet i Stockholm-tid i stället för webbläsarens lokala midnatt, så siffran matchar backend exakt.

## Verifiering
Kör `run-sequences` efter fixen och kontrollera i databasen att antalet förstamail per sekvens i dag stannar på taket (10 EN / 24 SV), att svenska förstamail börjar gå ut igen, och att uppföljningarna fortsätter ovanpå gränsen.
