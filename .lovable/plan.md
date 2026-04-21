
# Fix Sequence Crashes Between Throttle, Sender Caps, and Wait Nodes

## The Problem

When publishing a sequence with multiple emails separated by Wait nodes and limited by Throttle nodes + per-sender daily caps, the second email sometimes never sends. The whole enrollment effectively "crashes" silently — no error surfaces to the UI, and the contact is stuck mid-sequence.

## Root Causes Found in `run-sequences`

1. **Throttle counts are spent on failures.** The throttle node inserts a `throttle_pass` row and advances *before* the email is actually attempted. If the next step (send_email) fails, defers to a sender cap, or errors, that throttle slot is gone for the day. After a few failures the daily quota is fully "used" with zero emails sent.

2. **Sender daily-cap defers are silent.** When all senders are at their cap, the enrollment is pushed to next UTC midnight with no UI feedback. Looks like a crash.

3. **Send failures back off only 5 minutes but never retry-bound.** Repeated transient failures from `send-cold-email` (no verified domain, generate-email failure, 502s) loop indefinitely. There is no failure counter and no terminal "give up" state — and they keep eating throttle slots upstream.

4. **Wait → Throttle → Send chain has no atomic step.** The runner processes one node per tick. After Wait expires, the next tick hits Throttle (consumes slot), the tick after hits Send. If Send fails, throttle slot already burned. The two operations are not coupled.

5. **`last_sent_at` is set to `nowIso` after send; the next-tick selection prefers rows where `last_sent_at IS NOT NULL`.** Fine in isolation, but combined with the 5-minute back-off on failure, a failing enrollment monopolises Pass A and starves new enrollments.

6. **No per-enrollment error counter / max attempts.** `last_error` is overwritten each tick; nobody knows how many times this has retried.

## The Fix

### 1. Throttle node: count *successful sends downstream*, not passes
Change the throttle node to look at actual `email_sent` activities from `contact_activity` for this sequence on the same day, instead of inserting a `throttle_pass` row up front. The slot is only "consumed" when an email actually went out. This removes the desync between throttle accounting and reality.

### 2. Couple throttle + send into one tick
When the runner hits a `throttle` node and the next downstream node is `send_email` (directly, or after a fixed pass-through), evaluate the throttle and immediately attempt the send in the same iteration. If the send fails or the sender cap blocks, *do not* count the throttle slot.

### 3. Add `attempt_count` and terminal failure on enrollments
Add an `attempt_count` integer column on `enrollments`. Increment on each send failure. After N attempts (e.g. 5) mark `status = 'failed'` with a clear `last_error`. This stops infinite loops and surfaces real failures to the UI.

### 4. Surface sender-cap defers as a visible state
When all senders are at the daily cap, set a new `enrollments.status = 'waiting_capacity'` (or keep `active` but expose `deferred_at` + `last_error` clearly in the Sequences UI). Add a small banner/badge in the sequence detail page: "X contacts paused — sender daily cap reached, will resume tomorrow."

### 5. Reset `attempt_count` and clear `deferred_at` after a successful send
So that natural progress through Wait → Send → Wait → Send doesn't carry stale failure state forward.

### 6. Fix Pass A query
The `.or('last_sent_at.not.is.null,deferred_at.not.is.null')` is layered on top of another `.or()` for `next_send_at`, which produces an OR-of-ORs that may not be what we want. Rewrite into a single explicit filter so follow-ups are deterministically prioritised.

### 7. Add structured logging at every decision point
Each defer/skip/failure logs `enr_id`, `node_type`, `reason`, `next_send_at`. Makes future debugging instant from the edge logs.

## What the User Will See

- Publishing a sequence with throttle + wait + multiple sends now reliably delivers email 2, 3, … even when senders are tight.
- Sequence detail page shows a clear count of contacts in three buckets: **Active**, **Paused (waiting capacity)**, **Failed**.
- Hovering "Paused" tells you which sender(s) hit their cap and when they resume.
- Failed enrollments show the actual error after 5 attempts instead of silently looping.

## Technical Implementation Summary

- **Migration**: add `attempt_count integer NOT NULL DEFAULT 0` to `enrollments`; allow `status = 'waiting_capacity'`.
- **`run-sequences/index.ts`**: rewrite throttle branch to count `email_sent` activities; couple throttle → send in one tick; add attempt counter and terminal-fail logic; reset counters on success; rewrite Pass A query.
- **`Sequences.tsx`** (and/or sequence detail page): show Paused / Failed counts and reason tooltips.
- **Redeploy** `run-sequences` after edits.

## Out of Scope (Confirm If You Want These Too)

- Switching to a durable queue (pgmq) for sends — bigger refactor; current edge-function approach is fine once the above bugs are fixed.
- Per-sequence concurrency caps independent of per-sender caps.
