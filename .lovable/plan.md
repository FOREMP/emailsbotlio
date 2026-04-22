

# Audit Result + Three Targeted Fixes

I re-traced your scenario end to end. Here is what's currently true, what needs adjusting, and what is unfortunately not possible.

## Audit (post-fix verification)

| Area | Status |
|---|---|
| Schedule node fires at the configured Stockholm time | ✅ Works |
| Throttle is now per-node (so 30-min follow-ups aren't blocked by initial batch) | ✅ Fixed last round |
| Wait 30 min between emails | ✅ Works |
| Unsubscribe during wait → enrollment cancelled before next send | ✅ Works (re-checked every tick against `do_not_contact` + `suppressed_emails`) |
| End node closes sequence | ✅ Works |
| New sequence skips contacts already emailed | ✅ Fixed last round (with optional "Publish & re-contact" override) |
| Footer format | ⚠️ Already 3 lines, but want a polish — see Fix 1 |
| Follow-ups thread to the original email | ❌ Not fully possible — see Fix 2 |
| GDPR posture | ⚠️ Mostly there, missing 3 small items — see Fix 3 |

## Fix 1 — Footer: "Best regards, / name / company" exactly

The footer is already three lines, but the third line uses an UPPERCASED brand derived from the domain (e.g. `FOREMP`). You want the human-readable company name. Change to:
- Line 1: `Best regards,`
- Line 2: sender's display name (e.g. `Eric Wahlbom`)
- Line 3: company name in normal case — pulled from `sending_domains.brand` if set, otherwise the capitalised root domain (e.g. `Foremp`, not `FOREMP`)

Implementation: update `deriveBrand` and `appendFooter` in `supabase/functions/send-cold-email/index.ts`. The existing sign-off stripper already removes any duplicate "Best regards" added by the AI, so this stays clean even when AI mode generates its own sign-off.

## Fix 2 — Threading Follow-Ups (honest answer)

The Lovable email SDK (`@lovable.dev/email-js@0.0.4`) does **not** expose `In-Reply-To`, `References`, or arbitrary header fields. So a true RFC-compliant thread (where Gmail/Outlook collapses the follow-up into the same conversation) is **not possible today** with our infrastructure.

What we *can* do, which is what most ESPs fall back to and what gets ~90% of the visual benefit:
- When the runner sends a follow-up email to a contact who already received an earlier email in the same enrollment, **reuse the original subject prefixed with `Re: `** (only one `Re:`, never `Re: Re: Re:`).
- Most mail clients group messages with the same normalized subject + same participants into one visual conversation, so the recipient sees "two replies in one thread" exactly as you described.

Implementation:
- In `run-sequences/index.ts`, before invoking `send-cold-email` for a `send_email` node, look up the **first** `sent_emails` row for this enrollment. If one exists, pass `subject_override: "Re: <original subject>"` and `is_followup: true` to `send-cold-email`.
- In `send-cold-email`, if `subject_override` is provided, use it verbatim (skip AI subject generation; AI still writes the body so the follow-up reads naturally as a nudge).
- The body for follow-ups stays freshly generated/templated — we don't quote the original because the SDK can't attach proper threading headers anyway, and quoted text without proper headers looks worse than a clean short follow-up.

Trade-off you should know about: without true `In-Reply-To` headers, threading is best-effort. Gmail almost always groups them; Outlook usually does; some clients won't. This is the same compromise other lightweight outreach tools make.

## Fix 3 — GDPR Compliance Polish

Already in place: one-click unsubscribe, suppression list enforced on every send, DNC checked at enrollment and at every runner tick, no third-party tracking pixels, RLS isolates each user's data.

Three gaps to close:

1. **Unsubscribe footer in the email itself.** Right now the unsubscribe link comes from the Lovable email infrastructure (List-Unsubscribe header + auto-appended footer). Confirm in the audit it is actually being appended for these cold-outreach sends; if not, add a visible plain-text line at the very bottom of every send: `Unsubscribe: https://emailsbotlio.lovable.app/unsubscribe?token=...`. Required by GDPR Art. 21 + ePrivacy + CAN-SPAM. Token already exists per recipient.
2. **Sender identity in every email.** GDPR + CAN-SPAM require a physical/postal identifier of the sender. Add an optional `postal_address` column to `sending_domains` and append it on a 4th footer line when set. Without an address set, the email still sends but you'll see a one-time warning in the Domains UI.
3. **"Forget this contact" action.** Add a button on the Contacts page → "Erase contact (GDPR right to be forgotten)" that:
   - Deletes the contact row
   - Adds the email to `do_not_contact` and `suppressed_emails` so they can never be re-imported
   - Marks any active enrollments as `unsubscribed`
   - Records what was erased (timestamp + email hash, not plaintext) in a small `gdpr_erasures` audit table

Out of scope unless you ask: a public-facing privacy policy page, a data-export endpoint (right to portability for *contacts* — usually only needed if your contacts can log in, which they can't here).

## Files Touched

- `supabase/functions/send-cold-email/index.ts` — new footer (3 lines, normal-case company), accept `subject_override` for follow-ups, append visible unsubscribe line + optional postal address.
- `supabase/functions/run-sequences/index.ts` — detect follow-up sends, look up original subject, pass `subject_override: "Re: <original>"`.
- `src/pages/Contacts.tsx` — "Erase contact" button + confirmation dialog.
- `src/pages/Domains.tsx` — postal-address field per domain (with GDPR helper text).
- New migration: add `sending_domains.postal_address text`, create `gdpr_erasures` table with RLS.
- Redeploy: `send-cold-email`, `run-sequences`.

## Caveats Worth Repeating

- True email threading with `In-Reply-To` is **not** available; we use subject-based threading as the best fallback.
- GDPR is a process, not just code — a privacy policy page, a DPA with sub-processors (Supabase, Lovable Email/Mailgun, Lovable AI), and a lawful basis for cold outreach (legitimate interest assessment) are still your responsibility outside the app.

