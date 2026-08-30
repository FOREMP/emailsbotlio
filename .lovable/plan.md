# Lead replenishment plan — what to add next

## Current stock (usable leads with email, not yet emailed)

| Language | Niche | Ready to email |
|---|---|---|
| sv | hair_salon | 211 |
| sv | construction | 116 |
| sv | auto_workshop | 87 |
| sv | other | 54 |
| en | construction | 71 |
| en | hair_salon | 75 |
| en | other | 5 |

## Consumption & runway

- Build rate last 7 days: sv ~39 sites, en ~101 sites.
- Sender capacity: Swedish ~24 new/day (12/day per sender), English ~10 new/day (2 senders at 5/day).
- **English runway: ~15 days → runs out around 14–15 September.**
- **Swedish runway: ~19 days → runs out around 18–20 September.**
- ~35% of scraped leads have a usable email; the rest land in `skipped_no_contact` (1,773 total). Import 3x the volume you actually need.

## Recommendation — what to add, in priority order

### 1. English construction (add first — by 5 September)
- English stock is thinnest relative to its send rate, and construction performs well (71 ready + 37 more pending triage/audit).
- Google Maps scrape: builders, contractors, roofers, landscapers in UK/Ireland mid-size cities (Manchester, Leeds, Bristol, Dublin, Cork) — avoid London, too competitive.
- Target: **~600 raw rows → ~200 usable** (about 3 weeks of English capacity).
- Note: Texas/US leads stay on the separate Botlio sequence — don't mix them into the foremp.eu English pool.

### 2. Swedish hair salons (add by 10 September)
- Biggest proven niche (161 approved historically) but the 211 in stock will be eaten first by the 24/day Swedish capacity.
- Scrape frisör/hårstudio in Göteborg, Malmö, Uppsala, Linköping, Örebro, Umeå.
- Target: **~500 raw rows → ~175 usable**.

### 3. Swedish construction (add by 12 September)
- Byggfirmor/snickare/målare in the same secondary cities. Stock of 116 lasts ~5 days of full Swedish throughput once hair runs low.
- Target: **~400 raw rows → ~140 usable**.

### Skip for now
- English hair salons: 67 of ~180 historically failed generation — weak fit, deprioritize.
- Swedish auto_workshop: 87 in stock is enough for now; refill next round.

## Timeline

```text
Now – 5 Sep    Scrape + import English construction (UK/IE)
5 – 10 Sep     Scrape + import Swedish hair salons
10 – 12 Sep    Scrape + import Swedish construction
14 Sep         English stock would run dry if nothing added
18 Sep         Swedish stock would run dry if nothing added
```

## Technical notes

- Import with correct `language` and `niche` tags so leads route to the right prompts, senders (foremp.eu for en, Swedish domains for sv), and sequences automatically.
- Filter out rows without email before import where possible — they only inflate `skipped_no_contact`.
- Leads land in `pending_audit` and flow through audit → triage → build without manual work; the stale-audit watchdog keeps the queue moving.
