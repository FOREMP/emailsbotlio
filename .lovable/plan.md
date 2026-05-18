## Audit — Last 7 days (May 11–18 UTC)

### Volume
| Day | Sent | Failed |
|---|---|---|
| May 18 (today) | 64 | 0 so far |
| May 17 | 38 | 0 |
| May 16 | 64 | 0 |
| May 15 | 64 | 0 |
| May 14 | 64 | 72 |
| May 13 | 64 | 80 |
| May 12 | 64 | 56 |
| May 11 | 52 | 30 |

- **Failures dropped to zero from May 15 onward** — the bad-email backlog (`info@x.com, info@y.com` style rows from Bil kontakt) is mostly drained.
- **May 17 only 38 sent** — weekend Schedule-node gating + fewer follow-ups due that day. Not a bug.
- **Daily ceiling today = 64**, even with limit raised to 8/sender. Reason below.

### Sender utilisation (today)
Used (8/8): `eric/isak @ botlio.email, botlio.eu, foremp.eu, foremp.one` → **8 inboxes × 8 = 64**

Idle (0/8): `eric/isak @ botlio.io, foremp.email` → **4 inboxes × 8 = 32 unused capacity**

Why: `sequences.sender_rotation = []`, so the engine falls back to **domain-match only**, and the Schedule nodes split work into 2 windows that each happen to hit only 4 inboxes. The `.io` and `.email` inboxes are never picked.

Also: every `from_email` still has **two sender rows** (`daily_limit=8` and `daily_limit=50`). The 8-row is being chosen today, but the 50-row is a deliverability landmine.

### Enrollment health
| Sequence | active | waiting_capacity | completed | failed |
|---|---|---|---|---|
| Agency outreach | 34 | 149 | 191 | 0 |
| Bil kontakt | 0 | 84 | 120 | 24 |

- **Bil kontakt is starving** — 0 active. Only 84 left in waiting + nothing new. **Needs a fresh import.**
- **Agency outreach has ~30 days of runway** at current rates.

### How many emails/day can we safely do?
- Inboxes are **2–4 weeks old, no warmup running** (`warmup_enabled=false` on every row). Going straight to 12/inbox is risky for fresh domains.
- Recommended ramp: **8/day this week → 10/day next week → 12/day week after**, only if open rate (once tracking is on) stays healthy and bounces stay near 0.
- With **12 inboxes actually rotating**: 12 × 8 = **96/day now**, 12 × 12 = **144/day in 2 weeks**.

---

## Plan — Open tracking + Analytics surfacing

### 1. New edge function `track-open` (public, no JWT)
- Route: `GET /functions/v1/track-open?m=<message_id>`
- Returns a 1×1 transparent GIF with no-cache headers.
- Uses service-role client to:
  - `UPDATE sent_emails SET opened_at = COALESCE(opened_at, now()), open_count = open_count + 1 WHERE message_id = $1`
  - Insert `contact_activity` row (`activity_type='email_opened'`) on **first** open only.
- Ignores prefetch bots: skip if `User-Agent` contains `GoogleImageProxy` only on the *first* hit within 2 s of send (Gmail proxy fetches once on delivery — we treat the FIRST hit as "delivered/prefetched" and only count later hits as real opens). Simpler v1: just record every hit; document the caveat.

### 2. DB migration
- Add `open_count INT NOT NULL DEFAULT 0` and `last_opened_at TIMESTAMPTZ` to `sent_emails`.
- Index `sent_emails(message_id)` (likely already implicit via PK = id, but `message_id` is a separate text column).

### 3. Modify `send-cold-email/index.ts`
- Build pixel URL: `${SUPABASE_URL}/functions/v1/track-open?m=${messageId}`
- In `plainToHtml`, append before closing div:
  `<img src="PIXEL_URL" width="1" height="1" alt="" style="display:block;border:0;outline:none;height:1px;width:1px;opacity:0" />`
- Plain-text version stays untouched (no pixel possible).

### 4. Analytics page changes
- `KpiCards.tsx`: remove the `"tracking off"` sub-label on the **Opened** tile; show real `openRate` percentage.
- `FunnelCard.tsx`: already wired to `kpis.opened` — will populate automatically.
- `VolumeTrendChart.tsx` / `computeDailySeries`: already counts `opened` per day — no change.
- `SenderTable.tsx`: add an "Open rate" column (opens / sent per sender).
- New small component `OpenRateBySequence` under Sequence table — opens/sent per sequence.

### 5. Cleanup (separate, recommended)
- Delete the 12 duplicate `daily_limit=50` sender rows so capacity is unambiguous.
- Set `sequences.sender_rotation` on Agency outreach + Bil kontakt to **all 12 sender ids**, so the `.io` and `.email` inboxes get used → unlocks 96/day immediately.
- Import a fresh batch of Bil kontakt contacts (need ~200+ to feed the next 2–3 weeks).

### 6. Verification checklist
- After deploy, send a test email to a Gmail address → wait for client to load images → confirm `sent_emails.opened_at` populates and Analytics "Opened" tile increments.
- Confirm pixel returns 200 + correct `Content-Type: image/gif` in network tab.
- Confirm a second open increments `open_count` but does NOT overwrite `opened_at`.

### Technical notes
- Pixel endpoint MUST be public — `verify_jwt = false` in `supabase/config.toml` for `track-open`.
- Use `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` + `Pragma: no-cache` so corporate proxies don't cache.
- Wrap the DB update in a try/catch — pixel must ALWAYS return 200 + gif bytes, even if DB write fails (don't break email rendering).
- Gmail image proxy caveat: first "open" may be Gmail prefetch, not the user. Acceptable for v1; can refine later with timing heuristic.
- No PII in URL — only `message_id` (random UUID).

### Out of scope (call out, do separately if you want)
- **Reply tracking** — needs inbound webhook on the reply-to domain. Bigger project.
- **Per-link click tracking** — would require rewriting links through a redirect endpoint.
- **Warmup automation** — `senders.warmup_enabled` flag exists but logic isn't started; flip on later when you want gradual ramp.

---

Approve and I'll implement steps 1–4 (open tracking + Analytics). Step 5 cleanup I'll do as a follow-up so each change is reviewable.