# US TX outreach — Botlio "I made you a draft" sequence

A new sequence for the list **US TX companys website** (408 contacts), sent from the Botlio domains, with no site built up front. The goal of the whole flow is one reply: "yes, send it over." You then build the site and send it manually.

## 1. Warm the Botlio senders back up

The four active Botlio senders (`eric@` / `isak@` on botlio.email and botlio.eu) are set to 25/day with no warm-up and have been idle. Restart them cold:

- Turn warm-up on for all four, start date = today, target 25/day.
- Set `daily_limit` to 25 (the target ceiling); the warm-up ramp caps actual sends.
- Ramp already built into the runner: day 1 = 5, day 2 = 10 … day 6 = 30, then +10/day, capped at target.
- Deactivate nothing else; foremp senders keep running unchanged.

Resulting real volume: ~20 emails/day across 4 senders on day 1, ~40 day 2, ~100/day from about day 5-6. 408 contacts get fully enrolled over roughly 2 weeks of weekdays.

Follow-ups keep the existing 3x multiplier, so replies-chasing mail never blocks new first-touches.

## 2. New sequence: "US Website Offer (TX)"

Same shape as the existing EN sequence, but Botlio-branded and with no demo link anywhere.

```text
Trigger (list: US TX companys website)
  -> Throttle 25/day
  -> Schedule Mon-Fri 09:00 (Stockholm; = early morning US)
  -> Mail 1  "saw it might need an update"          (ask permission)
  -> Wait 3 days -> Schedule -> Mail 2  (soft nudge, one concrete angle)
  -> Wait 4 days -> Schedule -> Mail 3  (price: $700 + $150/yr)
  -> Wait 5 days -> Schedule -> Mail 4  (friendly close-out)
  -> End
```

Four emails over ~12 days. All `sender_domain: botlio.email,botlio.eu`, `sender_strategy: brand`, model `gpt-4o-mini`, plain text on mail 1 (best inbox placement), no tracking pixel on mail 1.

## 3. What each email says

**Mail 1 — permission ask (max 60 words).** Came across {{company_name}}, noticed the site looks like it might be due for an update, so I put together a quick draft of what a modern version could look like. Only a draft, everything changeable. Ends with: "Want me to send it over?" No link, no price, no signature block.
Subject lines: curiosity, max 42 chars, e.g. "An idea for {{company_name}}", "Something I put together", "Quick question, {{company_name}}".

**Mail 2 — soft nudge (max 70 words).** Same person, no reply yet. Mentions one concrete thing a better page does for a business in {{category}} — easier for customers to get in touch, a first impression that matches the actual work. Repeats the offer to send it over. Still no link, still no price.

**Mail 3 — price (max 80 words).** States it plainly: **$700 to finish and launch the site, $150 per year for hosting and maintenance.** Changes to design, text, images and pages are made before launch at no extra cost. Ends with "Say the word and I'll send it over."

**Mail 4 — close-out (max 55 words).** I'll drop it unless you want it; happy to keep building on it if you do. Repeats $700 / $150 a year once. A one-word reply is enough.

Shared rules baked into every prompt: never criticise their current site, no URLs, no emojis, no signature (footer is appended automatically in English), sentence case, no placeholders left in the text, idiomatic US English, US spelling and "$" amounts.

## Technical notes

- Warm-up change: `UPDATE senders SET warmup_enabled=true, warmup_started_at=now(), warmup_target=25, daily_limit=25` for the four botlio.email / botlio.eu senders.
- New rows in `sequences` + `sequence_nodes` + edges, cloned in structure from `Site Demo Outreach EN` (`b189fd1b-…`), pointing at `contact_list_id = 856949f5-…`, status `active`.
- No `{{demo_url}}` variable in any prompt, so the sequence is independent of the site-generation pipeline; nothing in `process-site-leads` or the triage queue is touched.
- English footer ("Best regards") already applies for botlio domains via the language detection in `send-cold-email`.
- Enrollment: contacts are enrolled from the list by the existing enroll flow; the throttle plus warm-up caps govern daily output.

## Open point

Reply-to on all Botlio domains is `eric@foremp.se`. Leaving as is unless you want US replies going somewhere else.
