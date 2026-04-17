

## Plan: n8n-style Visual Sequence Builder

### Stack additions
- **`@xyflow/react`** (React Flow) for the node canvas
- **OpenAI gpt-4.1-mini** via new `OPENAI_API_KEY` secret (called from edge function only)

### Database changes
Replace the linear `sequence_steps` model with a graph model:
- **New table `sequence_nodes`**: `id, sequence_id, user_id, node_type, position_x, position_y, config jsonb, created_at, updated_at`
  - `node_type`: `trigger | send_email | wait | log_activity | condition | end`
  - `config` holds type-specific settings (delay, prompt, subject, branch labels, etc.)
- **New table `sequence_edges`**: `id, sequence_id, user_id, source_node_id, target_node_id, source_handle` (source_handle = `default | true | false` for condition branches)
- **New table `contact_activity`**: `id, user_id, contact_id, sequence_id, node_id, activity_type, metadata, created_at` — for the Log Activity node
- Keep `enrollments` but add `current_node_id uuid` so the runner walks the graph instead of incrementing step numbers
- Drop usage of `sequence_steps` (table can stay for now, just unused)

### Dashboard
- Add **Sequences** link to the dashboard `<header>` nav (alongside Contacts/Senders/Files)
- Sequences stat tile already links to `/sequences` ✓

### Sequences list page (`/sequences`)
- Keep existing list, but the "New Sequence" dialog now creates a sequence + auto-inserts a single **Trigger** node at center
- Row "Edit" links go to the new canvas

### Node canvas (`/sequences/:id`) — REPLACES old editor
Layout:
- **Top bar**: name (inline edit) · status pill (Draft/Active) · Save indicator · "Enroll contacts" button · back link
- **Left sidebar (node palette)**: draggable node types with icons + descriptions
- **Center**: React Flow canvas (pan/zoom, minimap, controls)
- **Right drawer (node inspector)**: opens on node click, edits selected node's `config`

### The 6 node types

| Node | Color | Config |
|---|---|---|
| **Trigger** | green | `contact_list_id` (dropdown of lists) — auto-created, only one per sequence |
| **Send Email** | blue | `sender_id` (or "rotate"), `mode: ai\|template`, if AI: `prompt`, `subject_hint`, `model=gpt-4.1-mini`; if template: `subject`, `body` with `{{variable}}` picker |
| **Wait** | amber | `duration` (number) + `unit` (minutes/hours/days) |
| **Log Activity** | purple | `activity_type` (free text or dropdown: contacted/opened/clicked/custom), `note` |
| **Condition** | pink | `condition_type: opened\|replied\|clicked`, `wait_window_hours` — emits 2 handles (true/false) |
| **End** | gray | no config — terminates branch |

### Edges
- Standard React Flow edges, animated when sequence is active
- Condition node has 2 source handles (green=true, red=false)
- Validation: must have exactly 1 trigger; every non-end leaf should connect to End

### Persistence
- Debounced auto-save (1s) on node move / edge change / config change
- Single `saveFlow()` upserts all nodes + replaces all edges in a transaction

### AI generation edge function — `generate-email`
- New edge function, takes `{ contact, prompt, subject_hint }`
- Reads `OPENAI_API_KEY` (request from user via secret tool)
- Calls OpenAI Chat Completions with model `gpt-4.1-mini`
- Returns `{ subject, body }` — invoked at SEND time by the runner (out of scope for this PR), but also exposed as a "Preview email" button in the Send Email node inspector so the user can test against a sample contact

### Out of scope (Phase 2c — next)
- The actual runner/cron that walks the graph for each enrollment
- Open/reply tracking webhooks (the Condition node will work once we have these)
- Branch validation UI warnings

### Files
**New:**
- `src/pages/SequenceCanvas.tsx` (replaces SequenceEditor as the page rendered at `/sequences/:id`)
- `src/components/sequence-canvas/NodePalette.tsx`
- `src/components/sequence-canvas/NodeInspector.tsx`
- `src/components/sequence-canvas/nodes/TriggerNode.tsx`
- `src/components/sequence-canvas/nodes/SendEmailNode.tsx`
- `src/components/sequence-canvas/nodes/WaitNode.tsx`
- `src/components/sequence-canvas/nodes/LogActivityNode.tsx`
- `src/components/sequence-canvas/nodes/ConditionNode.tsx`
- `src/components/sequence-canvas/nodes/EndNode.tsx`
- `supabase/functions/generate-email/index.ts` (+ deno.json)

**Edit:**
- `src/App.tsx` — point `/sequences/:id` to `SequenceCanvas`
- `src/pages/Dashboard.tsx` — add Sequences link in header nav
- `src/pages/Sequences.tsx` — new sequence dialog auto-creates trigger node
- Delete `src/pages/SequenceEditor.tsx`

### Order of operations
1. Request `OPENAI_API_KEY` secret
2. Run migration (new tables)
3. Install `@xyflow/react`
4. Build canvas + nodes + inspector
5. Build `generate-email` edge function

