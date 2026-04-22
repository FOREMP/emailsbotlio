import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendLovableEmail, EmailAPIError } from 'npm:@lovable.dev/email-js@0.0.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function interpolate(tpl: string, vars: Record<string, any>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const v = k.split('.').reduce((acc: any, p: string) => (acc == null ? acc : acc[p]), vars)
    return v == null ? '' : String(v)
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function plainToHtml(s: string): string {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.55;white-space:pre-wrap">${escapeHtml(s)}</div>`
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

function stripExistingSignOff(text: string): string {
  if (!text) return text
  const pattern = /\n+\s*(Best regards|Kind regards|Sincerely|Cheers|Regards|Vänliga hälsningar|Med vänlig hälsning|Mvh|MVH|Hälsningar|Bästa hälsningar)[\s\S]*$/i
  return text.replace(pattern, '').replace(/\s+$/, '')
}

function appendFooter(
  bodyText: string,
  senderName: string,
  company: string,
  unsubscribeUrl: string,
  postalAddress?: string | null,
): string {
  const cleaned = stripExistingSignOff(bodyText)
  const signoff = `Best regards,\n${senderName}\n${company}`
  const legal: string[] = []
  if (postalAddress && postalAddress.trim()) legal.push(postalAddress.trim())
  legal.push(`Don't want to hear from us? Unsubscribe: ${unsubscribeUrl}`)
  return `${cleaned}\n\n${signoff}\n\n---\n${legal.join('\n')}`
}

function normaliseFollowupSubject(orig: string): string {
  const trimmed = (orig ?? '').trim()
  if (!trimmed) return 'Re: (follow-up)'
  if (/^re:\s*/i.test(trimmed)) return trimmed // already prefixed
  return `Re: ${trimmed}`
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
    subject_hint,
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

  // Resolve subject + body
  let finalSubject = ''
  let finalBody = ''
  const vars = { ...contact, ...(contact.custom_fields ?? {}) }

  if (mode === 'ai') {
    if (!prompt) {
      return new Response(JSON.stringify({ error: 'prompt required for ai mode' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const r = await supabase.functions.invoke('generate-email', {
      body: { contact, prompt, subject_hint },
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

  if (!finalSubject || !finalBody) {
    return new Response(JSON.stringify({ error: 'empty subject or body' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // Append branded footer: Best regards, {sender name}, {BRAND}
  const footerBrand = deriveBrand(domain, (domainRow as any).brand)
  finalBody = appendFooter(finalBody, chosenSender.from_name, footerBrand)

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

  try {
    await sendLovableEmail({
      message_id: messageId,
      to: contact.email,
      from: `${chosenSender.from_name} <${fromEmail}>`,
      reply_to: replyTo,
      sender_domain: senderDomain,
      subject: finalSubject,
      html: plainToHtml(finalBody),
      text: finalBody,
      purpose: 'transactional',
      label: 'cold-outreach',
      idempotency_key: messageId,
      unsubscribe_token: unsubscribeToken!,
    } as any, { apiKey, idempotencyKey: messageId })
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
