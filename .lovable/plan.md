

## Goal
Make the 5 (soon 6) verified-or-pending sender domains usable across the app. Each domain should support multiple named senders (default: Eric Wahlbom `eric@` and Isak Andersson `isak@`), with reply-to auto-routed by brand (foremp → `eric@foremp.se`, botlio → `eric@botlio.io`). The cold-outreach sequence runner should pick a sender, send via the right domain, log the send, and schedule follow-ups.

## Current state (what exists)
- 5 domains added in Lovable Email infra: `botlio.email`, `botlio.eu`, `botlio.io`, `foremp.eu`, `foremp.one` (some still pending DNS)
- `senders` table exists (from_name, from_email, reply_to, is_active) — manual entry
- `send-transactional-email` edge function deployed and domain-agnostic
- `sequences` + node-graph tables (`sequence_nodes`, `sequence_edges`, `enrollments`, `contact_activity`) exist
- `sent_emails` table exists for logging
- No runner yet — sequences can be built but nothing actually sends
- No domain registry / no auto reply-to routing / no sender-rotation logic

## Plan

### 1. New `sending_domains` table (seeded by us)
Source of truth for the 6 domains and their brand routing.
```
sending_domains: id, domain (unique), brand ('foremp'|'botlio'),
                 reply_to_email, is_active, sender_subdomain ('notify')
```
Seed all 6 rows:
- `foremp.one`, `foremp.eu`, `foremp.email` → brand `foremp`, reply_to `eric@foremp.se`
- `botlio.io`, `botlio.eu`, `botlio.email` → brand `botlio`, reply_to `eric@botlio.io`

### 2. Auto-seed senders per domain
For every active domain, ensure two senders exist:
- Eric Wahlbom — `eric@<domain>`
- Isak Andersson — `isak@<domain>`

That gives 12 senders total (2 × 6). The user can deactivate any of them or add more from the Senders page later. Reply-to is **derived from the domain's brand** at send time — not stored per sender — so it can never drift.

### 3. Upgrade Senders page (`/senders`)
- Add a **Domain** dropdown to the "Add sender" dialog (lists active `sending_domains`)
- Local-part input (e.g. `eric`) instead of full email — UI assembles `eric@foremp.eu`
- Reply-to field becomes **read-only** and shows the brand's reply-to with a hint ("Replies go to your Zoho inbox at eric@foremp.se")
- Group the senders list visually by domain with a small brand badge

### 4. Upgrade `send-transactional-email` edge function
- Accept `sender_id` in the body (looks up sender → derives `from_email` + brand-based `reply_to`)
- Set `from`, `from_name`, and `Reply-To` header on the outbound email
- The Mailgun/Lovable email pipeline already routes via the matching `notify.<domain>` subdomain — no extra routing config needed once DNS is verified
- Validate the sender's domain is in `sending_domains` and `is_active`, otherwise reject

### 5. New cold-outreach sender: `send-cold-email` edge function
A separate function (NOT `send-transactional-email`, which is reserved for transactional flows). It:
1. Picks a sender (round-robin per sequence, or specified `sender_id`)
2. If the Send-Email node is in `mode: ai`, calls existing `generate-email` to produce subject + body for the contact
3. Sends via the same Lovable email infra used today
4. Inserts into `sent_emails` (recipient, sender, sequence, enrollment, body, message_id)
5. Returns the message_id so the runner can advance the enrollment

### 6. Sequence runner: `run-sequences` edge function + cron
The piece that actually walks the graph for each enrollment.
- Cron every 1 minute via `pg_cron` + `pg_net`
- Picks enrollments where `next_send_at <= now()` and `status = 'active'`
- For each, reads the `current_node_id` from `sequence_nodes`, executes it:
  - **Trigger** → move to next node immediately
  - **Send Email** → call `send-cold-email`, log activity, advance
  - **Wait** → set `next_send_at = now() + duration`, advance to wait's target
  - **Log Activity** → insert into `contact_activity`, advance
  - **Condition** → (stub for now, defaults to `false` branch since open/reply tracking isn't built yet)
  - **End** → mark enrollment `completed`

### 7. Sender rotation in the canvas
In the Send Email node inspector, replace the existing sender picker with:
- "Rotate across all active senders" (default)
- "Rotate within brand: foremp"
- "Rotate within brand: botlio"
- "Specific sender" → dropdown

Stored in node `config` as `{ sender_strategy, sender_id?, brand? }`.

### 8. Routing verification
After deploy, send a test email from each domain to the user's Zoho inbox to confirm:
- `From:` shows the right name + address
- `Reply-To:` is the correct Zoho address
- Reply lands in Zoho

This is a manual click in a new "Test send" button on each sender row (calls `send-transactional-email` with a hardcoded test template to a user-specified email).

## What you need to do
1. **Nothing new for now** — finish DNS for the 3 still-pending domains (`botlio.io`, `foremp.eu`, `foremp.one`) at your registrar so they go from "pending" to "verified". The system will work for verified ones immediately and start working for the others as DNS propagates.
2. After I deploy, click **Test send** on each sender (12 buttons) and confirm the test arrives in the right Zoho inbox.
3. Optional: add the last 2 domains (`foremp.email`, `botlio.one` or whichever) when ready — they'll auto-pick-up the same logic.

## What I will do (order of operations)
1. Migration: create `sending_domains`, seed 6 rows, seed 12 senders
2. Update Senders page with domain dropdown + brand badges + Test send button
3. Upgrade `send-transactional-email` to accept `sender_id` and derive reply-to from brand
4. Build `send-cold-email` edge function (uses `generate-email` for AI mode)
5. Build `run-sequences` edge function + schedule via pg_cron every 1 min
6. Update Send Email node inspector with rotation strategies
7. Verify end-to-end with a test enrollment

## Out of scope (next phase)
- Open/click/reply tracking webhooks (needed for the Condition node to actually branch on real data)
- Inbound email parsing (replies are forwarded to Zoho — Zoho is your inbox UI, not the app)
- Per-sender daily send limits / warmup throttling

