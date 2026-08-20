import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendLovableEmail, EmailAPIError } from 'npm:@lovable.dev/email-js@0.0.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STOCKHOLM_TZ = 'Europe/Stockholm'

function interpolate(tpl: string, vars: Record<string, any>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const v = k.split('.').reduce((acc: any, p: string) => (acc == null ? acc : acc[p]), vars)
    return v == null ? '' : String(v)
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function linkify(escaped: string): string {
  // Runs on already HTML-escaped text. Turns bare URLs / www. links into
  // clickable anchors so recipients don't have to copy-paste them.
  return escaped.replace(
    /(https?:\/\/[^\s<]+|www\.[^\s<]+)/g,
    (raw) => {
      // Don't swallow trailing sentence punctuation into the link.
      const m = raw.match(/^(.*?)([.,;:!?)\]]*)$/s)!
      const link = m[1]
      const tail = m[2] ?? ''
      if (!link) return raw
      const href = link.startsWith('http') ? link : `https://${link}`
      return `<a href="${href}" style="color:#1a73e8;text-decoration:underline" target="_blank" rel="noopener">${link}</a>${tail}`
    },
  )
}

function plainToHtml(s: string, trackingPixelUrl?: string): string {
  // Convert newlines to <br> explicitly — many email clients (Gmail, Outlook)
  // strip CSS like `white-space: pre-wrap`, which collapses \n into spaces and
  // makes the signature appear on one line ("Best regards, Name, Company").
  const escaped = linkify(escapeHtml(s)).replace(/\r\n/g, '\n').replace(/\n/g, '<br>')
  const pixel = trackingPixelUrl
    ? `<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:block;border:0;outline:none;height:1px;width:1px;opacity:0" />`
    : ''
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.55">${escaped}${pixel}</div>`
}

// Tracking pixel URL. Prefer a host stored on the sending domain (e.g.
// https://t.foremp.email) so the image host matches the From domain — a remote
// image from an unrelated *.supabase.co host is one of the strongest "bulk mail"
// signals Gmail looks at. Falls back to TRACKING_BASE_URL, then the Supabase
// function URL when nothing else is configured.
function trackingPixelUrl(domainRow: any, supabaseUrl: string, messageId: string): string {
  const domainHost = (domainRow?.tracking_host ?? '').trim().replace(/\/+$/, '')
  const globalHost = (Deno.env.get('TRACKING_BASE_URL') ?? '').trim().replace(/\/+$/, '')
  const base = domainHost || globalHost || `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/track-open`
  return `${base}/o/${encodeURIComponent(messageId)}.gif`
}




function deriveCompany(domain: string, brandFromDb?: string | null): string {
  if (brandFromDb && brandFromDb.trim()) {
    const b = brandFromDb.trim()
    // If admin stored an all-caps brand, normalise to Title Case for the footer
    if (b === b.toUpperCase()) return b.charAt(0) + b.slice(1).toLowerCase()
    return b
  }
  const root = (domain.split('.')[0] ?? domain).toLowerCase()
  return root.charAt(0).toUpperCase() + root.slice(1)
}

const CONTACT_PHONE = '076 190 5353'

// Account-agnostic: our canonical demo URLs are always https://demo-<slug>-<id8>.vercel.app,
// oavsett vilket Vercel-konto/team som äger projektet.
const CANONICAL_DEMO_HOST = /^demo-[a-z0-9-]+\.vercel\.app$/

function isCanonicalDemoUrl(value?: string | null): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    if (!CANONICAL_DEMO_HOST.test(url.hostname)) return false
    // legacy team-scopade preview-hostar är aldrig publika
    if (/-(foremp|[a-z0-9]+s-projects)\.vercel\.app$/.test(url.hostname)) return false
    return true
  } catch {
    return false
  }
}

function stripExistingSignOff(text: string): string {
  if (!text) return text
  const pattern = /\n+\s*(Best regards|Kind regards|Sincerely|Cheers|Regards|Vänliga hälsningar|Med vänlig hälsning|Mvh|MVH|Hälsningar|Bästa hälsningar)[\s\S]*$/i
  return text.replace(pattern, '').replace(/\s+$/, '')
}

function appendFooter(
  bodyText: string,
  senderName: string,
  company: string,
  postalAddress?: string | null,
  language?: string | null,
): string {
  const cleaned = stripExistingSignOff(bodyText)
  const isEnglish = String(language ?? '').toLowerCase().startsWith('en')
  // Sign-off: greeting / name / phone / Company (normal casing — ALL CAPS reads
  // as bulk mail to Gmail's classifier and pushes us into Promotions/Spam).
  const greeting = isEnglish ? 'Best regards' : 'Vänliga hälsningar'
  const signoff = `${greeting}\n${senderName}\n${CONTACT_PHONE}\n${company}`
  const legal = (postalAddress ?? '').trim()
  // No "---" separator block: a divider + address block is a classic newsletter
  // pattern. One quiet line instead.
  const legalBlock = legal ? `\n${legal}` : ''
  return `${cleaned}\n\n${signoff}${legalBlock}`
}


function normaliseFollowupSubject(orig: string): string {
  const trimmed = (orig ?? '').trim()
  if (!trimmed) return 'Re: (follow-up)'
  if (/^re:\s*/i.test(trimmed)) return trimmed // already prefixed
  return `Re: ${trimmed}`
}

function startOfStockholmDayUtc(now = new Date()): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: STOCKHOLM_TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now).map((p) => [p.type, p.value])) as any
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 0, 0, 0))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')!
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(url, svc)

  let body: any
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const {
    user_id,
    sender_id,
    strategy,
    brand,
    contact,
    sequence_id,
    enrollment_id,
    node_id,
    throttle_node_id,
    mode,
    subject,
    body: bodyText,
    prompt,
    subject_prompt,        // dedicated subject prompt (per node)
    subject_hint,          // legacy fallback
    model,                 // optional per-node model override
    subject_override,      // forces subject verbatim (used for follow-ups: "Re: <original>")
    is_followup,           // hint to AI it's a follow-up nudge
    unsubscribe_base_url,  // optional override
  } = body ?? {}

  if (!user_id) return new Response(JSON.stringify({ error: 'user_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  if (!contact?.email) return new Response(JSON.stringify({ error: 'contact.email required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  // Suppression check
  const { data: suppressed } = await supabase.from('suppressed_emails').select('id').eq('email', contact.email.toLowerCase()).maybeSingle()
  if (suppressed) {
    return new Response(JSON.stringify({ skipped: 'suppressed' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
  const { data: dnc } = await supabase.from('do_not_contact').select('id').eq('user_id', user_id).eq('email', contact.email.toLowerCase()).maybeSingle()
  if (dnc) {
    return new Response(JSON.stringify({ skipped: 'do_not_contact' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // Load verified domains (only these can actually send)
  const { data: verifiedDomainRows } = await supabase
    .from('sending_domains')
    .select('*')
    .eq('is_active', true)
    .eq('is_verified', true)
  const verifiedDomains = new Set((verifiedDomainRows ?? []).map((d: any) => d.domain as string))
  if (verifiedDomains.size === 0) {
    return new Response(JSON.stringify({ error: 'no verified sending domain configured' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // Pick sender
  let chosenSender: any = null
  if (sender_id) {
    const { data } = await supabase.from('senders').select('*').eq('id', sender_id).eq('user_id', user_id).maybeSingle()
    chosenSender = data
    if (chosenSender) {
      const dom = (chosenSender.from_email as string).split('@')[1]
      if (!verifiedDomains.has(dom)) {
        return new Response(JSON.stringify({ error: `sender domain "${dom}" is not verified with Lovable Emails — only ${[...verifiedDomains].join(', ')} can send` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
    }
  } else {
    let q = supabase.from('senders').select('*').eq('user_id', user_id).eq('is_active', true)
    const { data: all } = await q
    let pool = (all ?? []).filter((s: any) => verifiedDomains.has((s.from_email as string).split('@')[1]))
    if (strategy === 'brand' && brand) {
      pool = pool.filter((s: any) => (s.from_email as string).endsWith(`@${brand}.io`) || (s.from_email as string).endsWith(`@${brand}.eu`) || (s.from_email as string).endsWith(`@${brand}.email`) || (s.from_email as string).endsWith(`@${brand}.one`))
    }
    if (pool.length === 0) {
      return new Response(JSON.stringify({ error: `no verified senders available — only ${[...verifiedDomains].join(', ')} are verified with Lovable Emails` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    chosenSender = pool[Math.floor(Math.random() * pool.length)]
  }
  if (!chosenSender) {
    return new Response(JSON.stringify({ error: 'sender not found' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // Look up domain registry → derive reply-to + sender subdomain
  const fromEmail = chosenSender.from_email as string
  const domain = fromEmail.split('@')[1]
  const domainRow = (verifiedDomainRows ?? []).find((d: any) => d.domain === domain)
  if (!domainRow) {
    return new Response(JSON.stringify({ error: `domain ${domain} not verified or not in registry` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
  const senderDomain = `${domainRow.sender_subdomain}.${domain}` // e.g. notify.foremp.eu
  const replyTo = domainRow.reply_to_email

  const contactFields = (contact?.custom_fields ?? {}) as Record<string, any>
  const canonicalDemoUrl =
    (isCanonicalDemoUrl(contact?.demo_site_url) ? contact.demo_site_url : null)
    ?? (isCanonicalDemoUrl(contactFields.demo_url) ? String(contactFields.demo_url) : null)
    ?? (isCanonicalDemoUrl(contact?.demo_url) ? contact.demo_url : null)

  const requiresDemoUrl = [
    typeof prompt === 'string' ? prompt : '',
    typeof subject_prompt === 'string' ? subject_prompt : '',
    typeof subject_hint === 'string' ? subject_hint : '',
    typeof subject === 'string' ? subject : '',
    typeof bodyText === 'string' ? bodyText : '',
  ].some((value) => value.includes('{{demo_url}}')) || !!contactFields.site_lead_id

  if (requiresDemoUrl && !canonicalDemoUrl) {
    return new Response(JSON.stringify({ skipped: 'invalid_demo_url' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Resolve subject + body
  let finalSubject = ''
  let finalBody = ''
  const vars = { ...contact, ...contactFields, ...(canonicalDemoUrl ? { demo_url: canonicalDemoUrl } : {}) }

  if (mode === 'ai') {
    if (!prompt) {
      return new Response(JSON.stringify({ error: 'prompt required for ai mode' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const r = await supabase.functions.invoke('generate-email', {
      body: {
        contact,
        prompt,
        subject_prompt: subject_prompt ?? subject_hint ?? '',
        subject_hint, // legacy fallback for older deployments
        is_followup: !!is_followup,
        model,
      },
    })
    if (r.error) {
      return new Response(JSON.stringify({ error: 'generate-email failed', detail: r.error.message }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    finalSubject = (r.data as any).subject || subject_hint || 'Hello'
    finalBody = (r.data as any).body || ''
  } else {
    finalSubject = interpolate(subject ?? '', vars)
    finalBody = interpolate(bodyText ?? '', vars)
  }

  // Force the subject for follow-ups so most clients group it as one thread
  if (subject_override && typeof subject_override === 'string' && subject_override.trim()) {
    finalSubject = normaliseFollowupSubject(subject_override)
  }

  if (!finalSubject || !finalBody) {
    return new Response(JSON.stringify({ error: 'empty subject or body' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const messageId = crypto.randomUUID()

  // Get-or-create unsubscribe token for this recipient (one per email address)
  const recipientLower = contact.email.toLowerCase()
  let unsubscribeToken: string | null = null
  {
    const { data: existing } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', recipientLower)
      .maybeSingle()
    if (existing?.token) {
      unsubscribeToken = existing.token
    } else {
      const newToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
      const { data: ins } = await supabase
        .from('email_unsubscribe_tokens')
        .insert({ email: recipientLower, token: newToken })
        .select('token')
        .maybeSingle()
      unsubscribeToken = ins?.token ?? newToken
    }
  }

  // Append sender footer only. The Lovable Email API requires the token below
  // and adds the single visible unsubscribe link itself, so we do not duplicate
  // it in the Best regards footer.
  const company = deriveCompany(domain, (domainRow as any).brand)
  const footerLanguage =
    (contactFields.language as string | undefined)
    ?? (contact?.language as string | undefined)
    ?? (chosenSender.language as string | undefined)
    ?? (domain.endsWith('.eu') ? 'en' : 'sv')
  finalBody = appendFooter(
    finalBody,
    chosenSender.from_name,
    company,
    (domainRow as any).postal_address ?? null,
    footerLanguage,
  )

  // Final safety rails before creating a queued row.
  if (enrollment_id) {
    const { count: sentCount } = await supabase
      .from('sent_emails')
      .select('id', { count: 'exact', head: true })
      .eq('enrollment_id', enrollment_id)
      .in('status', ['sent', 'queued'])

    if ((sentCount ?? 0) >= 4) {
      await supabase.from('enrollments').update({
        status: 'completed',
        current_step: 4,
        next_send_at: null,
        deferred_at: null,
        last_error: null,
        error_at: null,
      }).eq('id', enrollment_id)
      return new Response(JSON.stringify({ skipped: 'sequence_limit_reached' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString()
    const { data: recentDuplicate } = await supabase
      .from('sent_emails')
      .select('id, sent_at, subject, status')
      .eq('enrollment_id', enrollment_id)
      .eq('recipient_email', contact.email)
      .in('status', ['sent', 'queued'])
      .gte('sent_at', tenMinutesAgo)
      .order('sent_at', { ascending: false })
      .limit(1)

    if ((recentDuplicate ?? []).length > 0) {
      return new Response(JSON.stringify({ skipped: 'recent_duplicate_blocked' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  {
    const startOfDay = startOfStockholmDayUtc()
    const { data: alreadyToday } = await supabase
      .from('sent_emails')
      .select('id, sent_at')
      .eq('contact_id', contact.id ?? null)
      .eq('user_id', user_id)
      .in('status', ['sent', 'queued'])
      .gte('sent_at', startOfDay.toISOString())
      .limit(1)

    if ((alreadyToday ?? []).length > 0) {
      return new Response(JSON.stringify({ skipped: 'already_sent_today' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  // Log pending
  await supabase.from('sent_emails').insert({
    id: messageId,
    user_id,
    sender_id: chosenSender.id,
    contact_id: contact.id ?? null,
    enrollment_id: enrollment_id ?? null,
    recipient_email: contact.email,
    subject: finalSubject,
    body: finalBody,
    status: 'queued',
    message_id: messageId,
  })

  // Send directly via the Lovable email API (no queue dependency)
  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  if (!apiKey) {
    await supabase.from('sent_emails').update({ status: 'failed', error_message: 'LOVABLE_API_KEY missing' }).eq('id', messageId)
    return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY missing' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // Mail 1 (the cold first touch) goes out as plain text with no tracking pixel:
  // a short text-only 1:1 mail almost never lands in Promotions, and mail 1 is
  // the message that decides how the whole thread gets classified.
  const isFirstTouch = !is_followup
  const basePayload: Record<string, any> = {
    message_id: messageId,
    to: contact.email,
    from: `${chosenSender.from_name} <${fromEmail}>`,
    reply_to: replyTo,
    sender_domain: senderDomain,
    subject: finalSubject,
    text: finalBody,
    purpose: 'transactional',
    label: 'cold-outreach',
    idempotency_key: messageId,
    unsubscribe_token: unsubscribeToken,
  }

  try {
    if (isFirstTouch) {
      try {
        await sendLovableEmail(basePayload as any, { apiKey, idempotencyKey: messageId })
      } catch (err) {
        // Some API versions require an html part — fall back to a bare HTML
        // rendering (still no tracking pixel) rather than failing the send.
        const msg = err instanceof Error ? err.message : String(err)
        if (!/html/i.test(msg)) throw err
        await sendLovableEmail(
          { ...basePayload, html: plainToHtml(finalBody) } as any,
          { apiKey, idempotencyKey: messageId },
        )
      }
    } else {
      await sendLovableEmail(
        { ...basePayload, html: plainToHtml(finalBody, trackingPixelUrl(domainRow, url, messageId)) } as any,
        { apiKey, idempotencyKey: messageId },
      )
    }

    await supabase.from('sent_emails').update({ status: 'sent' }).eq('id', messageId)

  } catch (err) {
    const detail = err instanceof EmailAPIError ? `${err.status}: ${err.message}` : (err instanceof Error ? err.message : String(err))
    await supabase.from('sent_emails').update({ status: 'failed', error_message: detail }).eq('id', messageId)
    return new Response(JSON.stringify({ error: 'send failed', detail }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // Log activity
  if (sequence_id && contact.id) {
    await supabase.from('contact_activity').insert({
      user_id,
      contact_id: contact.id,
      sequence_id,
      node_id: node_id ?? null,
      activity_type: 'email_sent',
      metadata: {
        sender_id: chosenSender.id,
        from: fromEmail,
        subject: finalSubject,
        message_id: messageId,
        throttle_node_id: throttle_node_id ?? null,
      },
    })
  }

  return new Response(JSON.stringify({
    success: true,
    message_id: messageId,
    sender: { id: chosenSender.id, from: fromEmail, name: chosenSender.from_name },
    reply_to: replyTo,
    sender_domain: senderDomain,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
