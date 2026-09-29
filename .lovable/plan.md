# Prove which AI builds each website (Nemotron check)

## What the code says right now
The change is in the code. The Nemotron name appears in four places:
- `process-site-jobs/freeform.ts` line 29: `NVIDIA_BUILD_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b'`, used at line 1785 for every page's content
- `process-site-leads/index.ts` line 132: the template picker
- `process-site-jobs/index.ts` line 1114: the older fallback builder
- `_shared/ai-provider.ts` line 198: request settings for Nemotron

## Why the logs show nothing
The AI helper only writes a log line when a call **fails**. When a call works, it writes nothing. The model name used for each page is only returned inside the code and never saved or shown. So there's no proof in the logs either way. That's a gap, and I shouldn't have said "it works" without real proof.

There's also a real risk: if NVIDIA didn't accept that model name, every page would quietly fall back to local stock text. The site would still go live, and the polish step (GPT-4o-mini on OpenRouter, Swedish only) would still run on top of it. That would explain the OpenRouter usage while the sites still looked fine.

## What to do
1. **Check the model name with NVIDIA:** ask NVIDIA's live model list whether `nvidia/nemotron-3.5-lightning-30b-a3b` exists. If it doesn't, switch to one that is confirmed on the list, like `mistralai/mistral-nemotron` or a Qwen/Llama instruct model, after a quick test call.
2. **Log every AI call, not just failures:** one line per call showing which AI provider, model, page, how long it took and whether it worked. This goes in the shared AI helper, so it covers building, template picking and audits.
3. **Save the model on each page:** save `model` and `source` (ai / local-fallback / polished) for each page in the site's progress record, so you can check any site later in the database.
4. **Show it in the approvals view:** add a small line like "Byggd med: nvidia/nemotron… (5/5 sidor AI)" or "3/5 sidor lokal reserv" on each site.
5. **Test it:** requeue one Swedish and one English lead. Then confirm in the logs and database that the pages were really written by the NVIDIA model, and report back with the real log lines.

## Out of scope for now
The GPT-4o-mini polish step on OpenRouter stays as it is. We'll decide on removing it or moving it to NVIDIA once we have real numbers from step 5.

## Technical details
- `ai-provider.ts` `callRoutedChat`: add `console.log('[ai] ok provider=… model=… title=… ms=…')` on success.
- `freeform.ts` content stage: store `{ model: routed model, source }` in `gen_progress.content[slug]` and keep `model` when polish changes `source`.
- `SiteApprovals.tsx`: read `gen_progress.content` and summarise the models used and the fallback count.
- Model check: `GET https://integrate.api.nvidia.com/v1/models` with `NVIDIA_API_KEY`.
