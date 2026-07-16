## Problem

The UI shows `generate-site failed: Failed to send a request to the Edge Function`. This is a client-side supabase-js message that fires when the HTTP request to the function never gets a response — the isolate was killed mid-flight (wall-clock/CPU limit) or the connection was reset. The current function is synchronous: it calls OpenRouter and holds the HTTP request open for up to 70s. When the model is slow or the platform recycles the isolate, no response reaches the browser and the row stays in `generating` until the watchdog flips it to `failed`.

We've iterated on this same failure repeatedly (bigger timeouts, smaller tokens, background workers via `EdgeRuntime.waitUntil`, sync mode). None of them fix the root cause: **a user-visible HTTP request should not depend on a 30–90s AI call finishing inside the same request.**

## The fix: async job pattern

Split `generate-site` into two responsibilities:

1. **`generate-site` (fast, <1s):** validates input, flips the row to `queued`, returns 202 immediately with the row id. No AI call in the request path.
2. **`process-site-jobs` (worker):** picks up `queued` rows one at a time, runs the OpenRouter call + `buildSiteFiles`, writes `generated`/`failed`. Invoked by:
   - a pg_cron job every minute (primary), and
   - a fire-and-forget internal call from `generate-site` after it responds (so the user doesn't wait 60s for cron in the happy path).

The client already polls every 8s while rows are `generating/queued`, so the UI needs no changes beyond accepting the new `queued` status.

## Weak points to fix in the same pass

- **Client "invoke" swallows real errors.** `supabase.functions.invoke` returns "Failed to send a request…" for anything non-2xx-with-body. Switch the `runStep` call for generate/deploy to a raw `fetch` so we surface the actual status code and body (or read `error.context.response` and display it). Applies to Audit/Scrape/Deploy too.
- **Watchdog is too aggressive.** 4-minute cutoff can kill a legitimately-running job. Raise to 8 minutes and only flip rows whose `updated_at` hasn't moved (worker touches `updated_at` on pickup, so live jobs won't be reaped).
- **No row-level lock on the worker.** If two workers race (cron + inline kick), both could pick the same job. Use `UPDATE … WHERE status='queued' RETURNING …` with `FOR UPDATE SKIP LOCKED` semantics via `select … for update skip locked` in a small RPC, or a conditional update from `queued` → `processing` and skip if 0 rows updated.
- **No retry cap.** A row that fails once can be re-queued forever. Add `attempts int default 0`; worker increments; after 3 it stays `failed` and needs manual reset.
- **Stuck-row cleanup is manual.** Add a second cron (every 5 min) that flips `processing` rows older than 10 min back to `failed` with a clear message, so a killed worker doesn't leave orphans.
- **AI response occasionally returns non-JSON despite `response_format`.** Add one retry with `temperature: 0.2` before failing, and log the raw preview into `error_message` (already done) so we can see what happened.
- **Scraped content sometimes missing images/branding.** Not this bug's cause, but worth noting: worker should mark the row `failed` with a helpful message when `scraped_content` is stale, instead of generating a colorless site.

## Technical section

**DB migration**
```sql
alter table public.generated_sites
  add column if not exists attempts int not null default 0,
  add column if not exists queued_at timestamptz;

-- allow 'queued' and 'processing' as status values (text column, no enum change needed)

create index if not exists generated_sites_status_queued_idx
  on public.generated_sites (status, queued_at)
  where status in ('queued','processing');
```

Cron (via `pg_cron` + `pg_net`, matching existing `run-sequences` pattern):
```sql
select cron.schedule(
  'process-site-jobs',
  '* * * * *',
  $$select net.http_post(
     url:='https://eyliwidiljmzllsmytdh.supabase.co/functions/v1/process-site-jobs',
     headers:='{"Content-Type":"application/json","Authorization":"Bearer <service-role>"}'::jsonb,
     body:='{}'::jsonb
   );$$
);
```

**Edge functions**
- `supabase/functions/generate-site/index.ts` — reduce to: validate, `update … set status='queued', queued_at=now(), error_message=null where id=? and status in ('pending','scraped','generated','failed')`, then fire-and-forget invoke `process-site-jobs` (don't await), return `{ok:true, status:'queued'}`.
- `supabase/functions/process-site-jobs/index.ts` (new) — pick one queued row (`update … set status='processing', updated_at=now(), attempts=attempts+1 where id=(select id from generated_sites where status='queued' order by queued_at limit 1 for update skip locked) returning *`), run existing OpenRouter + `buildSiteFiles` logic, write `generated` or `failed`. If `attempts >= 3` on failure, leave as `failed` with "max retries" message.
- Existing `buildSiteFiles` and prompt code moves into `_shared/site-builder.ts` so both functions can import it (or just lives in `process-site-jobs`).

**Frontend (`src/pages/Sites.tsx`)**
- Accept `queued` and `processing` in the in-flight status list (spinner, watchdog).
- Replace `supabase.functions.invoke('generate-site', …)` for the Generate action with a `fetch` to the function URL so real HTTP errors surface in the toast.
- Bump watchdog cutoff from 4 → 8 minutes, and only reap rows whose `updated_at` is older than the cutoff.

**Status colors**
- Add `queued` and `processing` to `statusColor` map (reuse the amber `generating` style).

## Out of scope
- Model choice (staying on DeepSeek V3.1).
- Template/prompt quality — separate concern.
- Any change to `scrape-lead-data`, `audit-site`, `deploy-site`.

After you approve I'll write the migration, the two edge functions, and the Sites.tsx tweaks in one pass.