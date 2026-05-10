# Reduce Supabase Disk IO Usage

## Why this is happening

You're on the **Nano** compute tier (43 Mbps baseline). Once your Daily Disk IO Budget burns out, the database throttles to baseline — that's why login times out, queries hang, and even the dashboard's own SQL editor returns "connection timeout". This is **not** a code bug in auth; auth simply can't talk to a saturated DB.

Two things are silently chewing through IO 24/7, even when you're not sending email:

### 1. `run-sequences` cron runs **every single minute, forever**
Every minute, the cron job `run-sequences-every-minute` invokes the `run-sequences` edge function. That function:
- Always queries `sending_domains`
- Always queries `enrollments` (twice — pass A and pass B)
- For each due enrollment runs 6–10 more queries (`sequence_nodes`, `sequence_edges`, `contacts`, `do_not_contact`, `suppressed_emails`, `senders`, `sent_emails`, plus repeated `enrollments` updates)

That's **1,440 ticks/day × multiple table scans = the bulk of your IO**, even when zero emails are being sent.

### 2. Dashboard / Analytics issue many `count: 'exact'` queries
`Dashboard.tsx` fires 6 parallel `count: 'exact'` queries on every visit (contacts, contact_lists, senders, sequences, sent_emails, imported_files). On Postgres, `count(*) exact` is a full table scan — very IO-heavy as tables grow. `useAnalytics.ts` does similar broad selects.

### 3. Other contributors (smaller but real)
- `email_send_log` is append-only and grows forever — scans get slower over time
- `auth_logs` / `postgres_logs` / `function_edge_logs` retention
- Possible missing indexes on `enrollments(status, next_send_at, last_sent_at)` and `sent_emails(sender_id, created_at)`

---

## Plan to fix it

### Step 1 — Slow down `run-sequences` dramatically (biggest win)
Change the cron from `* * * * *` (every minute) to `*/10 * * * *` (every 10 min). Email cadence is measured in hours/days, so this changes nothing user-visible but cuts that workload by **10×**.
Also add an early-exit: if `enrollments` has no due rows, skip all downstream queries.

### Step 2 — Replace `count: 'exact'` with cheap estimates
- Dashboard counts → use `count: 'estimated'` (reads `pg_class.reltuples`, no scan), or cache in a tiny `dashboard_stats` table refreshed hourly.
- `useAnalytics` → same treatment, plus add a 60s React Query cache so revisits don't refetch.

### Step 3 — Add indexes on the hot paths
```text
enrollments (status, next_send_at)
enrollments (status, last_sent_at)
sent_emails (sender_id, created_at)
sent_emails (created_at)         -- for analytics windows
contact_activity (enrollment_id, created_at)
```
Indexes turn full table scans into index seeks — huge IO reduction.

### Step 4 — Trim log/append-only growth
- Add a weekly cron that deletes `email_send_log` rows older than 30 days (you only need recent history for debugging).
- Same for `contact_activity` older than 90 days if you don't need it long-term.

### Step 5 — Kill the redundant daily keep-alive cron
`keep-alive-daily` exists to stop a free-tier project pausing. You're way past that — the project is active 24/7 from real traffic. Remove it; one less moving part.

### Step 6 — Verify and (optionally) bump compute later
After steps 1–4, watch the "Disk IO consumed per day" chart for 24h. If it drops below ~50%, you're safe to stay on Nano. If it's still pegged, the next step is upgrading to **Micro** (the cheapest tier with much higher baseline IO) — but I expect steps 1–4 alone will fix it.

---

## Technical details (for the next build step)

Files I'll change:
- `supabase/migrations/<new>.sql`
  - `cron.unschedule('run-sequences-every-minute')` then re-schedule at `*/10 * * * *`
  - `cron.unschedule('keep-alive-daily')`
  - `CREATE INDEX IF NOT EXISTS` statements listed above
  - New cron: nightly `DELETE FROM email_send_log WHERE created_at < now() - interval '30 days'`
- `supabase/functions/run-sequences/index.ts`
  - Early-return if pass A + pass B return zero rows (skip domain query too by reordering)
- `src/pages/Dashboard.tsx`
  - Switch the 6 `count: 'exact'` to `count: 'estimated'`
  - Wrap in React Query with `staleTime: 60_000`
- `src/hooks/useAnalytics.ts`
  - Add `staleTime` and replace any `count: 'exact'` with `'estimated'`

No schema-breaking changes, no impact on email sending behavior beyond a max ~10-minute delay before a sequence step fires.

## Expected outcome
Disk IO drops well under your daily budget → DB stops throttling → login works instantly → dashboards load fast.
