

## Plan: Fix failing sends + correct batching/sender-limit semantics

### Why emails are failing
Every "failed" row in `sent_emails` is a 403 from the Lovable Email API:
- `domain_not_verified` — sending from `botlio.email`, `botlio.eu`, `botlio.io`, `foremp.email`, `foremp.eu`
- `no_matching_sender` — same root cause

Only **one** sender subdomain is actually verified with Lovable Emails: `notify.foremp.one`. The `senders` table has 24 rows spanning 6 different root domains, but only senders whose `from_email` ends in `@foremp.one` can actually send. Anything else 403s.

There are also two duplicate rows per from_email in `senders` (24 rows for 12 unique emails) from the seeder running twice.

### Changes

**1. Restrict sender pool to verified domains (immediate fix for failures)**
- Add an `is_verified` boolean column on `sending_domains` (default false). Mark only `foremp.one` as verified for now.
- In `send-cold-email/index.ts`: when picking a sender, filter the pool to senders whose domain has `is_verified = true`. If none, fail fast with a clear error: "no verified sending domain — only foremp.one is currently verified".
- In `run-sequences/index.ts`: same filter when looking up the sender pool. If a `sender_strategy: 'specific'` points to an unverified-domain sender, fail the enrollment with `last_error: 'sender domain not verified with Lovable Emails'` instead of attempting the doomed send.
- Deduplicate `senders` (delete the duplicate rows so the pool is clean).
- On the **Senders** page, show a small "Unverified domain — cannot send" badge next to any sender whose domain isn't verified, so the user knows which ones are usable.

**2. Correct batching semantics (count first crossing only)**
Today the throttle node only counts `throttle_pass` rows for the *current* throttle node. That's already correct for "first crossing per node per day". The actual gap is: when an enrollment is later in the sequence (e.g. day-3 follow-up after a wait), it never re-passes a throttle node, so it correctly does NOT consume today's batch. Verify this is true and document it.

The real problem is different: **follow-up sends past a wait node should NOT be blocked by the throttle, but they SHOULD still respect the sender's daily cap**. Right now, a follow-up that lands on a `send_email` node will compete for sender capacity with brand-new enrollments — and brand-new enrollments win because they're processed in arbitrary order.

Fix: in `run-sequences`, **prioritise enrollments that already have `last_sent_at IS NOT NULL`** (i.e. mid-sequence follow-ups) ahead of brand-new enrollments. Concretely, run the worker query in two passes per tick:
- Pass A: `due AND last_sent_at IS NOT NULL` (follow-ups, queued from yesterday or scheduled)
- Pass B: `due AND last_sent_at IS NULL` (new enrollments hitting batch for first time)

Each pass uses the same MAX_PER_RUN budget. Follow-ups drain first.

**3. Sender limit always wins; defer instead of fail when at cap**
- Today the throttle "max_per_day" can be set higher than a sender's `daily_limit` and the worker doesn't reconcile them. Fix: in `send_email` node processing, the **sender's remaining capacity** (`sender_daily_remaining`) is the hard ceiling. Throttle just decides *which* enrollments are allowed onto the conveyor; the sender cap decides *how many actually go out*.
- When all eligible senders are at cap AND there are still enrollments queued, defer them with `next_send_at = tomorrow 00:00 UTC` and `last_error = 'all senders at daily cap — queued for tomorrow'`. This is already partly implemented but currently sets a generic message; tighten it and ensure the deferred enrollment is picked up FIRST tomorrow (Pass A above handles this since `last_sent_at` is set on the previous successful send for that contact, OR we set a new flag `deferred_at` to mark "owed from a prior day").
- Add a `deferred_at timestamptz` column on `enrollments`. Set it whenever we defer due to sender cap. Pass A's ordering becomes: `ORDER BY deferred_at ASC NULLS LAST, last_sent_at ASC NULLS LAST`. This guarantees yesterday's leftovers send before today's new batch.

**4. Surface failures clearly on Sequences page**
Already shows failed counts; add an inline warning banner: "X sends failed today due to unverified domains. Only `foremp.one` is currently verified for sending." Click through to a small panel listing the affected sender emails.

### Files touched
- `supabase/functions/send-cold-email/index.ts` — verified-domain filter + clearer errors
- `supabase/functions/run-sequences/index.ts` — two-pass query, deferred_at handling, sender-cap as hard ceiling
- `src/pages/Senders.tsx` — "Unverified domain" badge
- `src/pages/Sequences.tsx` — unverified-domain warning banner
- New migration:
  - `ALTER TABLE sending_domains ADD COLUMN is_verified boolean DEFAULT false`
  - `UPDATE sending_domains SET is_verified = true WHERE domain = 'foremp.one'`
  - `ALTER TABLE enrollments ADD COLUMN deferred_at timestamptz`
  - Dedupe senders: delete duplicate `(user_id, from_email)` rows keeping the oldest
  - Add unique constraint `senders (user_id, from_email)` to prevent future duplicates

### What this does NOT fix
The other 5 root domains (`botlio.email`, `botlio.eu`, `botlio.io`, `foremp.email`, `foremp.eu`) are not verified with Lovable Emails. To actually send from them, each needs to be added under **Cloud → Emails → Manage Domains** and DNS delegated. That's a manual step for you in the Lovable Cloud UI — once added and verified, just flip `is_verified = true` for that row in `sending_domains` (or we can auto-sync it).

### Validation
- After deploy: trigger Run now → no more `domain_not_verified` rows in `sent_emails`. Senders on unverified domains are skipped with a clear `last_error`.
- Set throttle `max_per_day = 10`, sender `daily_limit = 3`. Enroll 20 contacts. Confirm exactly 3 send today (sender cap wins), the other 7 that passed throttle are deferred with `deferred_at`, and tomorrow they send before any brand-new enrollments.
- Mid-sequence follow-up after a wait node is processed before new enrollments on the same tick.

