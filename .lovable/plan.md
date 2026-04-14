

## ReviewBrain -- AI-Powered Review Intelligence Platform

This replaces the MailxSend plan entirely. ReviewBrain aggregates customer reviews, analyzes them with AI, generates smart responses, and automates review collection.

### Product Vision

ReviewBrain helps mid-market companies (20-500 employees) understand what customers are saying, respond intelligently, and collect more positive reviews -- all from one dashboard.

### Trustpilot API Integration (Phase 1 Priority)

Trustpilot provides two API tiers:
- **Public/Data Solutions API** (free, API key only): Read reviews, ratings, TrustScore for any business unit by domain. Endpoints: `GET /v1/business-units/find?name=example.com`, `GET /v1/business-units/{id}/reviews`. This is enough to aggregate and analyze reviews.
- **Business API** (requires Trustpilot paid plan, OAuth): Reply to reviews, invite customers, manage responses. Needed for the AI response feature.

**Our approach**: Start with the public API for aggregation and analysis (works for all users). AI reply posting requires the user to connect their Trustpilot Business account via OAuth -- this becomes the Growth plan upsell.

### How AI Works with Reviews

**Data flow:**
1. Edge Function fetches reviews from Trustpilot API (scheduled via pg_cron, e.g. every 6 hours)
2. Each review is stored in the `reviews` table with raw text, rating, date, author
3. An AI analysis Edge Function processes new reviews using Lovable AI Gateway:
   - **Per-review**: Sentiment score (positive/neutral/negative), extracted themes (e.g. "shipping", "product quality", "customer service"), key phrases
   - **Batch/periodic**: Trend detection across all reviews for a time period
4. Results stored in `review_analysis` fields on each review and aggregated into `review_insights`

**AI response generation (Growth plan upsell):**
- User clicks "Generate Response" on any review
- Edge Function sends the review text + business context (tone, brand name) to Lovable AI
- AI drafts a professional response the user can edit before posting
- Posting uses Trustpilot Business API (requires user's OAuth token)

### What Reports Include

**Weekly AI Digest (auto-generated, emailed to user):**
- Overall sentiment trend (this week vs last week)
- Top 3 positive themes and top 3 negative themes with example quotes
- New review count and average rating
- Any significant sentiment drops (alerts)
- AI-recommended action items (e.g. "5 customers mentioned slow shipping this week -- consider addressing fulfillment times")

**Monthly Insight Report (dashboard + downloadable PDF):**
- Rating distribution over time (chart)
- Sentiment breakdown by theme (e.g. "Product Quality: 82% positive, Shipping: 45% positive")
- Word cloud of most frequent terms
- Review volume trends
- Competitor comparison (if tracked)
- Customer quotes highlight reel (best and worst)
- NPS estimate derived from review sentiment

### Pricing (Updated)

| Plan | Price | Key Features |
|------|-------|-------------|
| Starter | $49/mo | 3 review sources, review aggregation dashboard, basic AI analysis (sentiment + themes), weekly email digest |
| Growth | $129/mo | 10 sources, AI-generated review responses, Trustpilot reply posting via OAuth, monthly PDF reports, trend alerts, review request emails (1,000/mo) |
| Business | $249/mo | Unlimited sources, competitor benchmarking, 10,000 review request emails/mo, API access, white-label reports |

### Database Schema (New Tables)

- `review_sources` -- Connected platforms (type: trustpilot/google/manual, business_unit_id, api_credentials, last_synced_at)
- `reviews` -- Individual reviews (source_id, platform, author, rating, text, date, sentiment_score, themes JSONB, ai_response_draft, response_posted boolean)
- `review_insights` -- Periodic AI analysis snapshots (source_id, period, summary text, top_themes JSONB, sentiment_avg, review_count)
- `review_campaigns` -- Email campaigns to collect reviews (template, customer_list_id, schedule, status)
- `review_customers` -- Customer lists for review requests (reuses existing contacts infrastructure)

### Build Phases

**Phase 1 -- Foundation (build first)**
1. Rebrand app from MailxSend to ReviewBrain (landing page, header, dashboard, all references)
2. New database schema (review_sources, reviews, review_insights)
3. Trustpilot public API integration Edge Function (fetch reviews by domain)
4. Review aggregation dashboard (list reviews, filter by rating/date, search)
5. AI analysis Edge Function (sentiment + theme extraction per review using Lovable AI)
6. Insights dashboard with charts (sentiment over time, theme breakdown, rating distribution)

**Phase 2 -- AI Responses + Reports**
7. AI response generation Edge Function (draft replies for reviews)
8. Trustpilot OAuth flow for posting replies (Growth plan feature)
9. Weekly email digest (scheduled Edge Function + email sending)
10. Monthly PDF report generation

**Phase 3 -- Review Collection + Scale**
11. Review request email campaigns (reuse existing FileImportDialog for customer import)
12. Google Business Profile integration
13. Competitor benchmarking
14. Embeddable review widget

### Technical Architecture

```text
Frontend (React/Vite/Tailwind -- existing stack)
  |
  +-- Landing Page (rebranded)
  +-- Dashboard (review feed, insights charts)
  +-- Sources Manager (connect Trustpilot, Google)
  +-- AI Response Editor (edit + approve AI drafts)
  +-- Review Campaigns (email collection)
  
Backend (Supabase)
  |
  +-- Edge Functions:
  |     +-- fetch-reviews (Trustpilot public API -> store)
  |     +-- analyze-reviews (Lovable AI -> sentiment/themes)
  |     +-- generate-response (Lovable AI -> draft reply)
  |     +-- post-response (Trustpilot Business API via OAuth)
  |     +-- send-review-request (email to customers)
  |     +-- generate-digest (weekly summary email)
  |
  +-- pg_cron: scheduled review fetching every 6 hours
  +-- Database: reviews, sources, insights, campaigns
  
External APIs:
  +-- Trustpilot (public + business API)
  +-- Lovable AI Gateway (analysis + response generation)
```

### Files to Create/Modify

| File | Action |
|------|--------|
| `.lovable/plan.md` | Replace with ReviewBrain plan |
| Migration SQL | Create review_sources, reviews, review_insights tables |
| All pages + components | Rebrand from MailxSend to ReviewBrain |
| `src/pages/Index.tsx` | New landing page for ReviewBrain |
| `src/pages/Dashboard.tsx` | Review dashboard with feed + insights |
| `src/pages/Sources.tsx` | New -- manage connected review platforms |
| `src/pages/Pricing.tsx` | Updated pricing for ReviewBrain tiers |
| `supabase/functions/fetch-reviews/` | New -- Trustpilot API integration |
| `supabase/functions/analyze-reviews/` | New -- AI sentiment/theme analysis |
| `supabase/functions/generate-response/` | New -- AI review response drafts |

### User Requirement for Trustpilot

Users will need a Trustpilot API key. The public/Data Solutions API key is free to obtain from Trustpilot's developer portal. For posting replies (Growth plan), they need a Trustpilot Business account with OAuth credentials.

