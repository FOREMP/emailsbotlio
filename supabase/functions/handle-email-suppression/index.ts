import { createClient } from 'npm:@supabase/supabase-js@2'
import { WebhookError, verifyWebhookRequest } from 'npm:@lovable.dev/webhooks-js'

interface SuppressionPayload {
  email: string
  reason: 'bounce' | 'complaint' | 'unsubscribe'
  message_id?: string
  metadata?: Record<string, unknown>
  is_retry: boolean
  retry_count: number
}

function parseSuppressionPayload(body: string): SuppressionPayload {
  const parsed = JSON.parse(body)
  if (!parsed.data) throw new Error('Missing data field in payload')
  const data = parsed.data as SuppressionPayload
  if (!data.email || !data.reason) throw new Error('Missing required fields: email, reason')
  return data
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!apiKey || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  let payload: SuppressionPayload
  try {
    const verified = await verifyWebhookRequest({ req, secret: apiKey, parser: parseSuppressionPayload })
    payload = verified.payload
  } catch (error) {
    if (error instanceof WebhookError) {
      const status = error.code === 'invalid_signature' || error.code === 'stale_timestamp' ? 401 : 400
      console.error('Webhook verification failed', { code: error.code })
      return jsonResponse({ error: error.code }, status)
    }
    console.error('Unexpected error during verification', { error })
    return jsonResponse({ error: 'Internal error' }, 500)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const normalizedEmail = payload.email.toLowerCase()

  // 1. Upsert suppressed_emails
  const { error: suppressError } = await supabase
    .from('suppressed_emails')
    .upsert({ email: normalizedEmail, reason: payload.reason }, { onConflict: 'email' })
  if (suppressError) {
    console.error('Failed to upsert suppressed_emails', { error: suppressError })
    return jsonResponse({ error: 'Failed to write suppression' }, 500)
  }

  // 2. Update sent_emails — mark the matching send as bounced/complained
  const newStatus =
    payload.reason === 'bounce' ? 'bounced'
    : payload.reason === 'complaint' ? 'complained'
    : 'unsubscribed'
  const errorMessage =
    payload.reason === 'bounce' ? 'Permanent bounce — receiving server rejected the email'
    : payload.reason === 'complaint' ? 'Spam complaint — recipient marked as spam'
    : 'Recipient unsubscribed'

  const updatePatch: Record<string, unknown> = { status: newStatus, error_message: errorMessage }
  if (payload.reason === 'bounce') {
    updatePatch.bounced_at = new Date().toISOString()
    updatePatch.bounce_type = (payload.metadata as any)?.bounce_type ?? 'hard'
  } else if (payload.reason === 'complaint') {
    updatePatch.complained_at = new Date().toISOString()
  }

  let affectedUserIds: string[] = []
  if (payload.message_id) {
    const { data: rows } = await supabase
      .from('sent_emails')
      .update(updatePatch)
      .eq('message_id', payload.message_id)
      .select('user_id')
    affectedUserIds = (rows ?? []).map((r: any) => r.user_id).filter(Boolean)
  }
  if (affectedUserIds.length === 0) {
    // Fallback: latest send to that recipient
    const { data: latest } = await supabase
      .from('sent_emails')
      .select('id, user_id')
      .eq('recipient_email', normalizedEmail)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latest?.id) {
      await supabase.from('sent_emails').update(updatePatch).eq('id', latest.id)
      if (latest.user_id) affectedUserIds = [latest.user_id]
    }
  }

  // 3. For unsubscribes, mirror into do_not_contact for every user that has emailed this address
  if (payload.reason === 'unsubscribe' || payload.reason === 'complaint') {
    const { data: allUsers } = await supabase
      .from('sent_emails')
      .select('user_id')
      .eq('recipient_email', normalizedEmail)
    const uniqueUserIds = Array.from(new Set([...(allUsers ?? []).map((r: any) => r.user_id), ...affectedUserIds].filter(Boolean)))
    for (const uid of uniqueUserIds) {
      const { data: existing } = await supabase
        .from('do_not_contact')
        .select('id')
        .eq('user_id', uid)
        .eq('email', normalizedEmail)
        .maybeSingle()
      if (!existing) {
        await supabase.from('do_not_contact').insert({ user_id: uid, email: normalizedEmail, reason: payload.reason })
      }
    }
  }

  console.log('Suppression processed', {
    reason: payload.reason,
    matched_users: affectedUserIds.length,
    has_message_id: !!payload.message_id,
  })

  return jsonResponse({ success: true })
})
