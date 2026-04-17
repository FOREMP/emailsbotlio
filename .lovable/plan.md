

## Botlio Email — AI-Personalized Cold Outreach

Replaces the ReviewBrain plan. Internal tool first (just you), but built so it scales to multi-tenant later.

### Email-sending choice

**Lovable Email** (built-in transactional infra) — not Resend.
- You verify your own sender domain (e.g. `botlio.email`) via Lovable's domain setup dialog
- Queue + retry + rate-limit handling built-in (~120 emails/min default, tunable)
- One-click unsubscribe links built-in (`email_unsubscribe_tokens` + `handle-email-unsubscribe`)
- Suppression list built-in (`suppressed_emails` blocks bounces/complaints/unsubscribes automatically)
- Free at your scale, scales to thousands/day without changing providers

This is exactly what your n8n SMTP setup did — just managed.

### Core concepts (mapped from your n8n flow)

| n8n concept | Botlio Email equivalent |
|---|---|
| Google Sheet of leads | `contact_lists` + `contacts` (already exist, reuse FileImportDialog) |
| Custom columns (Företag, Hemsida) | `contacts.custom_fields` JSONB (already exists) |
| Multiple senders (Eric/Isak rotating) | `senders` table — name + email alias on your verified domain |
| AI prompt per email | `sequence_steps.ai_prompt` (per step, fully editable) |
| Sequence (Day 0, Day 3, Day 7…) | `sequences` + ordered `sequence_steps` with `delay_days` |
| Status / Next_Followup_Date | `enrollments` (one row per contact-in-sequence) tracks current step + next send time |
| Do_Not_Contact | Global `suppressed_emails` (auto) + per-contact `do_not_contact` flag |
| Random delay + batching | pg_cron every 5 min picks due enrollments, send-cold-email function adds 5–60s jitter |

### Database (new tables)

- **`senders`** — id, user_id, from_email, from_name, reply_to, is_active. Multiple per user (Eric, Isak…). Round-robin rotation.
- **`sequences`** — id, user_id, name, contact_list_id, status (draft/active/paused), sender_rotation (array of sender_ids).
- **`sequence_steps`** — id, sequence_id, step_order, delay_days (0 for first), subject_template, ai_prompt, ai_model, use_ai (bool — if false, body_template is used as-is).
- **`enrollments`** — id, sequence_id, contact_id, current_step, next_send_at, status (active/paused/completed/replied/unsubscribed/bounced), last_sent_at. Unique on (sequence_id, contact_id) prevents double-enroll.
- **`sent_emails`** — id, enrollment_id, step_id, sender_id, subject, body, sent_at, message_id, opened_at, replied_at. Full history for the overview.
- **`do_not_contact`** — user_id, email (unique). Manual blocklist on top of Lovable's `suppressed_emails`.

All RLS-scoped to `user_id`.

### Edge functions (new)

1. **`generate-email`** — input: contact + step prompt + custom_fields. Calls Lovable AI (Gemini Flash, free). Returns `{ subject, body }`. Variables like `{{Företag}}` are interpolated into the prompt before AI generation.
2. **`enroll-contacts`** — input: sequence_id + contact_list_id. Creates enrollment rows for every non-suppressed, non-DNC contact. Sets `next_send_at = now()` for step 0.
3. **`send-due-emails`** — runs every 5 min via pg_cron. Picks enrollments where `next_send_at <= now()` and `status = 'active'`. For each: pick sender (round-robin), call `generate-email`, enqueue via `send-transactional-email` (Lovable's queue handles delivery + unsubscribe link injection), log to `sent_emails`, advance to next step or mark completed.
4. **Reuse `send-transactional-email`** — Lovable's built-in. Handles queue, retries, suppression check, unsubscribe footer.

### Pages

- **`/` Landing** — rebrand "Botlio Email — AI cold outreach that doesn't suck."
- **`/contacts`** — already exists. Reuse FileImportDialog (already auto-detects email/phone/name and treats Företag/Hemsida etc. as custom variables).
- **`/senders`** — manage Eric, Isak, etc. Show domain verification status (links into Lovable Cloud → Emails dialog).
- **`/sequences`** — list sequences. Create/edit a sequence: pick contact list, pick rotating senders, define steps (subject + AI prompt + delay). Live variable picker shows `{{first_name}}`, `{{email}}`, plus all custom columns from the chosen list.
- **`/sequences/:id`** — detail view: enrolled count, sent count, reply rate, per-step stats. Enroll button. Pause/resume.
- **`/outbox`** — global feed of every email sent (who, when, sender, subject, preview, status). Searchable. This is your "overview of all people I have sent."
- **`/dashboard`** — sequences active, emails sent today/week, reply rate, top performing prompt.

### Anti-spam / unsubscribe

- Every email gets Lovable's automatic unsubscribe footer + `List-Unsubscribe` header (one-click, RFC-compliant).
- Unsubscribe writes to `suppressed_emails`; future sends to that address are auto-blocked across all sequences.
- Before enrolling: skip if email is in `suppressed_emails`, `do_not_contact`, or already in any active enrollment for the same user (prevents the "spam same person twice" case).
- Send pacing: 5–60s random jitter + Lovable's queue rate-limits = inbox-friendly.

### Phases

**Phase 1 — Rebrand + foundation**
1. Rebrand UI to Botlio Email (landing, header, dashboard)
2. Migration: senders, sequences, sequence_steps, enrollments, sent_emails, do_not_contact
3. `/senders` page + Lovable Email domain setup dialog trigger

**Phase 2 — Sequences & sending**
4. `/sequences` list + create/edit (steps, prompts, variable picker)
5. `generate-email` edge function (Lovable AI)
6. `send-due-emails` edge function + pg_cron (every 5 min)
7. Enroll flow from a contact list

**Phase 3 — Visibility**
8. `/outbox` global feed
9. Dashboard stats
10. Per-sequence detail view

### Files to create/modify

| File | Action |
|---|---|
| `.lovable/plan.md` | Replace with this plan |
| Migration SQL | senders, sequences, sequence_steps, enrollments, sent_emails, do_not_contact + RLS |
| `src/pages/Index.tsx` | Rebrand to Botlio Email |
| `src/pages/Senders.tsx` | New |
| `src/pages/Sequences.tsx`, `SequenceEditor.tsx`, `SequenceDetail.tsx` | New |
| `src/pages/Outbox.tsx` | New |
| `src/pages/Dashboard.tsx` | Rewrite for outreach metrics |
| `supabase/functions/generate-email/index.ts` | New |
| `supabase/functions/send-due-emails/index.ts` | New |
| `supabase/functions/enroll-contacts/index.ts` | New |
| Email infra | Triggered automatically when you set up sender domain |

### Prerequisite for sending

You'll need to set up your sender domain (`botlio.email`) inside the app — a one-time DNS step (a few records at your registrar). Lovable handles SPF/DKIM/MX automatically. Until DNS verifies, sequences can be built but actual sending is paused.

### Phase 1 starts now

After approval, I'll: rebrand to Botlio Email, run the migration for the new tables, build `/senders` with the domain setup trigger. Then we move to Phase 2.

