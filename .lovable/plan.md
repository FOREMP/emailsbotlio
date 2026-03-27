

## Plan: Pivot to Email & SMS Marketing Platform

### What's changing

Removing all simulation engine code and data. Keeping authentication and the keep-alive cron function. Rebuilding as an e-commerce email/SMS marketing platform.

### What to remove

- **Database**: Drop tables `simulations`, `seed_materials`, `agents`, `reports`, related enums, and the `seed-materials` storage bucket
- **Edge functions**: Delete `process-materials/` and `run-simulation/`
- **Pages**: Remove `SimulationNew.tsx`, `SimulationDetail.tsx`. Gut `Dashboard.tsx` and `Index.tsx` of all simulation references
- **Routes**: Remove `/simulation/new` and `/simulation/:id` from `App.tsx`
- **Plan file**: Rewrite `.lovable/plan.md` for the new product

### What to keep

- Auth system (`AuthContext`, `ProtectedRoute`, `Auth.tsx`, profiles table)
- Keep-alive edge function + cron job
- All UI component library (shadcn)
- Supabase client setup

### What the new landing page & dashboard will say

- **Landing page**: Rebranded for email/SMS marketing — features like contact lists, AI-powered campaigns, review collection, embeddable widgets
- **Dashboard**: Empty shell ready for future features — show "no campaigns yet" state with a CTA to create one

### New product roadmap (built into the project)

1. **Contact list management** — Upload CSV/manual entry of contacts (name, email, phone, custom fields). Store in a `contacts` + `contact_lists` table structure
2. **Email campaign builder** — Template editor with variable interpolation (`{{name}}`, `{{email}}`), AI generation via OpenAI, send via Resend
3. **SMS campaign builder** — Same concept for SMS, send via Twilio or similar
4. **Review collection** — Special email type with in-email rating UI, response collection, dashboard view, and an embeddable JS widget for e-commerce sites
5. **Analytics dashboard** — Campaign stats, delivery rates, review scores

### Implementation order (this message)

1. Create migration to drop simulation tables, enums, and storage bucket
2. Delete simulation edge function files
3. Rewrite `Index.tsx` as new product landing page
4. Rewrite `Dashboard.tsx` as empty-state marketing dashboard
5. Remove simulation routes from `App.tsx`, delete simulation page files
6. Update `.lovable/plan.md` with new product plan

### Technical notes

- Migration will `DROP TABLE` with `CASCADE` for `agents`, `reports`, `seed_materials`, `simulations` and drop the `simulation_status` and `material_type` enums
- Storage bucket `seed-materials` will be dropped
- Resend, OpenAI, and SMS API integrations will be set up in future phases when we build the campaign features

