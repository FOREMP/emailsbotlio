

## Plan: Fix sequence execution so emails actually send at scheduled time

### Root cause
After investigating `run-sequences/index.ts` and the cron logs, the issue isn't that the worker is broken — logs show it runs every minute and finds `0 due enrollments`. The real problem is in how enrollments get created and advanced:

1. **`enroll-contacts` likely sets `current_node_id` to the trigger node, but `next_send_at` may be `NULL`** — that part is fine, the query handles `next_send_at IS NULL`. So contacts ARE picked up.
2. **However, `current_node_id` stored on enrollments often points to a "ghost" trigger** from previous canvas edits (see prior fix history — orphaned nodes existed). When the worker calls `findNodePreferWired`, it can't find the node and marks the enrollment `failed`.
3. **The schedule node has a critical bug**: when the slot time has already passed today AND today is not in `allowedDays`, the candidate jumps to tomorrow but then the loop walks forward 8 days. If `allowedDays` is empty in DB but the UI defaults to specific days, contacts get pushed forever.
4. **Send-email node may defer indefinitely**: if no senders exist for the user (or none match the brand filter), `preSenderId` stays null and the enrollment is deferred to tomorrow midnight UTC — every single day. User sees "nothing happens".
5. **No visibility**: the user has no way to see WHY a sequence is stuck. There's no UI showing enrollment status or last error.

### Changes

**1. Fix enrollment creation (`enroll-contacts/index.ts`)**
- Always resolve `current_node_id` to a REAL, currently-existing node in `sequence_nodes` (the trigger that has an outgoing edge). Never trust stale ids.
- Set `next_send_at = now()` so the worker picks them up immediately.
- Skip contacts already in `do_not_contact` / `suppressed_emails` at enroll time.
- Skip duplicates (existing active enrollment for same contact+sequence).

**2. Harden the worker (`run-sequences/index.ts`)**
- When `current_node_id` doesn't resolve, RECOVER by re-resolving to the sequence's trigger node instead of marking `failed`.
- **Schedule node fix**: when `allowedDays` is empty, treat as "every day" everywhere (currently inconsistent). Add a hard cap: if candidate is more than 8 days out, log + mark enrollment `failed` with reason instead of looping.
- **Send-email no-sender fix**: if user has zero active senders at all, mark enrollment `failed` with a clear error (not deferred forever). Only defer when senders exist but are at daily cap.
- Write the failure reason to a new `last_error` column on `enrollments`.

**3. Add `last_error` column + status visibility**
- Migration: add `enrollments.last_error text` and `enrollments.error_at timestamptz`.
- Update worker to populate these on every failure / defer reason.

**4. Sequence detail page — show enrollment health**
- On `Sequences.tsx` (or sequence detail), show counts: active / completed / failed / unsubscribed, plus a "Recent issues" list pulling `last_error` from the most recent 10 stuck enrollments.
- Add a "Run now" button that invokes `run-sequences` on demand so the user doesn't have to wait for the next cron tick.

**5. Verify cron is actually scheduled**
- Confirm the pg_cron job for `run-sequences` exists and runs every minute. Logs show it IS running, so this is just a verification step — no change unless missing.

### Files touched
- `supabase/functions/enroll-contacts/index.ts`
- `supabase/functions/run-sequences/index.ts`
- `src/pages/Sequences.tsx` (status counts + Run now button)
- New migration: add `last_error`, `error_at` columns to `enrollments`

### Validation
- Create sequence → trigger → schedule (today, in 2 min) → send_email → publish.
- Enroll contacts → within 1 min after the schedule time, the email should send.
- If no senders exist, the sequence detail page shows "0 active senders — emails can't send" instead of silent failure.
- If a node is misconfigured, `last_error` shows the reason on the page.

