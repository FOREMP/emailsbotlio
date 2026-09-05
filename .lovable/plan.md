# Lower AI cost without lowering site or language quality

## Where the money actually goes today

Per generated website (4-5 pages) the system makes about 9-11 model calls:

| Step | Model today | Volume | Comment |
| --- | --- | --- | --- |
| Site content, one call per page | DeepSeek V4 Flash, then DeepSeek V3.1, then GPT-4o-mini | 4-5 calls, 3000 tokens each | V4 Flash often times out (38s), so the same page is paid for twice or three times and ends on the most expensive model |
| Language polish, one call per page | GPT-4o-mini, always | 4-5 calls, 3000 tokens each | Runs on every page even when the draft is already good. This is the single biggest line item |
| Template picker | DeepSeek V3.1 | 1 small call per lead | Cheap |
| Website audit | Gemini 2.5 Flash | 1 per lead | Already cheap |
| Review snippet picker on import | DeepSeek V3.1 | 1 per 20 rows | Cheap |
| Cold email writing | GPT-4o-mini via OpenAI direct | 2 small calls per email | Small tokens, quality critical |

So the cost is concentrated in the site builder: the double-paying timeout cascade plus a full second GPT pass over every page.

## Changes

**1. Stop paying twice for timeouts**
Drop DeepSeek V4 Flash from the first position. New cascade for both languages:
Gemini 2.5 Flash (fast, reliable, strong Swedish and English, 25s timeout) → DeepSeek V3.1 (35s) → GPT-4o-mini (last resort only).
Gemini 2.5 Flash costs a fraction of GPT-4o-mini and rarely times out, so most pages finish on the first attempt instead of the third.

**2. Make the polish pass conditional instead of always-on**
Polish still runs, but only where it earns its cost:
- always on the start page (index),
- on any page where the content call fell back to template text or produced short or suspicious copy (missing fields, wrong-language words, mojibake),
- skipped when the draft already came from the strong language model and passes the existing quality checks.
Model for polish moves from GPT-4o-mini to Gemini 2.5 Flash, which handles Swedish idiom well at roughly a tenth of the price.

**3. Trim tokens, not quality**
- Lower `max_tokens` from 3000 to 2200 for content and polish (measured output is well under this; the cap only limits runaway responses).
- Do not resend the full fact pack and template notes in the polish call when polish runs right after content on the same page — send the draft plus a short fact list.

**4. Small calls move to the cheapest usable model**
Template picker and import review picker move from DeepSeek V3.1 to Gemini 2.5 Flash Lite. Both are short classification tasks where the model choice does not affect output quality.

**5. Cold emails stay as they are**
Email copy is what actually earns money and uses very few tokens per send. No model change there.

## Expected effect

The site builder's spend should fall by roughly 60-75 percent: the timeout re-tries disappear, the always-on GPT polish becomes a conditional cheap-model polish, and the remaining GPT-4o-mini usage is a rare last resort. Language quality is protected because Gemini 2.5 Flash replaces GPT-4o-mini only for editing work, and the existing quality checks and fallbacks stay in place.

## Verification before this is considered done

Generate three test sites (two Swedish, one English) through the normal pipeline, then compare against recent existing sites for Swedish idiom, correct industry wording, no mojibake, and no template-sounding filler. Check the run log for which model each page used and how many retries happened.

## Technical notes

- `supabase/functions/process-site-jobs/freeform.ts`: change `BUILD_MODEL` / `BUILD_FALLBACK_MODEL` / `BUILD_LAST_RESORT_MODEL` and the `callBuildModelCascade` attempt list and timeouts; change `LANG_MODEL`; add a `needsPolish(content, page)` guard in the `polish_content` stage so skipped pages are marked polished without a model call.
- `supabase/functions/process-site-leads/index.ts`: `TEMPLATE_PICKER_MODEL`.
- `supabase/functions/import-site-leads/index.ts`: `MODEL`.
- No database or UI changes; no changes to `generate-email`, `send-cold-email`, or the audit path.
