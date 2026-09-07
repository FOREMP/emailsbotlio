# Botlio scraper worker

This is the self-hosted scraper used by the Supabase website pipeline when the
operator selects **Botlio server**. It does not contain a Supabase key and it
does not send email or make AI calls.

## First deployment on Lightsail

1. Point an unused subdomain such as `scraper.foremp.eu` to the Lightsail static
   IPv4 address with an A record.
2. Copy this folder to `/opt/botlio-scraper` on the Ubuntu server.
3. Copy `.env.example` to `.env`, enter the hostname, and enter a new secret
   generated with `openssl rand -hex 32`.
4. Install Docker Engine and Docker Compose on Ubuntu, then run:

   ```sh
   cd /opt/botlio-scraper
   docker compose up -d --build
   ```

5. Open only ports 80 and 443 publicly in Lightsail. Restrict port 22 to your
   own IP. Do not expose port 3000.
6. Test `https://scraper.foremp.eu/health`. Then add the same random secret and
   the HTTPS URL to Supabase Edge Function secrets.

## Request security

Every scrape request must include a timestamp and HMAC-SHA256 signature using
the shared secret. The server rejects expired or unsigned requests. It also
blocks localhost, private networks, AWS metadata addresses, unsafe redirects,
non-HTTP(S) URLs, unusual ports, and oversized downloads.
