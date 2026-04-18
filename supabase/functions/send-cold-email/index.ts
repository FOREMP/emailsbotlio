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
    sender_id,            // optional: explicit sender; otherwise rotate per `strategy`
    strategy,             // 'all' | 'brand' | 'specific'
    brand,                // when strategy === 'brand'
    contact,              // { id, email, first_name, last_name, custom_fields }
    sequence_id,
    enrollment_id,
    node_id,
    mode,                 // 'ai' | 'template' | 'test'
    subject,              // required for template/test
    body: bodyText,       // required for template/test
    prompt,               // required for ai
    subject_hint,
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

  // Pick sender
  let chosenSender: any = null
  if (sender_id) {
    const { data } = await supabase.from('senders').select('*').eq('id', sender_id).eq('user_id', user_id).maybeSingle()
    chosenSender = data
  } else {
    let q = supabase.from('senders').select('*').eq('user_id', user_id).eq('is_active', true)
    const { data: all } = await q
    let pool = all ?? []
    if (strategy === 'brand' && brand) {
      pool = pool.filter((s: any) => (s.from_email as string).endsWith(`@${brand}.io`) || (s.from_email as string).endsWith(`@${brand}.eu`) || (s.from_email as string).endsWith(`@${brand}.email`) || (s.from_email as string).endsWith(`@${brand}.one`))
    }
    if (pool.length === 0) {
      return new Response(JSON.stringify({ error: 'no senders available' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    chosenSender = pool[Math.floor(Math.random() * pool.length)]
  }
  if (!chosenSender) {
    return new Response(JSON.stringify({ error: 'sender not found' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // Look up domain registry → derive reply-to + sender subdomain
  const fromEmail = chosenSender.from_email as string
  const domain = fromEmail.split('@')[1]
  const { data: domainRow } = await supabase.from('sending_domains').select('*').eq('domain', domain).eq('is_active', true).maybeSingle()
  if (!domainRow) {
    return new Response(JSON.stringify({ error: `domain ${domain} not in sending_domains registry` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
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

  const messageId = crypto.randomUUID()

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
    }, { apiKey, idempotencyKey: messageId })
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
      metadata: { sender_id: chosenSender.id, from: fromEmail, subject: finalSubject, message_id: messageId },
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
