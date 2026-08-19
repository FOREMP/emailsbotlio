# Open tracking across two domains + remaining DNS work

## How tracking works today (verified)

- Every follow-up email (mail 2, 3, 4) gets a 1x1 GIF whose URL is built by `trackingPixelUrl()` in `send-cold-email`.
- Mail 1 is sent as plain text with **no pixel at all** (deliberate, for inbox placement).
- The pixel host is `TRACKING_BASE_URL` if set, otherwise the Supabase function URL. That secret is **not set**, so today every pixel points at `…supabase.co/functions/v1/track-open/o/<id>.gif`.
- The open is matched by `message_id` in the URL, not by domain. So both sending domains are tracked, through the same host, and **no domain is giving false data**.

What the numbers actually mean right now:

- Opens are only ever counted from mail 2 onward. Any lead that replies or converts on mail 1 shows as "0 opens" — the real open rate is higher than the dashboard shows.
- Last 10 days: foremp.email 286 sent / 117 opened, foremp.eu 9 sent / 5 opened. Both domains report; foremp.eu simply has very low volume so far.
- The one real problem is deliverability, not accuracy: a pixel on `supabase.co` does not match the From domain, which is a bulk-mail signal in Gmail.

## What to change

### 1. Per-domain tracking host (fixes the "only one domain" limitation)

A single `TRACKING_BASE_URL` secret can only ever match one From domain. Instead, store the tracking host per sending domain:

- Add `tracking_host text` to `sending_domains` (nullable).
- `send-cold-email` builds the pixel from the *chosen sender's* domain row: `https://<tracking_host>/o/<message_id>.gif`.
- Fallback order: `tracking_host` → `TRACKING_BASE_URL` → Supabase function URL. Nothing breaks for domains without a host set.

Result: mail from `@foremp.email` loads its pixel from `t.foremp.email`, mail from `@foremp.eu` from `t.foremp.eu`.

### 2. Make the tracking hosts actually resolve

`t.foremp.email` cannot CNAME straight to the Supabase functions host (it routes by project, not by hostname). The clean route, using the Vercel account already in use:

- Create a tiny Vercel project (e.g. `foremp-tracking`) whose `vercel.json` rewrites `/o/:id.gif` to the Supabase `track-open` function.
- Add both `t.foremp.email` and `t.foremp.eu` as domains on that project; Vercel gives you the CNAME target and the TLS cert.
- Then set `tracking_host` per domain row.

If you'd rather not add a Vercel project, the alternative is leaving the Supabase host — tracking keeps working exactly as now, we just don't get the domain-match deliverability win.

### 3. DNS records worth checking per domain

For each of `foremp.email`, `foremp.eu` (and `foremp.one` if you start sending from it):

- **SPF / DKIM / return-path** on the `notify.` subdomain — already in place via Lovable Emails verification.
- **DMARC** — `_dmarc.<domain>` TXT, `v=DMARC1; p=none; rua=mailto:eric@foremp.se`. Worth confirming it exists on **both** domains; it's the single most common missing record.
- **Tracking CNAME** — `t.<domain>` → Vercel target (only after step 2).
- **MX on the root domain** — so replies to the From address don't hard-bounce if someone hits reply instead of the reply-to.
- Optional, low priority: BIMI (needs a VMC certificate, not worth it yet), and a plain `A`/redirect on the root so the domain isn't a dead page when a recipient types it.

## Technical notes

- Migration: `alter table public.sending_domains add column tracking_host text;`
- `send-cold-email`: `trackingPixelUrl(supabaseUrl, messageId)` becomes `trackingPixelUrl(domainRow, supabaseUrl, messageId)`; call site already has `domainRow` in scope.
- `track-open` needs no change — it already accepts the `/o/<id>.gif` path shape and matches on `message_id`.
- Mail 1 stays untracked. I'd keep it that way; if you want mail-1 opens counted, that's a separate decision with a deliverability cost.
