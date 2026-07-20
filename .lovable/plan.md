
# Site Outreach Email Sequence — Plan

Målet: när du godkänner en demo i `/site-approvals`, ska leaden automatiskt enrollas i en dedikerad **Site Demo-sekvens** som skickar 4 skräddarsydda svenska mail från `foremp.email`-inboxes (2 st × 8/dag = **16 sends/dag totalt**), alla med `demo_url` inbäddad, alla genererade av `gpt-4.1-mini`.

---

## 1. Navigation: samla under "Websites"

Nuvarande tre tabbar (`Sites`, `Site Leads`, `Approvals`) tar för mycket plats. Ny struktur i `AppLayout`:

```
Dashboard · Sequences · Analytics · Contacts · Websites ▾ · Senders · Domains · Files
                                                │
                                                ├─ Leads          (/site-leads)
                                                ├─ Approvals      (/site-approvals)
                                                ├─ Generator      (/sites)          ← nuvarande "Sites"
                                                └─ Demo Outreach  (/site-outreach)  ← NY
```

En hover/klick-dropdown i `AppLayout.tsx`. Sub-tabbaren är aktiv för alla `/site*`- och `/sites`-rutter.

---

## 2. Ny sida `/site-outreach`

En sida — inte en full sequence-canvas — som styr hela demo-utskicket. Tre paneler:

**A. Kön & status** (topp)
- Kort: "Godkända idag", "I sekvens", "Skickat idag / 16", "Svarat / Positiva".
- Lista över alla leads i sekvensen med kolumner: företag, mail, senaste steg (1–4), nästa sändning, senast öppnad, svarstatus.
- **Per rad: knapp "Ta ut ur sekvens"** (svarade positivt / vill inte / stängde deal). Sätter `enrollment.status = 'stopped'` + loggar reason.

**B. Senaste 5 skickade mail** (mitten)
- Läser `sent_emails` (join `site_leads`) för sekvensen, senaste 5. Visar mottagare, ämne, body-preview, skickat-tid, open-status. För stickprov.

**C. Prompt-editor** (botten, collapsed)
- 4 kort (steg 1–4). Varje kort visar `subject_prompt` + `body_prompt` + `wait_days`, redigerbart. Sparas till `sequence_nodes.config`. Du kan finjustera copy utan att röra koden.
- "Återställ till standard" per steg.

---

## 3. Sekvens-struktur (4 mail, foremp.email)

Seed:as via migration som en `sequences`-rad + noder + edges, samma schema som befintliga sekvenser (återanvänder `run-sequences`, `send-cold-email`, `generate-email`, open-tracking, unsubscribe, reply-detection).

Utskicksbudget: **16/dag** via en `throttle`-nod (`max_per_day: 16`) direkt efter trigger. Kompletterar sender-kvoter (2 senders × 8 = 16), så ingen inbox överskrids.

| Steg | Wait | Ämne (prompt) | Body (prompt-kärna) | Pris nämnt? |
|---|---|---|---|---|
| 1 | 0 (direkt vid enroll) | "Skriv en SVENSK ämnesrad, max 55 tecken. Kärna: 'Vi har redan byggt en DEMO-hemsida åt {{company_name}} — kika här'. Ska kännas som att sitan finns nu, inte som ett förslag. Ingen clickbait, inga emojis." | ~70–90 ord. Öppning kopplar till **en konkret svaghet från `{{audit_weakness}}`**. Säger att vi **byggt en demo** för {{company_name}}, länk: {{demo_url}}. Betonar "detta är bara en DEMO — allt (färg, text, bilder, sektioner) kan ändras kostnadsfritt innan lansering". CTA: "Klicka och säg vad du vill ändra". | Nej |
| 2 | +2 dagar | "SVENSK ämnesrad, max 55 tecken. Kort follow-up. Antyd att demon fortfarande ligger uppe." | ~60 ord. "Hann du kika?" + länk igen. **Nämner värdet**: en bra hemsida = fler bokningar/kunder, 1–2 meningar om varför moderna hemsidor konverterar bättre. Fortfarande inget pris. | Nej |
| 3 | +3 dagar | "SVENSK ämnesrad, max 55 tecken. Antyd konkret erbjudande utan att sälja hårt." | ~80 ord. **Priset kommer här**: "5 000 kr engångskostnad + 1 000 kr/år för drift & hosting. Lanserad inom några dagar. Vill du ha något mer avancerat bygger vi det inom en vecka." Länk till demo. Kort värde-mening ("investering som betalar sig på första nya kunden"). | **Ja (5000 + 1000/år)** |
| 4 | +4 dagar | "SVENSK ämnesrad, max 55 tecken. Möte/beslut-ton, mjuk. Ex: 'Sista pushen — {{company_name}}'." | ~60 ord. Sista touch. "Vill du att vi lanserar demon som den är, justerar den, eller lägger ner?" Enkel ja/nej/mer-info-ask. Länk sista gången. | Ja (kort påminnelse) |

Totalt fönster: **9 dagar**. Efter steg 4 → `end`-nod, enrollment `completed`.

**Prisresearch:** svenska AI-genererade småföretags-hemsidor ligger typiskt 4 900–9 900 kr engångs + 99–299 kr/mån hosting. **5000 + 1000/år är i underkant men rimligt** och lätt att stänga på — bra för volym. Vi behåller det som standard i prompten.

**Reply-detection**: befintlig logik pausar sekvensen automatiskt vid svar (redan implementerat). Din manuella "Ta ut ur sekvens"-knapp är backup för svar via telefon.

---

## 4. Variabler tillgängliga i alla prompts

När `run-sequences` bygger `contact`-objektet för en site-lead-enrollment, ska den *också* hämta `site_leads`-raden och slå ihop dessa fält till `custom_fields` så prompten kan referera:

- `{{company_name}}` — firmanamn
- `{{demo_url}}` — Vercel-länken (bäddas in i mail-body som riktig `<a>` i send-cold-email, samma som befintliga länkar)
- `{{website}}` — deras gamla sida (för referens i copy)
- `{{audit_weakness}}` — första strängen från `audit_details.weaknesses` (t.ex. "hemsidan är från 2011 och inte mobilanpassad")
- `{{audit_score}}` — betyg, för nyansering
- `{{category}}` — bransch (bilverkstad, frisör, etc.)
- `{{first_name}}` — parsas från email lokal-del om saknas

---

## 5. Enrollment-flöde

När du klickar "Godkänn" i `/site-approvals`:

1. Site-lead sätts `status='approved'`.
2. **Ny steg**: skapa/uppdatera en `contacts`-rad (list: "Site Demo Outreach") med email + custom_fields innehållande site-lead-datat ovan.
3. Enrollera kontakten i den seedade Site Demo-sekvensen (befintlig `enroll-contacts`-logik).
4. `run-sequences` plockar upp den vid nästa tick, skickar mail 1 direkt.

Om leaden regenereras eller nekas efter approval → `enrollment.status='stopped'` sätts automatiskt.

---

## 6. Sender-hygien

- Verifiera att **exakt 2 aktiva senders finns på `@foremp.email`** (t.ex. `eric@foremp.email`, `isak@foremp.email`), var med `daily_limit=8`, warmup av.
- Botlio-senders ska INTE plocka demo-mail. Lösning: sekvensen får ett fält `sender_brand='foremp'` i `sequences.config`, och `send-cold-email` filtrerar poolen på brand (finns redan i koden — bara att sätta värdet vid seed).

---

## 7. Förväntat resultat på 100 kontakter

Realistiska svenska cold-email-benchmark för välriktade demos + gratis-arbete-hook:

| Metric | Range | Kommentar |
|---|---|---|
| Delivery | 96–99% | foremp.email är varmt, låg spamrisk |
| Open rate (steg 1) | 55–70% | Ämnesrad "vi har byggt en demo åt dig" är hög-nyfikenhet |
| Klick på demo-länk | 25–40% | Ovanligt högt — personlig demo triggar klick |
| Svar (alla steg) | 8–15% | 8–15 av 100 svarar något |
| Positiva svar / bokningar | 4–8% | 4–8 seriösa intresserade |
| **Betalande kunder** | **2–5%** | **2–5 av 100 = 10–25k intäkt på 9 dagar** |

Att förvänta sig: **~3 kunder** som bas-case från 100 kontakter, upside ~5 om demos är genuint bättre än deras nuvarande sidor (vilket audit-filtret säkerställer eftersom vi bara mailar folk med `audit_score < 7`).

---

## 8. Byggordning (efter godkännande)

1. Migration: seeda `sequences` + 6 `sequence_nodes` (trigger → throttle → send1 → wait → send2 → wait → send3 → wait → send4 → end) + edges + "Site Demo Outreach"-contact-list. Prompts som JSON i `node.config`.
2. `AppLayout.tsx`: gruppera 4 tabbar under "Websites"-dropdown.
3. Uppdatera `/site-approvals` approve-handler: skapa/uppdatera contact + enrollera.
4. Uppdatera `run-sequences` context-bygge: om enrollment-kontakten har `custom_fields.site_lead_id`, hydrera `demo_url`, `audit_weakness` etc. från `site_leads`.
5. Bygg `/site-outreach`-sidan (kö + senaste 5 + prompt-editor + stop-knapp).
6. Bekräfta 2 foremp-senders + brand-filter, testkör en enrollment mot dig själv.

---

## Teknik-appendix

- **Sender-filter:** `sequences.config.sender_brand = 'foremp'` läses i `send-cold-email` (finns redan i `brand`-logik, rad ~143).
- **Länkar:** `send-cold-email` konverterar `{{demo_url}}` till klickbar `<a>` — verifiera att URL:er inte redan wrappas av link-tracking (om ja, whitelista Vercel-domäner för att inte skada CTR-mätning).
- **Prompt-editor persistens:** samma pattern som `SequenceCanvas` — `sequence_nodes.config` JSONB.
- **Stop-knapp:** UPDATE `enrollments SET status='stopped', stopped_reason='manual'` där `id=?`.
- **"Senaste 5":** `select from sent_emails where sequence_id=? order by sent_at desc limit 5`.
- **Ingen ny AI-modell:** allt kör `gpt-4.1-mini` via befintlig `generate-email` (subject_prompt + prompt).
- **Ingen ny throughput-risk:** 16 mail/dag = försumbar IO vs nuvarande cold-flöde.

Säg klart så bygger jag i ordningen ovan.
