# Land in the inbox, not spam or Promotions

Current numbers (last 14 days, 304 sent, 0 recorded bounces/failures):

- Gmail: 47 sent, 33 "opened" (70%) — inflated, Gmail proxies images
- Hotmail: 25 sent, 6 opened (24%); Outlook.com: 9 sent, 0 opened
- Role addresses (info@, kontakt@ ...): 128 of 304 — these filter harder
- Volume: 15-60/day across 2-3 senders, bursty (60 one day, 15 another)

The single biggest Promotions/spam trigger in the current setup: every email
contains a remote tracking image loaded from `<project>.supabase.co`, a domain
that has nothing to do with the sending domain. A short personal-looking text
email that loads one external image from an unrelated host is exactly the
pattern Gmail classifies as bulk mail.

## What changes

### 1. Tracking pixel — the main fix
- No pixel at all in mail 1 (the cold first touch). Opens on mail 1 are the
  least useful number anyway, and mail 1 is the one that decides whether the
  whole thread goes to spam.
- For mails 2-4, serve the pixel from the sending domain instead of
  supabase.co, so image host and From domain align. Requires one CNAME/proxy
  on `foremp.email` / `foremp.eu` pointing at the tracking function; if you
  don't want to touch DNS, the fallback is to drop the pixel from mail 2 as
  well and only track 3 and 4.
- Give the pixel a plausible filename and normal image caching rather than
  `no-store` + a 1x1 GIF with an obviously tracking-ish URL.

### 2. Make the message look like a person wrote it
- Send mail 1 as plain text only (no HTML part). Text-only 1:1 mail almost
  never lands in Promotions.
- Drop the ALL-CAPS company line in the footer (`FOREMP`) — capitals in a
  signature is a classic bulk signal. Use normal casing.
- Drop the `---` separator block above the postal address; put the address on
  one quiet line.
- Keep the unsubscribe link the Email API adds (legally required and Gmail
  rewards a real List-Unsubscribe header), but no other links in mail 1.

### 3. Sending pattern
- Cap at a steady per-sender daily number instead of bursting 60 one day and
  15 the next; a flat curve reads as human.
- Weekdays only, spread over 09:00-16:00 Stockholm with randomised gaps
  (currently sends cluster when the cron fires).
- Warm the newest sender back up from a low number rather than putting it
  straight on the full quota.

### 4. List hygiene
- Add bounce/complaint recording: nothing is currently written back from the
  email provider, so a hard bounce costs reputation and we never see it. Log
  bounces and complaints into `suppressed_emails` automatically.
- Verify addresses before enrolling (syntax + MX record on the domain) and
  drop catch-all guesses.
- Deprioritise role addresses (info@, kontakt@) when a personal address exists
  on the same lead; they both filter harder and reply less.

### 5. Reply signal
- Ask a genuine question in mail 1 (already the case) and make sure `reply_to`
  is a mailbox you actually read and answer from — replies are the strongest
  positive signal Gmail has, and a couple of real replies per day lift the
  whole domain.

## Technical notes

- `supabase/functions/send-cold-email/index.ts`: skip `plainToHtml` +
  tracking pixel for step 1 (send `text` only), pixel URL becomes a configurable
  `TRACKING_BASE_URL` secret so it can point at the sending domain, footer
  loses the uppercase company and the `---` block.
- `supabase/functions/track-open/index.ts`: normal image headers, path that
  looks like an asset.
- `supabase/functions/run-sequences/index.ts`: even hourly spread with jitter,
  weekday gate, per-sender warmup ramp.
- New webhook function for provider bounce/complaint events writing to
  `suppressed_emails`; new MX-check step in the enrollment path.
- No DNS change is strictly required except the optional tracking CNAME.

## Open question

DNS: are you able to add one CNAME on `foremp.email` and `foremp.eu` for the
tracking host? If not, we go pixel-free on mails 1-2 and accept lower open
data in exchange for better placement.
