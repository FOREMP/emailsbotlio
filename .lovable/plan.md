# Cut running cost: NVIDIA models + own scraper server

Three phases, in this order. Each one works on its own, so you can stop after any of them.

## Phase 1 — Swap OpenRouter for NVIDIA (no server needed, do this first)

NVIDIA's developer endpoint is OpenAI-compatible, so it is a drop-in swap: same request shape, different address, key and model names.

- Add a shared AI client used by every function instead of each file calling OpenRouter directly. It reads a provider setting (`nvidia` or `openrouter`) so you can flip back instantly if a model disappoints, without another code change.
- Model mapping (all free on the NVIDIA dev tier):
  - Website content writing: DeepSeek V3.1 (the same model quality you already fall back to today)
  - Language polish: a strong instruct model (Qwen3 or Llama 3.3 70B), chosen after a side-by-side test on real Swedish copy
  - Audit scoring: same tier, needs image input for the screenshot rubric — verified during the test before switching
  - Template picker and review picker: smallest fast model
- The 40 requests/minute limit is handled properly, not hoped for: calls go through one small queue that spaces them out, and a 429 waits and retries instead of failing the site build. At your volume (about 10 calls per site, 1 per audit) you use well under half the limit.
- Anything the free tier cannot do well stays on the current model. Site quality is the deciding test, not price.

Before this counts as done: build two Swedish and one English test site, and re-score ten already-audited leads, then compare against current output for wording, industry fit and score agreement.

## Phase 2 — Own scraper on a Lightsail box (replaces most Firecrawl usage)

One Ubuntu box (2 GB, about $12/month), running two Docker containers behind Caddy for automatic HTTPS on a subdomain such as `scrape.foremp.eu`:

1. **Scraper service** — a small HTTP service with headless Chromium. One endpoint: give it a website address, it returns the same shape the system already expects (page text, links, images, discovered "om oss"/"tjänster" pages, basic colours and fonts). Protected by a secret token so only your system can call it.
2. **Caddy** — HTTPS and the token check.

In the app:
- A single scraper client replaces the direct Firecrawl calls in the lead scraping and audit steps.
- Screenshots stay on Firecrawl, as you said. That is one small call per lead instead of the whole crawl, which drops you back into a much cheaper Firecrawl tier.
- If your box is down or a site blocks it, the code falls back to Firecrawl for that lead so the pipeline never stalls. Failures are recorded in the existing pipeline-health system.

## Phase 3 — Google Maps lead scraping on the same box

Use `gosom/google-maps-scraper` (Go, has a built-in web/API mode and Docker image) as a third container on the same Lightsail box, on an internal port, reachable only through the same token-protected entry.

- **Manual:** a "Hämta leads" panel in the app where you enter search terms, city and language, press start, and watch progress. Results land straight in `site_leads` through the existing import path, with the same duplicate protection.
- **Automatic:** a nightly job that checks lead stock per language and niche and runs saved searches when stock falls under a threshold, so the pipeline never runs dry.
- Scraping is queued job-by-job on the server, so a big Maps run never blocks a website scrape.

## What this costs when finished

| Item | Now | After |
| --- | --- | --- |
| AI (OpenRouter) | Your current monthly spend | 0 while on the NVIDIA free tier |
| Firecrawl | $80 plan, ~20% used | Lowest paid tier, screenshots only |
| Server | — | ~$12/month Lightsail |
| Google Maps scraping | Manual, on your laptop | Runs on the server, manual + nightly |

## Technical notes

- New `supabase/functions/_shared/llm.ts`: provider-aware chat client (`https://integrate.api.nvidia.com/v1/chat/completions`, `NVIDIA_API_KEY`), model alias table, rate-limit spacing, 429/5xx backoff. Call sites to migrate: `process-site-jobs/freeform.ts` (`BUILD_MODEL`, `LANG_MODEL`, `callModel`, `callBuildModelCascade`), `process-site-jobs/index.ts`, `_shared/site-audit.ts`, `process-site-leads/index.ts`, `import-site-leads/index.ts`. `generate-email` keeps its current OpenAI path.
- New `supabase/functions/_shared/scraper.ts`: client for the self-hosted scraper returning the existing `scraped_content` shape, with Firecrawl fallback. `scrape-lead-data` and `_shared/site-audit.ts` switch to it; Firecrawl keeps only the screenshot call.
- Secrets to add: `NVIDIA_API_KEY`, `SCRAPER_BASE_URL`, `SCRAPER_TOKEN`.
- Server: Lightsail Ubuntu 2 GB, Docker Compose with Caddy + scraper service (+ `gosom/google-maps-scraper` in phase 3), a DNS record for the subdomain, and firewall limited to 80/443.
- Phase 3 adds an edge function that starts and polls a Maps job, a UI panel, and a scheduled top-up job; leads are inserted through the existing `insert_site_leads_batch` path.
- No database schema change is needed for phases 1 and 2; phase 3 adds a small table for saved searches and job runs.
