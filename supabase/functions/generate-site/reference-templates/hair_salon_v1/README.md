# hair_salon_v1 — Reference template (INACTIVE)

Editorial hair-salon template (dark wine + gold + cream palette, serif display + Work Sans body).
Original layout by user; contact/booking forms have been stripped — CTAs point to phone/email instead.

**Status:** stored for future use. Not wired into the generator yet.
The generator currently uses `SECTION_LIBRARY` in `../templates.ts` for every niche.

## When to activate
When a `site_leads` row is in the hair-salon / beauty-salon niche, `process-site-jobs`
should branch on `generated_sites.template` (e.g. `hair_salon_v1`) and inline these
HTML/CSS files with brand tokens + real copy swapped in — same shape as the existing
`auto_workshop_v1` flow. Do NOT re-introduce a contact form; keep tel/mailto CTAs.

## Files
- `index.html`     — home (hero, services, testimonial, CTA banner w/ phone link)
- `about.html`     — studio story, values, team
- `services.html`  — pricing/service breakdown
- `contact.html`   — visit / hours / phone / email + FAQ (no form)
- `style.css`      — full design system
- `app.js`         — nav toggle + FAQ accordion
