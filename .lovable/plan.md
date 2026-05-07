## Goal

1. Surface a **real** bounce rate in Analytics (separate from "we never sent it").
2. Let you swap the contact list on an existing sequence without recreating it.
3. Audit + confirm replies and unsubscribes are routed correctly to the right mailboxes outside the system.

Open tracking is explicitly out of scope for now (your call — correct one during warm-up).

---

## 1. Real bounce tracking

### What's there today
- `send-cold-email` writes `sent_emails.status` = `queued` → `sent` or `failed` (where `failed` = Lovable's API rejected it before it left, e.g. `invalid_email`, `domain_not_verified`).
- `handle-email-suppression` already exists as a webhook receiver from Lovable Emails for `bounce` / `complaint` / `unsubscribe`. **But** it only writes to `email_send_log` (a table that doesn't exist in this project) and `suppressed_emails`. It never marks the matching `sent_emails` row as `bounced` / `complained`.
- That's why `bounced = 0` everywhere. The data isn't being captured into the table Analytics reads from.

### Changes
- **DB migration**: add columns to `sent_emails`:
  - `bounced_at timestamptz`, `bounce_type text` (`hard` / `soft` / `complaint`)
  - `complained_at timestamptz`
  - allow new statuses: `bounced`, `complained` (plus existing `queued`, `sent`, `failed`).
  - Add an index on `message_id` (used by webhook lookup).
- **Rewrite `handle-email-suppression`** so when it receives a Lovable Emails event, it:
  1. Upserts into `suppressed_emails` (already does).
  2. Updates the matching `sent_emails` row by `message_id`: sets `status = 'bounced' | 'complained'`, stamps the timestamp, fills `error_message` with the provider reason.
  3. Falls back to matching by `recipient_email` (latest row) when `message_id` isn't present.
- **Confirm webhook is wired**: I'll check `email_domain--check_email_domain_status` and the Lovable Emails dashboard config so the webhook URL actually points at this function. If not, surface that as the blocker before deploying.
- **Analytics fix** (`useAnalytics.ts` + `KpiCards.tsx`):
  - Split the KPIs into:
    - **Sent** = `status in ('sent','bounced','complained')` (i.e. actually left the building)
    - **Failed (not sent)** = `status = 'failed'` — new card, replaces today's misleading "bounced = failed" lump
    - **Bounced** = `status = 'bounced'` only — true bounce rate over Sent
    - **Complaints** = `status = 'complained'` (small card / under bounce)
  - `bounceRate = bounced / sent` (not `/sent+failed`)
  - Same change in `VolumeTrendChart` + `SenderTable` so the per-sender breakdown matches.

### What you'll see after
- A **Failed** card showing the 17/13/etc. addresses Lovable refused (today's "bounced").
- A **Bounced** card that's accurate (currently 0, will populate as real bounces come in from receiving MTAs).
- A **Complaints** card for spam-marks.

---

## 2. Change the contact list on an existing sequence

### What's there today
- `Sequences.tsx`: list is only set on creation; there's a Pencil button that just renames.
- `SequenceCanvas.tsx`: the Trigger node has a `contact_list_id` config — editing it there already updates the sequence, but it's not obvious and there's no re-enrollment.

### Changes
- In `Sequences.tsx` row actions, add **"Change list"** action → dialog with the same list dropdown used at creation.
- On save:
  - Update `sequences.contact_list_id` AND the Trigger node's `config.contact_list_id` so both stay in sync.
  - Show a confirm step: "This will not unenroll contacts already in the sequence. New contacts from the new list will be enrolled on the next tick. Continue?"
  - Do NOT auto-delete existing enrollments (safer default). Offer a separate "Pause and clear pending enrollments" toggle inside the dialog for when you want a clean swap.
- Re-uses the existing `enroll-contacts` edge function for the new list — no backend change needed.

---

## 3. Audit replies + unsubscribe routing

This is verification work, not a code change unless I find a problem. I'll:

1. **Confirm reply addresses** are what you expect:
   - foremp.eu, foremp.one, foremp.email → `eric@foremp.se`
   - botlio.email, botlio.eu, botlio.io → `eric@botlio.io`
   - Send-cold-email uses `domainRow.reply_to_email` and passes it as `reply_to` to Lovable Emails — verified in code. So replies will go to those mailboxes.
2. **Open question for you**: do `eric@foremp.se` and `eric@botlio.io` actually exist as real receiving mailboxes you check? I can't test that from here. I'll send a probe email to each and ask you to confirm receipt + reply, and we'll trace the round trip.
3. **Unsubscribe routing**:
   - Lovable Emails injects the visible unsubscribe link (we pass `unsubscribe_token`).
   - When clicked, Lovable POSTs to `handle-email-suppression` with `reason: 'unsubscribe'` → adds to `suppressed_emails`. We'll confirm the 2 foremp unsubscribes are present in that table (they should be).
   - Gap: we don't currently mirror them into `do_not_contact` for the user, so the per-user "unsubscribed" count in Analytics may be off. Fix: in `handle-email-suppression`, also insert into `do_not_contact` for every `user_id` who's ever emailed that address (looked up from `sent_emails`). Small additional change.
4. **Reply tracking**: `sent_emails.replied_at` is currently never written. Replies go straight to your real mailbox — that's fine — but the dashboard will always show 0 replies. Two options:
   - **(a)** Leave it (you read replies in Gmail/whatever, dashboard is just for sends). Recommended for now.
   - **(b)** Wire a Lovable Emails inbound webhook to stamp `replied_at`. Bigger change, can do later.
   I'll default to **(a)** and add a small footnote on the Replied KPI: "tracked via reply webhook — not enabled" so it's not mistaken for "no replies".

---

## Technical changes summary

**DB migration**
- `sent_emails`: add `bounced_at`, `complained_at`, `bounce_type`; allow new status values.
- Index `sent_emails(message_id)`.

**Edge functions**
- `handle-email-suppression`: rewrite to update `sent_emails` by `message_id`/email, drop the broken `email_send_log` insert, also insert into `do_not_contact` per affected user.

**Frontend**
- `useAnalytics.ts`: split bounced vs failed; add complained.
- `KpiCards.tsx`: 7 cards (Sent, Delivered, Failed, Bounced, Complaints, Replied, Unsubscribed) — Replied marked as "tracking off".
- `Sequences.tsx`: "Change list" action + dialog.

**Verification (no code, just findings reported back to you)**
- Confirm Lovable Emails webhook URL points at `handle-email-suppression`.
- Confirm `eric@foremp.se` and `eric@botlio.io` receive a probe email + that replies show up there.
- Confirm 2 existing foremp unsubscribes are in `suppressed_emails`.

---

## What I need from you to start
- Approve the plan.
- Confirm: do you want me to send the two test/probe emails (one to each reply mailbox) as part of the audit? (Y/N — default Y.)
