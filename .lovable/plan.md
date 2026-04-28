## What I found

I checked the database, the cron job, the `run-sequences` edge function, and the actual sent emails for the "Sista text" sequence. Here's what really happened:

### The emails DID send last night — just at the wrong time

All 3 contacts received both emails:

| Contact | First email | Follow-up | Subject |
|---|---|---|---|
| kontakt@foremp.se | 22:18 Stockholm | 23:20 Stockholm | "Are you missing potential buyers visiting your website?" → follow-up: "Re: Lovable send test after unsubscribe fix" |
| darkness34518@outlook.com | 22:18 Stockholm | 23:20 Stockholm | "Are you missing potential buyers..." → follow-up: "Re: Test av första mail" |
| maxandersson782@gmail.com | 22:18 Stockholm | 23:20 Stockholm | "Are you missing potential car buyers..." → follow-up: "Re: Test av första mail" |

So nothing was missing this morning at 05:00 — the sequence had already completed last night, and all enrollments are now `status: completed`.

### Three real bugs

**Bug 1 — Schedule node fires immediately if "now" is past the slot**

The schedule node logic in `run-sequences/index.ts` (line 520) says:
> "If today is allowed AND current Stockholm time ≥ configured slot → advance NOW."

When we reset enrollments yesterday with `next_send_at = now()`, the cron picked them up at 22:18, the schedule saw "Mon allowed, 22:18 ≥ 05:00 → go" and fired immediately. That's why the first email went out at 22:18 instead of waiting for 05:00 the next morning.

A schedule like "Mon–Fri 05:00" should mean **send at 05:00**, not "send any time after 05:00".

**Bug 2 — Follow-up subject pulls the OLDEST sent email's subject (often a stale test)**

The follow-up subject lookup (line 358–365) does:
```
.order('sent_at', { ascending: true }).limit(1)
```
That returns the **first ever** sent email for the enrollment — which for these enrollments is from old test runs back on April 22 ("Test av första mail"). That's why the follow-up subject was wrong, even though the AI generated a good new subject ("Are you missing potential buyers…") for the actual first email of this run.

**Bug 3 — `current_node_id` after completion points at the wait/follow-up node**

When the sequence completes, `current_node_id` is left on the last processed node. If we naively re-activate the enrollment, the next tick resumes mid-sequence and re-sends only the follow-up. We must explicitly point it back to the schedule node.

---

## Plan

### 1. Fix the schedule node — only fire within a 30-minute window of the slot

In `supabase/functions/run-sequences/index.ts` (around line 520), change the condition:

- **From:** `if (dayAllowedToday && nowStockholmMins >= slotMins)` → advance now
- **To:** `if (dayAllowedToday && nowStockholmMins >= slotMins && nowStockholmMins < slotMins + 30)` → advance now; otherwise fall through to "wait until next valid slot"

Effect: a "Mon–Fri 18:00" schedule will only ever fire between 18:00 and 18:30 Stockholm time. If reset at any other time, it correctly defers to the next 18:00.

### 2. Fix follow-up subject lookup

Change the prior-subject query (line 358–365) to:
- Filter out subjects starting with `Re:` (so we don't pick a previous follow-up)
- Order by `sent_at DESC` and take the most recent
- Only consider sends with `sent_at >= enrollment.created_at` (or `updated_at` after the last reset) so old test runs are ignored

This guarantees the follow-up uses the subject of the actual first email it just sent.

### 3. Reset the 3 enrollments for tonight 18:00 Stockholm

Migration:
- Set the schedule node `time_of_day` to `18:00` (keep Mon–Fri).
- Re-activate the 3 enrollments, point `current_node_id` back to the **schedule node**, clear `last_sent_at`, `attempt_count`, errors, and set `next_send_at = now()`.

With fix #1 in place, the schedule node will see "now is past 18:00 today? if not, wait for today 18:00; if yes, wait for tomorrow 18:00." Since today is Tuesday and we'll reset before 18:00, they'll fire tonight at 18:00 with the follow-up exactly 1 hour later at 19:00.

```sql
UPDATE public.sequence_nodes
SET config = jsonb_set(config, '{time_of_day}', '"18:00"')
WHERE id = 'ba6d8a4d-ed42-42ed-aa7a-7d2a0696b998';

UPDATE public.enrollments
SET status = 'active',
    current_node_id = 'ba6d8a4d-ed42-42ed-aa7a-7d2a0696b998', -- schedule node
    next_send_at = now(),
    last_sent_at = NULL,
    attempt_count = 0,
    last_error = NULL,
    error_at = NULL,
    deferred_at = NULL
WHERE sequence_id = '16296d69-40a7-49b6-bfea-eebc9b18e18c'
  AND id IN (
    '8361e7ca-6085-490f-8388-c35e1de342d9',
    'b6e18ede-4baa-4e01-a545-38292ea51df9',
    'a4c61bec-2e99-48ac-ab66-19f67d6c901f'
  );
```

### 4. Deploy and verify

Redeploy `run-sequences`. Within 1 minute the schedule node will defer the 3 enrollments to **tonight 18:00 Stockholm**. First emails fire at 18:00, follow-ups at 19:00, each with a correct AI-generated subject and matching `Re: <same subject>` follow-up.

---

## Files changed

- `supabase/functions/run-sequences/index.ts` — schedule grace window + follow-up subject lookup
- New SQL migration — schedule slot to 18:00 + reset the 3 enrollments to the schedule node

After approval, I'll apply both changes and redeploy.