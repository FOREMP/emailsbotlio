## MiroFish — Email & SMS Marketing Platform for E-commerce

### What We're Building

A marketing platform where e-commerce store owners can import customer lists, create AI-powered email and SMS campaigns, and collect product reviews — all from one dashboard.

### Core Features

1. **Contact Management** — Upload CSV or manually add contacts (name, email, phone, custom fields). Organize into lists.
2. **Email Campaigns** — Template editor with variable interpolation (`{{name}}`, `{{email}}`, custom fields). AI-powered content generation via OpenAI. Send via Resend.
3. **SMS Campaigns** — Same variable system for SMS. AI generation. Send via Twilio or similar.
4. **Review Collection** — Special email type with in-email star rating. Customer clicks a rating directly in the email, response is saved. Dashboard shows all reviews. Embeddable JS widget for the store's website with real-time review display.
5. **Analytics Dashboard** — Campaign stats (sent, delivered, opened, clicked), review scores, contact growth.

### Technical Stack

- **Frontend**: React + Vite + Tailwind + shadcn/ui
- **Backend**: Supabase (auth, database, edge functions, storage)
- **Email sending**: Resend API
- **AI copywriting**: OpenAI API (via edge functions)
- **SMS sending**: Twilio or similar (TBD)
- **Auth**: Supabase Auth (already implemented)

### Database Schema (planned)

- `profiles` — exists, stores user info and credits
- `contact_lists` — id, user_id, name, created_at
- `contacts` — id, user_id, list_id, email, phone, first_name, last_name, custom_fields (jsonb), created_at
- `campaigns` — id, user_id, type (email/sms), name, subject, body_template, status (draft/sending/sent), sent_count, created_at
- `campaign_recipients` — id, campaign_id, contact_id, status (pending/sent/delivered/opened/clicked/failed), sent_at
- `reviews` — id, user_id, product_name, product_id, contact_id, rating, comment, created_at
- `review_widgets` — id, user_id, product_id, config (jsonb), created_at

### Implementation Order

1. **Phase 1**: Contact list management (tables, CSV upload, list UI)
2. **Phase 2**: Email campaign builder (template editor, variable system, Resend integration)
3. **Phase 3**: SMS campaign builder (Twilio integration)
4. **Phase 4**: Review collection system (in-email rating, dashboard, embeddable widget)
5. **Phase 5**: Analytics dashboard, polish, error handling

### What's Already Done

- Auth system (signup, login, protected routes, profiles table)
- Keep-alive cron function
- Landing page and dashboard shell (empty state)
- UI component library (shadcn)
