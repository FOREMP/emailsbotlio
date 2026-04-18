

## Problems found

### 1. Canvas changes don't persist
Looking at `SequenceCanvas.tsx` (need to verify), the canvas likely only saves on explicit "Save" action or not at all. Node config edits in the inspector probably only update local React state, never written back to `sequence_nodes.config`. Same for new nodes/edges added via palette.

### 2. No way to start a sequence (enroll contacts)
- `enroll-contacts` edge function exists but there's no clear UI button on the sequence page that says "Start sequence — enroll all contacts from list X".
- Without enrollments, the runner has nothing to process.

### 3. Send Email node is incomplete
Current config supports `mode: 'ai' | 'static'`, `subject`, `body`, `prompt`, `subject_hint`. But:
- **Variables** (`{{first_name}}`, `{{company}}`, custom_fields) are not interpolated in `send-cold-email` for the static path.
- **AI mode** passes `prompt` to `generate-email` but doesn't pass the contact's custom_fields / list columns as context, so personalization is weak.
- No preview of the rendered email in the inspector.

### 4. Missing/weak nodes for the follow-up flow
You said "send an email, then in a few days send another asking again". That requires:
- **Send Email** ✓ (exists)
- **Wait** ✓ (exists, but verify config UI works and persists)
- **Send Email** ✓ again (the same node type, second instance)
- **End** ✓ (exists)

So node types exist — but the canvas needs a clean default template "Cold outreach + 1 follow-up" so the user doesn't have to wire it from scratch every time.

### 5. "Noted as contacted" tracking
Already partially there: `sent_emails` row is inserted by `send-cold-email`, and `contact_activity` is written by Log Activity nodes. But:
- No automatic activity row on send (only if user manually adds a Log Activity node).
- No "last contacted" column on the Contacts page so the user can see it worked.
- No protection against re-enrolling the same contact in the same sequence (would double-send).

### 6. Runner edge cases
- If `next_send_at` is null on a fresh enrollment, runner picks it up immediately ✓.
- But `enroll-contacts` may not be setting `next_send_at = now()` and `current_node_id = trigger`. Need to verify.

---

## Plan

### A. Persistence (canvas saves reliably)
1. Add **autosave** to `SequenceCanvas.tsx`:
   - On every node drag-end, edge connect, node delete, or inspector config change → debounced 800ms upsert into `sequence_nodes` / `sequence_edges`.
   - Visible "Saved" / "Saving…" indicator in the canvas toolbar.
2. On canvas mount, load nodes+edges from DB (already done — verify and fix if not).

### B. "Start sequence" button + safe enrollment
1. On the sequence page header, add a **Start sequence** button that:
   - Asks user to pick a contact list (default: the one already linked to the sequence).
   - Calls `enroll-contacts` edge function with `sequence_id` + `list_id`.
2. Update `enroll-contacts` to:
   - Skip contacts already enrolled in this sequence (unique on `sequence_id + contact_id`).
   - Skip contacts in `do_not_contact`.
   - Set `current_node_id = <trigger node id>`, `next_send_at = now()`, `status = 'active'`.
3. Add a unique index `enrollments(sequence_id, contact_id)` to enforce this in DB.

### C. Variable interpolation in Send Email
1. In `send-cold-email`, before sending:
   - Build a context object: `{ first_name, last_name, email, company, ...contact.custom_fields }`.
   - Replace `{{var}}` tokens in both `subject` and `body` (static mode).
   - For AI mode, pass the same context to `generate-email` as structured input so the LLM can personalize properly.
2. In the Send Email inspector, show a small "Available variables" hint listing keys from a sample contact in the linked list.

### D. Auto-log every send
1. In `send-cold-email`, after a successful send, also insert a `contact_activity` row with `activity_type = 'email_sent'` and `metadata = { sender_id, subject, node_id }`. No need for a manual Log Activity node.
2. Update Contacts page to show a **"Last contacted"** column (max `sent_at` from `sent_emails` per contact).

### E. Default sequence template
When a new sequence is created, auto-seed the canvas with:
```text
[Trigger] → [Send Email #1] → [Wait 3 days] → [Send Email #2 (follow-up)] → [End]
```
User can then edit each node's content. Saves the "blank canvas" problem.

### F. Sequence detail page polish
- Show enrollment counts: Active / Completed / Failed.
- Show last 20 sent emails for this sequence (recipient, subject, sent_at, status).
- "Pause" / "Resume" sequence button (sets all enrollments status).

### G. Verify the runner end-to-end
- Confirm cron is running (query `cron.job` and recent `cron.job_run_details`).
- Manually invoke `run-sequences` once after enrolling a test contact and watch logs.

---

## How it will work after this is done

1. You open a sequence → canvas loads with the default `Trigger → Send → Wait 3d → Send → End` template.
2. You click each Send Email node, write your subject/body (or pick AI mode + a prompt), use `{{first_name}}` etc. — every keystroke autosaves.
3. You click **Start sequence**, pick a contact list. The system enrolls every contact in the list (skipping DNC + already-enrolled), sets `next_send_at = now()` on each.
4. Within 1 minute, the cron runs `run-sequences`, which for each enrollment:
   - Walks past the trigger
   - Calls `send-cold-email` → personalizes via variables/AI → sends from a rotated sender on the right domain → logs to `sent_emails` + `contact_activity`
   - Sets `next_send_at = now() + 3 days`, advances to the follow-up Send node
5. Three days later, runner fires the follow-up email automatically.
6. You see "Last contacted" on each contact, and an enrollment progress panel on the sequence page.

---

## Out of scope for this round
- Open/click/reply tracking (still no webhooks)
- Conditional branching on real engagement (Condition node still defaults to false)
- The pre-existing `enqueue_email` 500 — you said skip it; `send-cold-email` uses the direct Lovable API path which works.

