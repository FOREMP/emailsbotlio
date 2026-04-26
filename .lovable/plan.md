# Analytics Page Plan

A new **/analytics** page that turns raw `sent_emails`, `enrollments`, and `contact_activity` data into a clear, sequence-by-sequence performance view — built to feel like a polished email dashboard (think Lemlist / Instantly).

---

## 1. Page Structure

```text
/analytics
├── Header: title + global filters (date range, sequence selector, sender selector)
├── Top KPI row (deduped per email)
│    Sent · Delivered · Opened · Replied · Bounced · Unsubscribed
├── Trend chart
│    Daily sends + opens + replies (stacked line/area, last 30d default)
├── Sequence performance table
│    One row per sequence: Sent / Open% / Reply% / Bounce% / Active enrollments
├── Sender performance table
│    One row per sender: Sent today vs warmup quota, Open%, Reply%, Bounce%
└── Recent activity feed
     Latest opens, replies, bounces, unsubscribes
```

---

## 2. Metrics & Formulas

All metrics derived from existing tables — **no schema changes needed**.

| Metric | Source | Formula |
|---|---|---|
| Sent | `sent_emails.status in ('sent','delivered','opened','replied')` | count |
| Delivered | `status != 'bounced','failed'` | count |
| Open rate | `opened_at IS NOT NULL` | opened / delivered |
| Reply rate | `replied_at IS NOT NULL` | replied / delivered |
| Bounce rate | `status = 'bounced'` | bounced / sent |
| Unsubscribed | `do_not_contact` rows in range | count |
| Active enrollments | `enrollments.status = 'active'` | count per sequence |
| Failure rate | `enrollments.last_error IS NOT NULL` recent | count |

Sender warmup status uses existing `sender_warmup_quota()` + `sender_daily_remaining()` RPCs.

---

## 3. Filters (top of page)

- **Date range**: presets (24h / 7d / 30d / 90d / all) + custom picker. Default 30d.
- **Sequence**: dropdown (All + each sequence).
- **Sender**: dropdown (All + each sender).
- All filters reactive — queries re-run on change via React Query.

---

## 4. Charts (using existing Recharts in `components/ui/chart.tsx`)

1. **Daily volume** — stacked area: Sent / Opened / Replied per day.
2. **Sequence comparison** — horizontal bar chart of open% per sequence.
3. **Funnel card** — Sent → Delivered → Opened → Replied (with % conversions).

---

## 5. Tables

**Sequence performance** (sortable):
Sequence name · Status · Sent · Open% · Reply% · Bounce% · Active · Last activity → links to `/sequences/:id`

**Sender performance** (sortable):
From email · Sent today · Daily quota · Total sent · Open% · Reply% · Bounce% · Warmup status

**Recent activity** (last 20):
Joined `contact_activity` + `sent_emails` → timestamp · type icon (open/reply/bounce/unsub) · contact email · sequence name.

---

## 6. Files to Create / Modify

**New:**
- `src/pages/Analytics.tsx` — page shell, filters, layout
- `src/components/analytics/KpiCards.tsx`
- `src/components/analytics/VolumeTrendChart.tsx`
- `src/components/analytics/SequenceTable.tsx`
- `src/components/analytics/SenderTable.tsx`
- `src/components/analytics/ActivityFeed.tsx`
- `src/components/analytics/FunnelCard.tsx`
- `src/hooks/useAnalytics.ts` — central React Query hooks for all metrics

**Modified:**
- `src/App.tsx` — add `/analytics` protected route
- `src/components/AppLayout.tsx` (or wherever nav links live) — add "Analytics" nav item with `BarChart3` icon

---

## 7. Technical Notes

- All queries use existing Supabase client + RLS (already scoped per `user_id`) — no new policies needed.
- Aggregations done **client-side** on filtered query results (volume small enough; can move to RPC later if needed).
- Use `useQuery` with the filter state in the query key for automatic refetching.
- Reuse existing styling tokens (`border-border`, `bg-card`, `shadow-card`) for visual consistency with Dashboard.
- Status color map already exists in Dashboard — extract into a small util.

---

## 8. Out of Scope (future)

- CSV export of analytics
- Email-by-email drill-down modal
- Cohort retention / time-to-reply distributions
- A/B test comparison between sequence variants

These can be added once the base page is in place.
