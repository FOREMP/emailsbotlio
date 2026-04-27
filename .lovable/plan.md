## Problem

Investigation of the database confirms that **per-node prompts ARE saved correctly and distinct per node** (verified by querying `sequence_nodes`). The bug is not in saving — it is in how the `generate-email` Edge Function uses those prompts.

### Why the output doesn't match the prompt the user wrote

1. **`subject_hint` is misused as a full subject prompt.** The user is putting a long, dedicated subject-generation prompt into the field labeled "AI subject prompt" in the NodeInspector. But the backend (`generate-email`) appends it as a single-line "Subject hint: …" string at the end of the body prompt and asks the model to produce subject + body in **one** JSON call. Result: the body prompt dominates and the elaborate subject instructions are largely ignored.

2. **One LLM call for both fields.** Because subject and body are produced in the same JSON response, the model treats the body prompt as the primary instruction and the subject as an afterthought — so subjects often don't reflect what the user asked for.

3. **A hard-coded system message dilutes per-node intent.** The system prompt is a generic "return JSON, no signature" instruction. The user's actual node prompt sits in the `user` role and competes with that scaffolding.

4. **UI/backend mismatch.** The NodeInspector labels the field "AI subject prompt" (suggesting a full prompt), but the backend treats it as a short hint. This is the root of the confusion.

### What is NOT broken (verified)

- Each node in the database has its own distinct `config.prompt` and `config.subject_hint`. Saving works.
- `run-sequences` correctly forwards `cfg.prompt` and `cfg.subject_hint` from the **current** node, advances `current_node_id` after sending, and uses the follow-up node's own config for follow-ups. So different nodes already pull different prompts.
- The model is already `gpt-4.1-mini`. We will keep this and make it explicit and configurable per node.

## Fix Plan

### 1. Rework `generate-email` to honor per-node prompts faithfully

- **Two LLM calls instead of one**, both `gpt-4.1-mini`:
  - **Subject call**: uses the node's `subject_prompt` (renamed from `subject_hint`) verbatim as the user message; system message simply says "Return only the subject line text, no quotes, no extra words." Variable substitution (`{{first_name}}` etc.) applied against the contact.
  - **Body call**: uses the node's `prompt` verbatim as the user message; system message: "Return only the email body. Do not add a subject line, greeting placeholder, or sign-off — those are added later." Returns plain text.
- This guarantees the model follows each prompt independently, so a subject prompt actually controls the subject and a body prompt controls the body.
- Keep follow-up handling: when `is_followup=true`, append a brief "(this is a short follow-up to a previous email)" note to the body system message only.
- Keep the existing sign-off stripping.
- Pass `model` from the node config (default `gpt-4.1-mini`) so future changes are per-node.

### 2. Update `send-cold-email` and `run-sequences` to pass the new field

- `run-sequences` already forwards `cfg.subject_hint` and `cfg.prompt`; rename the forwarded key to `subject_prompt` while keeping backward compatibility (read both `cfg.subject_prompt ?? cfg.subject_hint`).
- `send-cold-email` forwards both fields to `generate-email` unchanged.

### 3. Clarify the NodeInspector UI

- Rename the field label "AI subject prompt" → "Subject prompt (separate AI call)" with helper text: "This prompt generates only the subject line. It runs as its own gpt-4.1-mini call."
- Rename "AI body prompt" → "Body prompt (separate AI call)" with helper text: "This prompt generates only the email body. Sign-off is added automatically."
- Save the value to a new `config.subject_prompt` field. Migrate read path to fall back to old `subject_hint` so existing nodes keep working.
- Update the in-node preview chip (`SendEmailNode`) to read `subject_prompt ?? subject_hint`.
- Update the "Preview with sample contact" button to call `generate-email` with the new field name.

### 4. Make output less repetitive across contacts

- Keep `temperature: 0.8` and add a small per-call nonce in the user message (e.g. include the contact email so identical prompts still produce contact-specific output deterministically per contact).

### 5. No database migration needed

- `sequence_nodes.config` is JSONB; new `subject_prompt` key is additive. Existing `subject_hint` values continue to work via fallback in both backend and frontend.

## Files to change

- `supabase/functions/generate-email/index.ts` — two-call generation, explicit `gpt-4.1-mini`, accept `subject_prompt` (fallback `subject_hint`), accept optional `model`.
- `supabase/functions/send-cold-email/index.ts` — forward `subject_prompt` to `generate-email` (keep `subject_hint` as fallback).
- `supabase/functions/run-sequences/index.ts` — read `cfg.subject_prompt ?? cfg.subject_hint` and forward as `subject_prompt`.
- `src/components/sequence-canvas/NodeInspector.tsx` — relabel fields, write to `subject_prompt`, read with fallback, update preview call.
- `src/components/sequence-canvas/nodes/SendEmailNode.tsx` — read `subject_prompt ?? subject_hint` for the card preview.

## Acceptance

- Editing a node's body prompt and saving causes the next send from THAT node to follow the new prompt.
- Two send_email nodes with different body prompts produce different emails for the same contact.
- The subject prompt independently controls the subject line.
- Model used is `gpt-4.1-mini` (logged in the function for verification).
- Existing nodes (with old `subject_hint`) continue to work without re-editing.
