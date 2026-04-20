

## Plan: Fix `send-cold-email` boot crash so emails actually send

### Root cause
`supabase/functions/send-cold-email/index.ts` declares `brand` twice:

1. **Line ~57** — destructured from the request body (used when `strategy === 'brand'` to filter senders by brand):
   ```ts
   const { user_id, sender_id, strategy, brand, contact, ... } = body
   ```
2. **Line ~143** — re-declared as the derived footer brand (e.g. `FOREMP`):
   ```ts
   const brand = deriveBrand(domain, (domainRow as any).brand)
   ```

Deno refuses to boot the module: `SyntaxError: Identifier 'brand' has already been declared`. Every cron tick that tries to send returns "non-2xx status code" and the enrollment errors out — which matches the `run-sequences` logs showing `errors=2` right after the schedule node advanced.

This is the ONLY blocking error. The rest of the pipeline (enrollment, schedule node, throttle, advancement) is working — logs show enrollments correctly progressing trigger → schedule → throttle → send_email, only failing at the actual send step.

### Fix

**1. Rename the footer-brand variable** in `supabase/functions/send-cold-email/index.ts`
- Change line ~143 from `const brand = deriveBrand(...)` to `const footerBrand = deriveBrand(domain, (domainRow as any).brand)`.
- Update the `appendFooter(finalBody, chosenSender.from_name, brand)` call on the next line to use `footerBrand`.
- Leave the request-body `brand` (used for sender pool filtering) untouched.

**2. Redeploy the function** so the fix takes effect (Edge Functions only run the last deployed code).

**3. Verify with logs**
- After deploy, watch `send-cold-email` logs for a clean boot (no `BootFailure`).
- Watch `run-sequences` logs for the next cron tick — expect `sent=1+` instead of `errors=2`.
- Confirm a row appears in `sent_emails` with `status='sent'` and the recipient receives an email whose footer reads:
  ```
  Best regards,

  {sender from_name}

  FOREMP
  ```

### Files touched
- `supabase/functions/send-cold-email/index.ts` (rename one variable + its single usage)

### Other errors checked — none blocking
- `run-sequences` logs are clean: it picks enrollments, advances schedule/throttle nodes correctly, only fails at the send step (caused by the boot crash above).
- `enroll-contacts` only shows shutdown events — no errors since the previous fix.
- React `forwardRef` warnings in the browser console are unrelated noise (dev-only warning about `AppLayout`/`Header`/`Dashboard`), not blocking email sending.

