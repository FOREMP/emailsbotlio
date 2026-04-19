

## Plan: Email footer + unsubscribe enforcement

### 1. Branded footer on cold emails
Update `supabase/functions/send-cold-email/index.ts`:
- Derive brand name from sender domain (e.g. `foremp.eu` → `FOREMP`) by taking the part before the first `.` and uppercasing it. Look up `sending_domains.brand` first if present, otherwise fall back to that derivation.
- Append a footer block to both `text` and `html` versions before sending:
  ```
  Best regards,

  {sender.from_name}

  {BRAND}
  ```
- HTML version uses `<br>` line breaks with the same plain styling as `plainToHtml`.
- Footer is inserted BEFORE the system unsubscribe footer (which is auto-appended by Lovable email).

### 2. One-click unsubscribe → DNC list
Update `supabase/functions/handle-email-unsubscribe/index.ts`:
- On successful POST (token confirmed), in addition to marking the token used and adding to `suppressed_emails`, also insert the email into `do_not_contact` for the original sending user.
- To find the right `user_id`: look up the most recent `sent_emails` row matching `recipient_email = token.email` and use its `user_id`. If multiple users sent to the same address, add them all (loop over distinct user_ids).
- Insert into `do_not_contact` with `reason: 'unsubscribed_via_email'`.

The current `Unsubscribe.tsx` page already shows a "Confirm unsubscribe" button — no UI changes needed.

### 3. Stop in-flight sequences after unsubscribe
Update `supabase/functions/send-cold-email/index.ts`:
- The DNC check already exists at the top of the function. Confirmed it blocks sends. ✓
- Also update `supabase/functions/run-sequences/index.ts` (the cron worker) to skip/cancel enrollments where the contact's email is in `suppressed_emails` or `do_not_contact` for that user — mark `enrollments.status = 'unsubscribed'` so they stop being processed entirely instead of being checked every cycle.

### 4. Warn on re-import of DNC contacts
Update `src/components/FileImportDialog.tsx` and `src/pages/Contacts.tsx`:
- After the file is parsed, query `do_not_contact` for the current user where `email` is in the parsed list.
- If matches exist, show a confirmation dialog listing the matched emails with two options:
  - **Skip these contacts** (default) — filters them out of the import
  - **Import anyway** — proceeds with all rows
- Add an "Autopilot" toggle (persisted in localStorage as `autopilot_skip_dnc`) — when on, automatically skip without prompting and show a toast `"Skipped N unsubscribed contacts"`.

### 5. Files touched
- `supabase/functions/send-cold-email/index.ts` — footer
- `supabase/functions/handle-email-unsubscribe/index.ts` — DNC insert
- `supabase/functions/run-sequences/index.ts` — cancel enrollments on unsubscribe
- `src/components/FileImportDialog.tsx` — DNC pre-check + warning UI + autopilot toggle
- `src/pages/Contacts.tsx` — pass user id / wire autopilot toggle if needed

No DB schema changes — `do_not_contact`, `suppressed_emails`, and `email_unsubscribe_tokens` already exist.

### Validation
- Send a test email → footer reads `Best regards, {sender name}, {BRAND}`.
- Click unsubscribe link → confirm → email lands in both `suppressed_emails` and your account's `do_not_contact`.
- Verify a contact mid-sequence stops receiving further emails after unsubscribing.
- Re-import a CSV containing the unsubscribed email → warning dialog appears; with autopilot on, it's silently skipped.

