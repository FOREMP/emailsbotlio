# Audit rework: score buying intent, not design polish

## The problem, confirmed in the data

The audit today asks one question: *how modern and well-designed is this site?* That is not the question that matters. What matters is: *is this owner likely to want a new site?*

Reading the last 50 leads you approved, almost every rejection reason is cosmetic:

- "Brist på tydliga call-to-action knappar i hero-sektionen"
- "Svag visuell hierarki med enformig typografi"
- "Rörig cookie-banner"
- "Designen känns steril"

Those are nits on sites that basically work. An owner with a working site does not buy a rebuild because the hero lacks a button.

Meanwhile the genuinely strong buy signals sit in the same weakness lists, undifferentiated:

- "Kvarlämnad platshållartext (refererar till 'Promac Roofing' istället för det egna bolaget)"
- "'Projects Done: 0+'"
- "Använder en gratis Gmail-adress istället för en professionell domänmejl"
- "Daterad design med 2010-tals estetik", "ingen mobilanpassning"

## Where your judgement actually sits

328 leads carry a human decision. Comparing them to the audit score:

| Score | You built + sent | You parked |
|---|---|---|
| 1–3 | 61 | 9 |
| 4 | 189 | 18 |
| 5 | 12 | 35 |
| 6 | 6 | 57 |
| 7+ | 0 | 46 |

Your real cutoff is between 4 and 5, not the code's 7. The pipeline currently parks at score ≥7 (`process-site-leads/index.ts:580`) and pushes everything from 1–6 towards a build. That is the mismatch: 97 leads scored 4 sit in `site_good_enough` while 189 leads scored 4 got built and sent. Same score, opposite outcome, decided by nothing consistent.

## The fix

### 1. Rewrite the audit question

Replace the design-grading prompt in `supabase/functions/_shared/site-audit.ts` with a buy-intent prompt. Same screenshot-first input, different scale:

```text
1-2  No real site: parked domain, broken, error page, or only a
     Facebook/Bokadirekt profile. Strongest possible buyer.
3-4  Real site but visibly obsolete or neglected: pre-2015 look,
     no mobile layout, placeholder/wrong-company text, broken
     images, free-mail contact address. Clear buyer.
5-6  Ordinary functioning small-business site. Dated but not
     embarrassing. Might buy, might not — human call.
7-8  Modern, coherent, clearly maintained. Will not buy.
9-10 Professionally designed and current. Will not buy.
```

### 2. Separate cosmetic from structural

The model returns two lists instead of one flat `weaknesses`:

- `structural[]` — obsolete look, no mobile layout, placeholder or wrong-company text, broken links/images, no own domain, free-mail address, third-party profile only, no services or contact info at all.
- `cosmetic[]` — missing CTA button, weak hierarchy, generic template, thin copy, no pricing, cookie banner, sterile feel.

Hard rule in the prompt: **cosmetic issues alone never push a score below 5.** A site with only cosmetic issues is a working site, and its owner is not a buyer. Structural issues are what drive the score down.

The cosmetic list is still stored — it stays useful as cold-email argument material even when the lead is parked.

### 3. Re-cut the thresholds toward your approval queue

In `auditOne` (`process-site-leads/index.ts:580`):

| Score | Route | Meaning |
|---|---|---|
| 1–4 | `needs_triage` | Strong buyer — you confirm, then build |
| 5–6 | `needs_triage`, flagged `borderline` | Your call, defaults to visible in the queue |
| 7+ | `site_good_enough` | Auto-parked, no outreach |

Nothing between 1 and 6 gets auto-parked any more, which is what you asked for: err toward your approval rather than silently discarding. Unreadable and uncertain audits also route to triage instead of being scored blind.

### 4. Show the reasoning in the triage queue

`TriageQueue.tsx` currently shows the score and a reason string. Add:

- Structural issues in red, cosmetic in grey — so a card with an empty red list is instantly recognisable as a probable park.
- A `borderline` badge on 5–6.
- Sort by score ascending so the strongest buyers land at the top.

### 5. Validate before it goes live

Re-run the new audit against the 328 leads that already carry your decision and compare. Target: the new score agrees with your build/park choice on 85%+ of them. If it does not, adjust the band boundaries before switching the pipeline over. This costs one Firecrawl + one vision call per lead and runs as a one-off script, not in the pipeline.

## Technical summary

- `supabase/functions/_shared/site-audit.ts` — new system prompt, new scale, `AuditResult` gains `structural: string[]` and `cosmetic: string[]` (keep `weaknesses` as their concatenation so nothing downstream breaks).
- `supabase/functions/process-site-leads/index.ts` — new routing bands in `auditOne`; store `structural`/`cosmetic`/`borderline` in `audit_details`; route uncertain and unreadable to `needs_triage`.
- `src/components/site-leads/TriageQueue.tsx` — split issue display, borderline badge, score-ascending sort.
- No schema change: `audit_details` is already `jsonb`.
- The 97 auto-parked leads scored 4 are re-queued for re-audit under the new rules — that is a meaningful chunk of stock recovered given how thin the pipeline is right now.
