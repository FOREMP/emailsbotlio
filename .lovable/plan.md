

User wants a "Sequences" tab/section accessible from the dashboard. Looking at existing tables: `sequences`, `sequence_steps`, `enrollments`, `senders`, `contact_lists` are all in place. No `/sequences` route exists yet. Plan keeps Phase 2 sending out of scope (cron + AI generation) — this is just the builder UI so user can create + manage sequences. Sending wiring comes after.

## Plan: Sequences Tab

### Navigation
- Add **Sequences** link to dashboard header + dashboard stat tile already points here
- New routes: `/sequences` (list), `/sequences/:id` (editor)

### Page 1: `/sequences` — List view
Table of all sequences with columns:
- Name · Status (draft/active/paused) · Steps count · Contact list · Enrolled count · Created
- Top-right: **+ New Sequence** button → opens dialog (name + pick contact list + pick senders to rotate) → creates row → routes to editor
- Row actions: Edit · Pause/Activate · Delete

### Page 2: `/sequences/:id` — Editor
Three sections:

**1. Settings card (top)**
- Name (inline edit)
- Contact list dropdown (from `contact_lists`)
- Sender rotation (multi-select from active `senders`, drag to reorder → saves to `sequences.sender_rotation` jsonb)
- Status toggle: Draft ↔ Active (Active = will be picked up by future cron)

**2. Steps timeline (middle)**
- Vertical list of `sequence_steps` ordered by `step_order`
- Each step card shows: "Day X" badge · subject preview · AI prompt preview · edit/delete buttons
- **+ Add Step** button between/after cards
- Step editor (inline expand or dialog):
  - Delay days (number, 0 for first)
  - Toggle: **Use AI** (default on) vs **Static template**
  - If AI: prompt textarea + model picker (gemini-2.5-flash default, free) + optional subject hint
  - If static: subject + body textareas with `{{variable}}` insert helper (pulls from contact list's detected custom_columns)
  - Live variable chips showing what's available from the linked list

**3. Enrollment panel (bottom)**
- Shows: X contacts in list · Y already enrolled · Z suppressed/DNC
- **Enroll all eligible** button (disabled until status=active + ≥1 step + ≥1 sender)
- Calls a new edge function `enroll-contacts` which bulk-inserts `enrollments` rows skipping suppressed/DNC/already-enrolled, sets `next_send_at = now()` for step 0

### Dashboard updates
- The "Sequences" stat tile already exists — point it to `/sequences` instead of `/dashboard`
- Add new card **Active Sequences** showing top 3 with name + enrolled/sent counts + link

### Out of scope (next phase)
- `generate-email` edge function (OpenAI/Gemini)
- `send-due-emails` cron worker
- Open/reply tracking
- Per-sender daily caps
These are Phase 2b once you've built + tested a sequence end-to-end in the UI.

### Files to create/edit
- **New**: `src/pages/Sequences.tsx`, `src/pages/SequenceEditor.tsx`, `supabase/functions/enroll-contacts/index.ts` (+ deno.json)
- **Edit**: `src/App.tsx` (2 routes), `src/pages/Dashboard.tsx` (fix sequences tile link + add active sequences card)

