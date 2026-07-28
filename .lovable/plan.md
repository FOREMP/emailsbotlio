
## What's actually wrong

Confirmed via DB query: every one of the ~40 pending salon leads (Salon C, Capillum studios, COCO NAIL BAR, Frisörelevernas kundmottagning, etc.) has `niche = 'auto_workshop'`. That's the default in `import-site-leads` and the CSV import UI defaults the dropdown to Bilverkstad, so a forgotten dropdown change tags the whole file as mechanics. `process-site-leads` then picks `auto_workshop_v1` as the template, and `process-site-jobs`'s `nicheFromTemplate()` returns the mechanic config — hence the "car" copy on salon sites.

Image quality: the salon `stockImages` pool in `NICHE_CONFIG.hair_salon` is 10 Unsplash URLs picked earlier; several are low-res / awkwardly cropped and get reused across hero + gallery, which reads as cheap.

## Plan

### 1. Backfill the mis-tagged salon leads (data fix)
Run a one-shot SQL update that re-tags obvious salon/beauty leads currently sitting as `auto_workshop` + `needs_site` to `hair_salon`, matching on company_name / category keywords: `salon`, `salong`, `frisör`, `frisor`, `hair`, `barber`, `spa`, `skin`, `nail`, `beauty`, `estet`, `klinik`, `kropps`. Only touches rows still `needs_site` (nothing in flight, nothing already generated), so it's safe.

### 2. Make the import UI refuse to silently default
In `src/pages/SiteLeads.tsx`:
- Change initial `niche` state from `"auto_workshop"` to `""` (unset).
- Disable the "Importera" button until a niche is picked.
- Add a visible hint under the select ("Välj bransch — annars vet AI:n inte vilken mall som ska användas").

This kills the class of bug where a whole file gets mis-tagged.

### 3. Upgrade salon imagery
In `supabase/functions/process-site-jobs/index.ts`, replace `NICHE_CONFIG.hair_salon.stockImages` with a fresh curated set of ~14 high-quality Unsplash URLs (salon interiors with good light, styling chairs, color work, product flatlays, portrait cuts) all at `w=1600&q=80` and each verified to load. Broaden the pool so hero and gallery don't repeat the same photo.

Also small quality tweak in the same file: when picking the hero image for hair_salon, prefer an image tagged as a wide interior shot (first N of the curated list ordered interior-first) rather than `images[0]` which today can land on a tight portrait crop.

### 4. Verify
After deploy: approve one salon lead from the awaiting-approval queue and confirm the generated HTML uses "salong / frisör / behandling" wording and the new photos. Spot-check one auto_workshop lead still generates the mechanic template unchanged.

## Out of scope
No changes to email sending, sequences, cron cadence, throttle, or the auto_workshop template/prompt/images.

## Technical notes
- Files touched: `src/pages/SiteLeads.tsx`, `supabase/functions/process-site-jobs/index.ts`, plus one SQL migration for the backfill.
- No schema change — `niche` column already exists.
- The 40 already-mis-tagged leads are still `needs_site` (no generated_site rows yet), so re-tagging them makes the next `process-site-leads` tick pick the correct `hair_salon_v1` template automatically. No manual re-queue needed.
