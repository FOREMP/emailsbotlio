# Fix queue filtering and make stop/unsubscribe actually stick

Two separate problems, confirmed in the code:

## 1. The status filter only looks at a small slice of the queue

The Demo Outreach page loads the 200 most recently updated companies and nothing
more. The search box does query the whole sequence, but the status dropdown
("Stoppade / avregistrerade", "Aktiva", etc.) only filters those 200 rows in the
browser. So when you pick "Stoppade / avregistrerade" you see a handful, even
though many more exist — exactly what you noticed.

**Fix:** when a status is selected, ask the database for companies with that
status across the whole sequence instead of filtering what happens to be loaded.

- Selecting a status runs its own query (status match, newest first, up to 500
  rows), so the list is complete, not a leftover slice.
- Show the real total next to the filter ("visar 37 av 37") so it's obvious
  nothing is hidden.
- Search + status combine: searching narrows within the chosen status.
- Add the missing statuses to the dropdown so nothing is invisible: failed and
  deferred/paused rows currently belong to no filter option.

## 2. Unsubscribing does not remove a company from the queue

When someone unsubscribes, the handler only cancels enrollments whose status is
exactly `active`. Companies sitting in `waiting_capacity` (the normal state
while waiting for daily sending capacity) or deferred keep sitting in the queue
looking like they'll be mailed. The send loop does catch them later and stops
the email, but until then the queue is wrong and you go in and stop them by
hand.

**Fix in the unsubscribe handler:**
- Cancel every still-open enrollment for that address (`active`,
  `waiting_capacity`, `deferred`, anything not already completed/stopped), not
  just `active`.
- Match the address case-insensitively everywhere, so `Info@Firma.se` and
  `info@firma.se` are the same person.
- Also record a do-not-contact entry when the address exists as a contact but
  has never been emailed yet, so a never-contacted unsubscriber can't be
  enrolled later.
- Mark the matching lead so it isn't rebuilt/re-approved for outreach.

**Same fix in the bounce/complaint handler** (`handle-email-suppression`), which
has the same narrow status handling — a spam complaint should empty the queue
row immediately too.

## 3. Manual "stop" behaves like an unsubscribe

Today the stop button only flips the queue row to stopped. If you stop someone
because they asked you to, they can still be picked up by a future import or
another sequence. Add the address to the do-not-contact list when you stop it
manually, so it's permanent.

## Verification

- Load the page, pick "Stoppade / avregistrerade", confirm the count matches the
  "Stoppade" stat card at the top of the page.
- Run one real unsubscribe against a test row and confirm the company disappears
  from the active queue immediately, with no manual stop needed.
- Confirm a company that is waiting for capacity also disappears when it
  unsubscribes.

## Technical notes

- `src/pages/SiteOutreach.tsx`: replace the client-side `filteredEnrollments`
  memo with a status-scoped Supabase query (`.eq("sequence_id")` +
  `.in("status", [...])`, `count: "exact"`), keyed on `queueStatus`, merged with
  the existing search path; keep the 20/page client pagination over the fetched
  set.
- `supabase/functions/handle-email-unsubscribe/index.ts`: change the enrollments
  update from `.eq('status','active')` to
  `.in('status', ['active','waiting_capacity','deferred','paused'])`; derive
  affected users from `contacts` as well as `sent_emails`; update
  `site_leads.status`/`auto_send` for the matching email.
- `supabase/functions/handle-email-suppression/index.ts`: apply the same
  enrollment status set.
- Manual stop in `SiteOutreach.tsx` additionally upserts `do_not_contact`.
- No schema changes.
