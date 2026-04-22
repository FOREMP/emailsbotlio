

# Audit of Your Sequence Scenario + Two Fixes

## Your Scenario, Step by Step

> Upload list → schedule 21:30 → send to 3 contacts → wait 30 min → send follow-up → if they unsubscribe in those 30 min, cancel → then End. Also: future sequences should skip already-contacted people.

Here's what works today and what doesn't.

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Schedule node fires at 21:30 (Stockholm) | ✅ Works | Time-zone aware, day-of-week filter works |
| 2 | First email sends to all 3 contacts | ✅ Works | Throttle + sender caps respected |
| 3 | Wait 30 minutes between emails | ✅ Works | `wait` node supports minutes |
| 4 | Unsubscribe during wait cancels the follow-up | ✅ Works | Every tick re-checks DNC + global suppression *before* processing the next node and sets enrollment to `unsubscribed` |
| 5 | End node closes the sequence cleanly | ✅ Works | Sets `completed` |
| 6 | Sending is recorded (audit trail) | ✅ Works | Rows in `sent_emails` + `contact_activity` (`email_sent`) per send |
| 7 | **A new sequence skips contacts already contacted before** | ❌ **NOT implemented** | Today only *unsubscribed* contacts are skipped. Anyone you previously emailed (but who didn't unsubscribe) WILL be emailed again from a new sequence |
| 8 | **Throttle + 30-min follow-up in same day** | ⚠️ **Bug for your exact setup** | Throttle counts all `email_sent` for the sequence today. With `max_per_day=3` and 3 contacts, the first 3 emails consume the whole daily quota → the 30-minute follow-ups get pushed to tomorrow |

So 5 of your 7 expectations work. Two need fixing.

---

## Fix 1 — Throttle Logic for Same-Day Follow-Ups

**Problem:** the throttle node counts every `email_sent` for the sequence per day. If you set `max_per_day = 3` to control the *initial* batch, the follow-up sends 30 minutes later trip the same cap and get deferred to tomorrow — the user sees this as "follow-up never sent."

**Fix:** scope the throttle count to **the specific throttle node** instead of the whole sequence. Each throttle gates only what flows through it. So a throttle in front of the first email allows 3 first-touches/day, and a separate (or absent) throttle on the follow-up branch is independent.

Implementation:
- In `run-sequences/index.ts`, change the throttle count query from `.eq('sequence_id', …)` to `.eq('node_id', currentNode.id)` so only `email_sent` activities tagged with that throttle's downstream send node (or, more simply, all sends triggered after passing *this specific* throttle) are counted.
- We already have `node_id` on `contact_activity` — we'll record the originating throttle id alongside the send node id, or count by the *send node fed by this throttle* (one DB roundtrip to look up the next send node from `sequence_edges`). Cleaner: add the throttle's id to the `email_sent` activity metadata when the email is sent through it, and count by that. Decision: **count `email_sent` rows whose `metadata->>'throttle_node_id'` equals the current throttle's id**. The runner stamps `throttle_node_id` into the `send-cold-email` invocation when it just passed a throttle in the same enrollment chain.

**Side benefit:** if you have multiple throttles in the same sequence (e.g., one per branch), each is independent.

**Documentation tweak in the UI:** small caption under the throttle node — "Limits sends through this node per day. Other throttles in the sequence are independent."

---

## Fix 2 — Cross-Sequence "Already Contacted" Skip

**Problem:** today, `enroll-contacts` only blocks duplicate enrollments **within the same sequence** and skips DNC/suppressed emails. It does NOT skip a contact who was successfully emailed by a *different* sequence.

**Fix:** during enrollment, also skip any contact who already has at least one `sent_emails` row for this user (status `sent` or `queued`). This makes "we've already contacted them once → don't contact again from a new sequence" the default.

Implementation in `supabase/functions/enroll-contacts/index.ts`:
1. After loading contacts and DNC, also load `sent_emails` for this user filtered to `recipient_email IN (contact emails)` and `status IN ('sent','queued')`.
2. Build a `previouslyContactedSet` of lowercased emails.
3. In the enrollment loop, skip contacts whose email is in that set, and count them in a new `already_contacted` bucket returned to the UI.
4. Surface this in the Sequences "Enroll" toast: e.g., *"Enrolled 12 — skipped 4 already-contacted, 1 suppressed."*

**Escape hatch (recommended):** add an optional checkbox in the enroll dialog "Allow re-contacting people we've emailed before" (default off). If checked, the new skip is bypassed for that enrollment only. This keeps the safe default while letting you re-engage on purpose.

---

## What Stays the Same

- Unsubscribe handling, schedule node, wait node, end node, send_email retry logic, sender caps, audit logging — all work as you expect, no changes.

## Files Touched

- `supabase/functions/run-sequences/index.ts` — scope throttle count to the throttle node; pass `throttle_node_id` to `send-cold-email`.
- `supabase/functions/send-cold-email/index.ts` — accept `throttle_node_id` and store it in the `email_sent` activity metadata.
- `supabase/functions/enroll-contacts/index.ts` — add `previouslyContactedSet` filter and `already_contacted` counter; honor optional `allow_recontact` flag from request body.
- `src/pages/Sequences.tsx` — surface `already_contacted` count in the enrollment toast; add the optional "Allow re-contacting" checkbox in the enroll dialog.
- Redeploy: `run-sequences`, `send-cold-email`, `enroll-contacts`.

## Out of Scope (ask if you want them too)

- Time-window cooldown ("skip if contacted in the last 90 days" instead of forever).
- Cross-user / org-wide contact-history sharing.
- A central "Contacted" log page combining `sent_emails` across sequences with filters.

