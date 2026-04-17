## Botlio Email — AI-Personalized Cold Outreach

Internal tool first (just you), built to scale to multi-tenant later. Replaces previous plans.

### Email infra
Lovable Email (built-in transactional). Verify sender domain via the in-app dialog. Queue + retry + rate-limit + one-click unsubscribe + suppression list all built-in.

### Core mapping (from n8n flow)
- Leads sheet → `contact_lists` + `contacts` (existing, FileImportDialog auto-detects custom columns into `contacts.custom_fields` JSONB)
- Multiple senders (Eric/Isak) → `senders` table, round-robin
- AI prompt per email → `sequence_steps.ai_prompt`
- Day 0/3/7 sequence → `sequences` + `sequence_steps.delay_days`
- Status / Next followup → `enrollments`
- Do_Not_Contact → `do_not_contact` + Lovable's `suppressed_emails`

### Tables (created)
senders, sequences, sequence_steps, enrollments, sent_emails, do_not_contact — all RLS-scoped to user_id.

### Edge functions (planned)
1. `generate-email` — Lovable AI, interpolates `{{variables}}` from custom_fields, returns {subject, body}
2. `enroll-contacts` — bulk enroll a contact list into a sequence, skipping suppressed/DNC/already-enrolled
3. `send-due-emails` — pg_cron every 5 min, picks due enrollments, rotates senders, calls generate-email, sends via `send-transactional-email`, advances step

### Pages
/ (landing), /contacts (existing), /senders, /sequences (+/:id editor & detail), /outbox, /dashboard

### Phases
- **Phase 1 (now)**: rebrand UI, migration ✅, /senders page + email domain setup trigger
- **Phase 2**: sequences + AI generation + cron sender
- **Phase 3**: outbox + dashboard analytics

### Anti-spam
Auto unsubscribe footer + List-Unsubscribe header. Pre-enroll filters: suppressed_emails, do_not_contact, existing active enrollment. 5–60s send jitter on top of Lovable's queue rate-limit.
