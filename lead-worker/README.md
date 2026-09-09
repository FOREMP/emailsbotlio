# Botlio Maps lead worker

This is an internal companion to `scraper-worker`, not a public Maps API.
It accepts signed jobs from the Supabase `lead-sourcing` function, runs one
Google Maps scrape at a time, and posts qualified records back in batches of 25.

## Deployment on the existing Lightsail server

The existing `/opt/botlio-scraper` deployment should contain both folders from
this repository:

- `scraper-worker/`
- `lead-worker/`

Copy the updated files to the server, retain the existing `scraper-worker/.env`,
and make sure it includes the values below. `SCRAPER_SHARED_SECRET` may be the
existing value used by the website scraper; no Supabase service key belongs here.

```env
SCRAPER_SHARED_SECRET=the-existing-secret
SUPABASE_URL=https://eyliwidiljmzllsmytdh.supabase.co
SCRAPER_HOSTNAME=scraper.foremp.eu
MAPS_SCRAPER_IMAGE=gosom/google-maps-scraper
LEAD_JOB_TIMEOUT_SECONDS=1800
MAPS_REQUEST_TIMEOUT_SECONDS=25
```

From `/opt/botlio-scraper/scraper-worker`, build and start the added services:

```bash
sudo docker compose up -d --build maps lead_runner caddy
sudo docker compose ps
curl -fsS https://scraper.foremp.eu/health
```

Do not expose port 8080 or 3100 in the firewall. Caddy receives only
`/v1/lead-jobs`, and that route requires the timestamped HMAC signature.

## Capacity and safety

- One Maps browser and one Maps job run at a time. A deep search may use up to
  30 minutes; on a timeout the worker cancels the underlying Maps job so it
  cannot block the next search.
- Each approved Maps search retains every result returned by the scraper. The
  Supabase stock and backlog controls decide whether another search can start.
- The Maps worker makes no NVIDIA or LLM calls.
- Existing website audit requests retain their own worker and Firecrawl fallback.
- The Supabase audit queue remains capped at `AUDIT_PER_TICK = 3`.

If the Maps image changes in a future release, change `MAPS_SCRAPER_IMAGE` only
after testing it manually. The currently configured untagged image follows the
upstream project's documented Docker command.
