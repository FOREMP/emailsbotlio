# Lead runway — corrected numbers, and why the UI is wrong

My earlier numbers were wrong. They counted `site_good_enough` leads (which deliberately never get a site) and assumed `last_email_sent_at` tracked sends. It does not — that column is `null` on all 2,187 leads.

## Two data bugs found

1. **`site_leads.last_email_sent_at` is never written.** Every row is null, in both languages. Nothing in the pipeline stamps it, so "have we contacted this lead?" is unanswerable from the leads table.
2. **`generated_sites.contact_id` does not match `sent_emails.contact_id`.** Joining them gives 0 emailed leads across all 685 sites with a lead link, even though 328 leads provably received mail. The only reliable link today is matching `lower(site_leads.email)` to `lower(sent_emails.recipient_email)`.

## Real stock: leads with an email that have never been contacted

Excludes `skipped_no_contact`, `failed`, and `site_good_enough`.

| Language | Niche | Never emailed |
|---|---|---|
| sv | construction | 47 |
| sv | other | 20 |
| sv | hair_salon | 3 |
| sv | auto_workshop | 1 |
| **sv total** | | **71** |
| en | construction | 40 |
| en | other | 8 |
| en | hair_salon | 1 |
| **en total** | | **49** |

Of these, roughly 47 sv and 31 en are still in `pending_audit` — they have no site built yet. The rest are approved with a demo URL, ready to send.

For context, the full table is 2,187 rows but 1,291 are `skipped_no_contact` (no email), 259 `site_good_enough`, and 189 `failed`. Only ~120 rows are actually actionable.

## Runway

At current sender capacity — Swedish ~24 new mails/day, English ~10/day:

- **Swedish: ~3 days of stock. Dry around 2 September.**
- **English: ~5 days of stock. Dry around 4 September.**

Note: no mail has gone out since 28 August (146 sent that day, 0 since). So the clock is currently paused, but the moment sending resumes both languages empty within a week.

## Is the UI correct?

No. `SiteLeads.tsx` counts rows per status and shows nothing else, which is misleading in three ways:

- Status totals lump `skipped_no_contact`, `site_good_enough`, and `failed` in with live leads, so the page looks like there are thousands of leads when ~120 are usable.
- There is no "already contacted" signal anywhere, because the column backing it is never written.
- There is no runway or days-of-stock indicator, so an empty pipeline looks identical to a full one until sending stalls.

## What to add next (priority order)

1. **Swedish construction — this week.** Only 47 uncontacted, the largest sv pocket and a proven niche. Scrape byggfirmor/snickare/målare in Göteborg, Malmö, Uppsala, Linköping, Örebro, Umeå. ~600 raw rows → ~200 usable (only ~35% of scrapes carry an email).
2. **English construction — this week.** 40 uncontacted. UK/Ireland mid-size cities (Manchester, Leeds, Bristol, Dublin, Cork), builders/roofers/landscapers. ~500 raw → ~175 usable.
3. **Swedish hair salons — next.** Effectively exhausted (3 left) after 159 contacted. Same secondary cities, frisör/hårstudio. ~500 raw → ~175 usable.
4. **Skip English hair salons.** 36 of 37 already contacted and 67 previously failed generation — weak niche, do not refill.

## Fixes to make alongside

1. Stamp `site_leads.last_email_sent_at` when `send-cold-email` sends to a lead, and backfill it once by matching lead email to `sent_emails.recipient_email`.
2. Repair the lead↔contact link so `generated_sites.contact_id` matches the contact actually enrolled, making per-lead send history queryable without email matching.
3. Add a lead-inventory panel to `SiteLeads.tsx`: uncontacted leads per language and niche, split into "site ready" vs "needs build", plus estimated days of runway at current sender capacity.
4. Filter rows without an email at import time so `skipped_no_contact` stops inflating every count.
