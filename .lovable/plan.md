

## Plan: Clean up AI prompt, fix footer formatting, add Domains page

### 1. Strip the internal copywriter prompt (use only user's prompt)
**File:** `supabase/functions/generate-email/index.ts`

Currently the function injects a `system` prompt ("You are an expert cold-outreach copywriter…") AND wraps the user's input with `Contact data:\n…\n\nWriting brief:\n…\n\nReturn JSON…`. This contaminates the user's intent.

Change to: pass the user's prompt **verbatim** as the only instruction. Keep just a minimal JSON-format instruction so we can still parse the response:
- `system`: `Return ONLY a JSON object: {"subject":"...","body":"..."}. No other text.`
- `user`: the raw `prompt` from the request, plus the contact JSON appended only if the prompt references variables. Subject hint stays optional.

Also: **strip any "Best regards / signature / footer" lines the model returns** before saving, since the send function appends its own footer. Use a regex that trims trailing `Best regards`, `Vänliga hälsningar`, `Med vänlig hälsning`, `Mvh`, signatures, and brand caps lines.

### 2. Fix footer formatting (no double blank lines)
**File:** `supabase/functions/send-cold-email/index.ts` — `appendFooter()`

Current output:
```
{body}

Vänliga hälsningar,
King Mongenen   ← from AI body

Best regards,         ← appended

Eric Wahlbom

FOREMP
```

Two problems:
- AI already wrote a sign-off ("Vänliga hälsningar, King Mongenen") and we stack a second one on top.
- Appended footer uses double newlines between every line → visually loose.

Fix:
- Before appending, detect & strip any existing trailing sign-off block in the body (regex matching `Best regards|Vänliga hälsningar|Med vänlig hälsning|Mvh|Sincerely|Cheers` followed by 1–3 lines, to end of string).
- New footer format (single blank line between body and footer, single newlines inside it):
  ```
  {body trimmed}

  Best regards,
  {sender from_name}
  {BRAND}
  ```
- Update `plainToHtml` so it preserves these single newlines as `<br>` (currently `white-space:pre-wrap` already does, so just trim the body cleanly).

### 3. New "Domains" page so user can inspect verification status
**Files:**
- New: `src/pages/Domains.tsx`
- `src/App.tsx` — add `/domains` route
- `src/components/AppLayout.tsx` (or `Header.tsx`) — add nav link

Page contents (read-only, no editing — `sending_domains` has no INSERT/UPDATE RLS for end users):
- Table of all 6 domains with columns: **Domain**, **Brand**, **Sender subdomain** (e.g. `notify.foremp.one`), **Reply-to**, **Active**, **Verified**.
- Verified column shows green "Verified — can send" badge or red "Not verified — cannot send" badge.
- For unverified rows, an info card below lists the 5 unverified domains and explains: each must be added in **Cloud → Emails → Manage Domains** and DNS-delegated to Lovable's nameservers. Once Lovable shows the domain as active, an admin flips `is_verified = true`.
- Currently 1 verified (`foremp.one`) and 5 unverified (`botlio.email`, `botlio.eu`, `botlio.io`, `foremp.email`, `foremp.eu`).

### 4. Files touched
- `supabase/functions/generate-email/index.ts` — strip internal copywriter prompt + scrub model sign-offs
- `supabase/functions/send-cold-email/index.ts` — strip body sign-off, tighten footer spacing
- `src/pages/Domains.tsx` — new
- `src/App.tsx` — register route
- `src/components/AppLayout.tsx` — nav link to Domains

### Validation
- Create AI-mode `send_email` node with prompt `"Write a 2-sentence email in Swedish to {{first_name}} about discounting their Foremp BA subscription. Subject: short hook."` and verify the sent email reflects ONLY that brief — no generic "expert cold outreach" tone.
- Confirm the footer reads exactly:
  ```
  Best regards,
  Eric Wahlbom
  FOREMP
  ```
  (one blank line between body and `Best regards`, single newlines inside).
- Open `/domains`, see all 6 domains with correct verified/unverified badges.

