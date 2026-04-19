
Root cause:
- The system is most likely not creating truly “random” new nodes. Old node rows are still sitting in `sequence_nodes`, and when the page refetches on tab focus / reopen, the canvas reloads them from Supabase.
- In `src/pages/SequenceCanvas.tsx`, `onNodesChange(... remove ...)` updates React state and calls `triggerSave`, but `triggerSave` only upserts the remaining nodes. It never deletes node rows that disappeared from the canvas.
- There is a second bug: saves are debounced by 1 second and the timer is cleared on unmount. So if you switch tab / leave quickly after an edit, that last edit can be lost before it ever reaches Supabase.

What I will change:
1. Make canvas persistence authoritative
- Replace the current “upsert remaining nodes only” logic with full graph reconciliation:
  - load current DB node ids for the sequence
  - compute which ids are no longer in the canvas
  - delete those missing ids from `sequence_nodes`
  - upsert only the nodes that still exist
  - keep the existing full replace logic for edges
- This ensures the database exactly matches the canvas state.

2. Fix all delete paths
- Handle deletions from both:
  - the inspector delete button (`deleteNode`)
  - React Flow’s built-in remove events (`onNodesChange` with `remove`)
- I’ll make both paths use the same persistence function so keyboard delete, selection delete, and inspector delete all behave identically.

3. Prevent lost saves on tab switch / leaving
- Flush pending saves immediately on:
  - component unmount
  - page visibility change / tab hide
  - window blur or before navigation away if needed
- This removes the “I changed something, switched tab, came back, and old nodes returned” behavior.

4. Stop DB refetch from overwriting unsaved local state
- Tighten the hydration effect so it only rehydrates from Supabase when there is no local pending save.
- After a successful save, explicitly sync local refs/state from the just-saved graph instead of trusting a later refetch.

5. Clean up the current broken sequence state
- After the logic is fixed, I’ll remove the ghost node rows already stuck in the affected sequence so the canvas starts from the real saved state.
- No schema change should be needed for this fix.

Files to update:
- `src/pages/SequenceCanvas.tsx` — main fix for save/delete/reload behavior
- Possibly small related cleanup if needed in:
  - `src/components/sequence-canvas/NodeInspector.tsx`
  - React Query usage around the sequence canvas

Technical details:
- Current faulty behavior:
  - `triggerSave()` does `upsert(nodePayload)` but never deletes missing node ids.
  - `useEffect([dbNodes, dbEdges,...])` then reloads those stale rows into the canvas.
  - the 1s debounce is canceled on unmount, so recent changes may never persist.
- Intended behavior after fix:
  - Supabase `sequence_nodes` becomes an exact mirror of the current canvas.
  - If a node is deleted anywhere in the UI, its DB row is deleted too.
  - If you leave and come back, only the nodes you explicitly added and configured remain.

Validation after implementation:
- Create a new sequence → open canvas → it stays empty
- Drag in one node → leave page immediately → reopen → same node remains
- Delete a node with inspector button → reopen → it stays deleted
- Delete a node with keyboard / canvas remove → reopen → it stays deleted
- Change node settings, switch tab, come back → settings persist
- Wait for window refocus / React Query refetch → no ghost nodes reappear
