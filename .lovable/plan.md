
# Site Outreach Pipeline — Plan

Målet: ladda upp en Google-skrapad lista (500+ företag), systemet väljer vilka som får en demo-hemsida, du godkänner i UI, och godkända demos triggar en 4-mails sekvens från `foremp.email` — allt strypt till 20 mails/dag utan att spränga Supabase IO.

---

## 1. Import & företagsfiltrering

**Ny sida `/site-leads`** (eller flik under Contacts) med CSV/XLSX-upload.

Deepseek V3.1 kör **en gång per fil** (batch-prompt, ~50 rader per anrop) och normaliserar kolumnerna till:
`company_name, website, email, phone, address, rating, reviews_count, review_snippets, category`.
Koordinater, plus_code, place_id osv. ignoreras. Detta gör mappningen billig och robust mot olika Google-exportformat.

**Två destinationer efter import:**
- Har `website` + `email` (eller vi hittar email via scrape) → `site_leads` med `status = 'pending_audit'`.
- Saknar website ELLER saknar email helt → `site_leads` med `status = 'skipped_no_contact'` (parkerad lista).

**Dedupe:** unik constraint på normaliserat `company_name + domain`. Vid ny import → befintliga rader uppdateras inte, nya skippas om de redan finns (oavsett status). Så en `skipped` firma dyker aldrig upp i en senare batch.

---

## 2. Audit-loop (befintlig `audit-site`, återanvänds)

Cron `*/30 * * * *` plockar N rader där `status = 'pending_audit'` och N = **max(0, dagens sändningsbudget − antal `approved`-sites redo)**. Så vi auditar bara så många vi faktiskt behöver för att fylla morgondagens 20 sends. Ingen bulk-audit av 500 rader på en gång.

Audit-resultat sparas som idag (`audit_score`, `audit_reason`) + `audit_details` (kort JSON: 2-3 konkreta svagheter Deepseek nämner — används i mail 1). Betyg ≥ 7 → `status = 'site_good_enough'` (parkeras, ingen outreach). Betyg < 7 → `status = 'needs_site'`.

Om `audit-site` inte hittar mail på lead:en, kör ett litet contact-page-scrape steg (Firecrawl `/kontakt`, `/contact`, `/om-oss`) för att fiska email. Fortfarande ingen mail → `status = 'skipped_no_contact'`.

---

## 3. Site-generering (befintlig `generate-site`, återanvänds)

Samma cron-tick: plocka `needs_site` rader upp till samma dagsbudget, enqueue till `process-site-jobs`. Ingen ändring i själva genereringen — den redan tvåstegs (Deepseek + Claude Haiku polish) och deterministisk.

När sitan är klar och deploy:ad → `status = 'awaiting_approval'`, `demo_url` sparas.

---

## 4. Godkännande-UI

**Ny sida `/site-approvals`**. En kortlista av alla `awaiting_approval`:

Varje kort visar:
- Firmanamn, email, telefon, kategori
- **Iframe eller "Öppna gammal sida"-knapp** för original-URL:en
- **Iframe för demo_url**
- Audit-score + audit_reason
- Tre knappar: **Godkänn** / **Regenerera** (öppnar textfält för feedback → skickas som extra instruktion till `generate-site`, status → `regenerating`) / **Behövs ej** (status → `site_good_enough`, parkerad).

Godkänn → `status = 'approved'`, `approved_at = now()`, läggs i sändningskön.

---

## 5. Email-sekvens (4 mails, foremp.email)

**Ny sequence-typ i din befintliga sequence-motor** — inte en helt ny pipeline. Vi lägger till en ny node-typ `Send Demo Email` som drar `demo_url` + `audit_details` från `site_leads` istället för generisk contact.

Sekvens (identisk struktur för alla approved leads):

| # | Timing | Innehåll | Ämnesradsstrategi |
|---|---|---|---|
| 1 | Direkt efter approval | 50-100 ord. Nämner **en konkret svaghet** från `audit_details`, säger "byggde en DEMO — allt kan ändras kostnadsfritt innan lansering", CTA: klicka länken. | AI-genererad per lead, testa personlig (firmanamn) vs kuriosa-hook. |
| 2 | +3 dagar | "Hann du kika på demon? Om ja — vi kan lansera inom några dagar, fria ändringar ingår." | AI, kort follow-up-ton. |
| 3 | +4 dagar | Social proof / annan vinkel, länk igen. | AI. |
| 4 | +5 dagar | "Vill du ta ett kort möte så går vi igenom vad som behöver ändras?" | AI, mötes-CTA. |

Alla mails: **50-100 ord, gpt-4.1-mini** (samma modell som cold-mailen), skickas via befintliga `send-cold-email` + senders på `foremp.email`. Länken till `demo_url` går in i varje mail (inte tråd-referens). Open tracking + unsubscribe fungerar redan via befintlig pipeline.

Reply-detection: om leaden svarar → sekvens pausas automatiskt (finns redan).

---

## 6. Throughput & IO-budget

**Nyckelregel: vi auditar/genererar bara det vi behöver skicka.**

Daglig budget = summan av `sender_daily_remaining` för aktiva foremp-inboxes (idag ~20). Cron:
1. Räknar hur många approved-leads som är redo att enroll:as för dag D.
2. Om < 20 → auditar tills vi har 20 kandidater, sedan genererar sites tills vi har 20 `awaiting_approval` väntande på dig.
3. Du godkänner → morgonens `run-sequences` enrollar dem, first mail går ut samma dag.

Så pipeline:en pushar aldrig 500 rader genom Firecrawl/Deepseek på en gång. IO-tryck = ~20 audits + ~20 site-gens + ~80 mails/dag (20 × 4 steps utspritt över veckan).

**Extra IO-skydd:**
- `site_leads` får index på `(status, created_at)` så cron-plockningen är en index scan.
- Cron `process-site-jobs` är redan `*/5 * * * *` med `EXISTS`-guard.
- Approval-UI:t använder samma "estimated count"-mönster som Dashboard för listor > 100.

---

## Tekniska detaljer (för dig som vill veta)

**Ny tabell `site_leads`:**
```
id, company_name, domain, email, phone, address, category,
rating, reviews_count, review_snippets (jsonb),
website (source url), demo_url, generated_site_id (fk),
audit_score, audit_reason, audit_details (jsonb),
status, approved_at, feedback (text för regen), 
source_file_id, created_at, updated_at
UNIQUE (company_name_normalized, domain_normalized)
```
RLS: owner-only. GRANTs enligt standardmall.

**Ny edge function `import-site-leads`** — CSV → Deepseek batch-normalisering → insert med `ON CONFLICT DO NOTHING`.

**Modifierad `generate-site`** — läser `feedback`-fältet vid regen.

**Ny sequence template** seedas via migration: 4 noder + waits, alla `Send Demo Email` (ny node-typ som interpolerar `{{demo_url}}` och `{{audit_weakness}}`).

**Approval-flöde:** knappklick → RPC/edge function som sätter status + (för Godkänn) enrollar leaden i demo-sekvensen via befintlig `enroll-contacts`-logik.

---

## Vad som INTE ändras
- Nuvarande cold email-flödet, sekvensmotorn, sender-rotation, open tracking, GDPR-suppression.
- Kostnaderna: audit + site-gen samma modeller som idag (Deepseek + Claude Haiku).

## Föreslagen bygg-ordning
1. `site_leads`-tabell + `import-site-leads` edge function + UI för upload.
2. Cron som kopplar ihop audit → generate baserat på dagsbudget.
3. Approval-UI (`/site-approvals`).
4. Demo-email sekvens + ny `Send Demo Email` node-typ + seed migration.
5. Slå på hela loopen med en 20-lead test-batch.

Säg klart så bygger jag steg 1-2 först, sen får du testa importen innan vi går vidare.
