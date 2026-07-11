
## Plan: städa upp + aktivera för imorgon

### 1. Fixa import-dedupen (`src/pages/Contacts.tsx`)
- Normalisera email: trim, ta bort `%20`-prefix, lowercase — **spara normaliserat värde i DB**, inte råvärdet.
- Splitta celler med `,` eller `;` till separata kontakter.
- Skippa rader helt utan email (**inte** spara som junk).
- Validera format (måste matcha `x@y.z`) — annars räknas som "invalid".
- Byt case-sensitive `.in("email", chunk)` → hämta alla befintliga emails i listan en gång, jämför i JS-Set med lowercase.
- Toast: `Imported X · Y duplicates · Z invalid · W without email`.

### 2. SQL-städning av Agency London 2 (migration)
- Radera **992 rader utan email**.
- Trimma + lowercase alla emails i listan.
- Radera dubletter (behåll äldsta `created_at` per email).
- Radera rader vars email finns i `suppressed_emails` eller `do_not_contact` för din user.
- Förväntat resultat: **~690 rena kontakter** kvar.

### 3. Auto-enrolla nya kontakter i "Agency outreach"
Direkt i samma migration, insert av `enrollments` för alla kontakter i listan som:
- inte redan är enrollade i sekvensen
- inte finns i `sent_emails` (cross-sequence-dedupe, samma regel som edge-funktionen)
- inte finns i DNC/suppressed

Enrollment sätts på entry-noden (`63beb24f-...`, schedule) med `status='active'` och `next_send_at=now()` — samma fält som `enroll-contacts`-funktionen använder. Efter migration är sekvensen "redo för imorgon" utan att du behöver klicka något.

### 4. Runway-uppskattning
Din nuvarande aktiva kapacitet: **10 inboxes, ~216 sends/dag** (8×25 + 2×8).

Sekvensen har **2 emails** (initial + follow-up), så varje kontakt kostar ~2 sends totalt.

| Nytt i listan efter städning | ~600 fräscha kontakter (efter DNC/redan-mailade-skip) |
|---|---|
| Totalt sends att skicka | ~1 200 (600 × 2) |
| Vid full kapacitet 216/dag | **~5–6 dagar** |
| Vid realistiskt utnyttjande ~150/dag (schedule-nod gating, helger) | **~8 dagar** |

Follow-up:en skickas efter den `wait`-nod-fördröjning sekvensen har konfigurerad, så andra vågen börjar hamna i kö några dagar efter första vågen — sammanlagt ~1,5–2 veckors körning innan listan är helt tömd.

### Ingen ny sekvens-logik ändras
Endast import-flödet och engångsstädning + engångsenrollment. Send-loopen, sender-rotation och follow-up-timing rörs inte.

Godkänn så kör jag alla tre stegen i samma sväng.
