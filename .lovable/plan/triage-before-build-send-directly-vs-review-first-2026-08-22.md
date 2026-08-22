# Triage before build: "send directly" vs "review first"

Today every lead that the audit scores as `needs_site` is built automatically and then lands in Approvals, where you approve each finished demo before outreach starts. The change adds a decision step **before** the build, so you only review the demos you actually want to review.

## New flow

```text
audit  →  score >= 7  →  site_good_enough (parked, no outreach)
       →  score <  7  →  needs_triage   [YOU DECIDE HERE]
                            ├─ Good enough after all      → site_good_enough (parked)
                            ├─ Build + send directly      → needs_site (auto_send = true)
                            └─ Build + let me review      → needs_site (auto_send = false)

build → deploy → live
   auto_send = true   → auto-approved, contact + enrollment created, outreach starts
   auto_send = false  → awaiting_approval (current Approvals screen, unchanged)
```

Nothing about email content, sequences, sending limits or the generator itself changes.

## What you get in the UI

**Leads & Generator** gets a new "Att besluta" (needs_triage) queue at the top:
- one row per lead with company, category, audit score, audit reason and the concrete weaknesses, plus a link to their current site
- three buttons per row: **Bra nog (hoppa över)**, **Bygg + skicka direkt**, **Bygg + jag granskar**
- bulk versions of the same three actions for selected rows, so you can clear a batch fast
- language and niche filters work on this queue like the rest of the page

**Approvals** stays exactly as it is, but only shows demos you asked to review. A small badge shows which leads were auto-sent, and the status filter gets `auto_approved` so you can still see what went out without you.

## Safety rails

- Auto-send only fires when the demo URL is a canonical, verified live URL (same check the manual approve already does). If it is not, the lead falls back to `awaiting_approval` instead of sending.
- Auto-send respects the existing daily sending caps — it creates the enrollment, the sequence runner still paces it.
- Leads with no email address never auto-send; they go to `awaiting_approval`.
- If auto-enrollment fails for any reason, the lead is left in `awaiting_approval` with the error in `feedback` — it never silently disappears.

## Technical implementation

1. **Migration**
   - `site_leads.auto_send boolean not null default false` — set at triage time.
   - `site_leads.triaged_at timestamptz null`.
   - New statuses are plain text values, no enum change: `needs_triage`, `auto_approved`.
   - Backfill: existing `needs_site` rows stay as-is (they keep the review path, `auto_send = false`).

2. **`process-site-leads`**
   - Audit result routing: `score >= 7 → site_good_enough`, otherwise `needs_triage` (was `needs_site`).
   - The generation picker keeps selecting only `needs_site` rows, so nothing is built until you triage.
   - `reconcile()`: when a generated site goes `live` with a canonical URL, branch on `auto_send`. `false` → `awaiting_approval` (today's behaviour). `true` → call the new shared approval routine, set status `auto_approved` + `approved_at`.

3. **Shared approval routine** (new `supabase/functions/_shared/approve-lead.ts`)
   - Extracts what `SiteApprovals.tsx` does today: pick the SV/EN sequence by lead language, upsert the ghost contact with `demo_site_url` and custom fields, create or re-activate exactly one enrollment at the trigger node, then stamp the lead.
   - Used by the auto path in `process-site-leads`; the manual Approvals screen keeps its current client-side path unchanged so approved-by-hand behaviour cannot regress.

4. **Frontend**
   - `src/pages/SiteLeads.tsx`: new triage section + bulk actions writing `{ status, auto_send, triaged_at }`; add `needs_triage` to `STATUS_OPTIONS` and the status colours.
   - `src/pages/SiteApprovals.tsx`: add `needs_triage`/`auto_approved` to the status list and badges; show an "auto-skickad" badge for `auto_approved`.

## About the two replies

Two replies on a cold campaign of this size is a normal, healthy signal, not a warning sign — one positive plus one lukewarm is roughly what a working Swedish cold-email sequence produces. Nothing to act on unless replies turn into spam complaints or hard bounces, which show up in Analytics as `complained_at` / `bounced_at`. If you want, I can add a small "replies & complaints" card to the outreach analytics so this is visible at a glance — say the word and I will fold it into a follow-up plan.
