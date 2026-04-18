

## Root causes found

### 1. Emails not sending — TWO compounding bugs

**Bug A: Duplicate trigger nodes → runner advances past everything to "completed" without sending.**
The current sequence has a stray extra `send_email` node and the seeding has historically produced duplicates. More importantly — looking at `enrollments` for sequence `560a3369…` — every enrollment is `status: completed`, `last_sent_at: null`. That means the runner walked the graph but never actually sent. This happens when the trigger node has multiple outgoing edges or when `current_node_id` points to a node, the runner advances, and the next `find()` returns `undefined` (no edge from the new node), so it marks `completed` immediately.

The runner in `run-sequences/index.ts` does this:
- if current node is a trigger → find next via edge → if no edge, mark `completed` and continue
- BUT in our case `enroll-contacts` set `current_node_id = trigger.id` and at that exact moment the canvas wasn't fully wired (or duplicate trigger had no outgoing edge), so every enrollment got stamped `completed` on first tick.

**Bug B: When the runner DOES reach a `send_email` node, `send-cold-email` returns the old `missing_unsubscribe` error for any email already in `sent_emails` from before today** — but new sends should now work since we added the unsubscribe token. The most recent `sent_emails` row is from 13:20 (before today's fix). So actually the unsubscribe path is fine; it's the runner that never reaches send_email at all.

### 2. Canvas "tossed to the left" on every interaction
`<ReactFlow fitView ...>` is being passed `fitView` as a **prop on every render**. React Flow re-fits the view to the bounding box on every node/edge state change. Combined with our debounced autosave that mutates `nodes`, you get re-fit on every drag, click, or save → "tossed to the left/center".
**Fix:** remove `fitView` prop and instead call `fitView()` exactly once on initial node load via `useReactFlow().fitView()` in a `useEffect` that fires when `nodes.length` first goes from 0 → >0.

### 3. Sometimes nodes don't appear
The `useEffect` at line 105 only loads from DB when `initialLoad.current === true`. After we set it to `false`, subsequent `dbNodes` query refetches (e.g. on tab switch / window focus / React Query refetch) are ignored — so if the first fetch returned `[]` and the second returned the real rows, we never render them.
**Fix:** load nodes whenever `dbNodes` changes (and we haven't dirty-edited locally), not just on first mount.

### 4. Senders page "all not showing"
Looking at the DB: user `7f472625…` (the one currently testing) has only **2 senders** (`eric@foremp.email`, `eric@botlio.email`). The other user `73c5fc66…` has 11. RLS is correctly filtering by `user_id` — that's working as designed. The "Auto-create" button calls `seed_default_senders()` which loops over all `sending_domains` and inserts Eric + Isak per domain. The function has a bug: it uses `GET DIAGNOSTICS inserted = ROW_COUNT` AFTER the first insert and never accumulates, but more critically, the `INSERT … WHERE NOT EXISTS` pattern with the secondary unique check works — so the function should have inserted ~12 rows. The fact that only 2 exist for this user means the RPC was likely interrupted or the user only ran it before all domains existed.
**Fix:** make the seed RPC re-runnable + idempotent (it already is) and fix the function so it doesn't early-exit. Have the UI auto-call seed on first visit if `senders.length === 0` and show a clearer "X / Y senders provisioned" banner.

### 5. Stuck enrollments need a reset
All 5 enrollments on the test sequence are `completed` with `last_sent_at: null` (= they got marked done without ever sending). They will never retry. Need a one-shot DB cleanup to delete them so the user can re-enroll cleanly.

---

## Plan

### A. Sequence canvas (`SequenceCanvas.tsx`)
1. Remove the `fitView` prop. Add a `useEffect` that calls `reactFlow.fitView({ padding: 0.2 })` exactly once when nodes first load.
2. Rewrite the load effect: when `dbNodes` changes AND we are not in the middle of saving (track a `dirty` ref), reconcile DB → local state. This makes the sometimes-blank-canvas race go away.
3. Keep the seeding guard (already present), but ALSO refuse to seed if a trigger node already exists for this sequence — defensive double-check.
4. Show enrollment counts in the header (Active / Completed / Failed) so the user can see what the runner is doing.

### B. Runner (`run-sequences/index.ts`) — make it actually send
1. When current node is `trigger`: instead of "advance and mark completed if no edge", **also check `node_type` of next**. If trigger has no outgoing edge, log to a new `sequence_run_errors` field (or just `error` toast on enrollment) instead of silently marking `completed`. Set status to `failed` with a clear reason.
2. Add server-side logging (`console.log`) at every branch so we can read `edge_function_logs` and see exactly where each enrollment is stuck.
3. Critically: if the same node appears multiple times (duplicate trigger), pick the one that has an outgoing edge.

### C. Send Email node — AI Subject for everyone
Already supported via `subject_hint` (renamed "AI subject prompt" yesterday). Confirm `send-cold-email` passes it to `generate-email`. We'll also pass the contact's `custom_fields` so the AI personalizes.

### D. Senders page
1. Auto-call `seed_default_senders()` once when the user lands on `/senders` and has 0 senders for any active domain.
2. Fix `seed_default_senders` SQL to actually insert Isak after Eric (the current `GET DIAGNOSTICS` line is harmless but the function logic itself is fine — verify).
3. Show a "Provisioned: 12 / 12 senders" header so the user can see at-a-glance.

### E. Database cleanup migration
- Delete the 5 stuck `completed` enrollments (where `last_sent_at IS NULL`) for the active test sequence so the user can re-enroll.
- Delete the stray duplicate `send_email` node `fc714603…` on sequence `560a3369…` that's not wired to anything.

---

## How it will work after

1. Open the sequence → exactly 5 nodes load every time, no more blank canvas. Panning / zooming stays where you left it — no more snap-to-left.
2. Click **Enroll contacts** → enrollments insert with `current_node_id = trigger`. Within 60s, runner picks them up, sees trigger has an outgoing edge → walks to Send Email #1 → calls `send-cold-email` → AI generates subject + body using the contact's variables → email sends → `last_sent_at` is set, `next_send_at = now + 3 days`, `current_node_id = wait`.
3. 3 days later the wait expires, runner walks to Send Email #2, sends the follow-up.
4. Enrollment counter in the canvas header increments live (Active 4, Completed 1).
5. On `/senders`, you see all 12 senders (Eric + Isak across all 6 domains). If any are missing, the auto-seed runs immediately.

