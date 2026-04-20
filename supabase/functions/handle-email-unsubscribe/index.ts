import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function ensureGlobalSuppression(
  supabase: ReturnType<typeof createClient>,
  email: string,
) {
  const normalizedEmail = email.toLowerCase()

  const { data: existing, error: lookupError } = await supabase
    .from('suppressed_emails')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (lookupError) {
    throw lookupError
  }

  if (!existing) {
    const { error: insertError } = await supabase.from('suppressed_emails').insert({
      email: normalizedEmail,
      reason: 'unsubscribe',
    })

    if (insertError) {
      throw insertError
    }
  }

  return normalizedEmail
}

async function syncDoNotContactAndEnrollments(
  supabase: ReturnType<typeof createClient>,
  email: string,
) {
  const normalizedEmail = email.toLowerCase()

  const { data: senders, error: sendersError } = await supabase
    .from('sent_emails')
    .select('user_id')
    .ilike('recipient_email', email)

  if (sendersError) {
    throw sendersError
  }

  const userIds = Array.from(
    new Set((senders ?? []).map((row: any) => row.user_id).filter(Boolean)),
  )

  for (const uid of userIds) {
    const { error: dncError } = await supabase.from('do_not_contact').upsert(
      {
        user_id: uid,
        email: normalizedEmail,
        reason: 'unsubscribed_via_email',
      },
      { onConflict: 'user_id,email' },
    )

    if (dncError) {
      const { data: existingDnc, error: existingDncError } = await supabase
        .from('do_not_contact')
        .select('id')
        .eq('user_id', uid)
        .ilike('email', normalizedEmail)
        .maybeSingle()

      if (existingDncError) {
        throw existingDncError
      }

      if (!existingDnc) {
        const { error: dncInsertError } = await supabase
          .from('do_not_contact')
          .insert({
            user_id: uid,
            email: normalizedEmail,
            reason: 'unsubscribed_via_email',
          })

        if (dncInsertError) {
          throw dncInsertError
        }
      }
    }

    const { data: contactRows, error: contactsError } = await supabase
      .from('contacts')
      .select('id')
      .eq('user_id', uid)
      .ilike('email', email)

    if (contactsError) {
      throw contactsError
    }

    const contactIds = (contactRows ?? []).map((contact: any) => contact.id)

    if (contactIds.length > 0) {
      const { error: enrollmentsError } = await supabase
        .from('enrollments')
        .update({ status: 'unsubscribed' })
        .eq('user_id', uid)
        .in('contact_id', contactIds)
        .eq('status', 'active')

      if (enrollmentsError) {
        throw enrollmentsError
      }
    }
  }

  return userIds.length
}

async function syncUnsubscribeState(
  supabase: ReturnType<typeof createClient>,
  email: string,
) {
  const normalizedEmail = await ensureGlobalSuppression(supabase, email)
  const usersAffected = await syncDoNotContactAndEnrollments(supabase, email)

  return { normalizedEmail, usersAffected }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const url = new URL(req.url)
  let token: string | null = url.searchParams.get('token')

  if (req.method === 'POST') {
    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formText = await req.text()
      const params = new URLSearchParams(formText)
      if (!params.get('List-Unsubscribe')) {
        const formToken = params.get('token')
        if (formToken) {
          token = formToken
        }
      }
    } else {
      try {
        const body = await req.json()
        if (body.token) {
          token = body.token
        }
      } catch {
        // Fall through — token stays from query param
      }
    }
  }

  if (!token) {
    return jsonResponse({ error: 'Token is required' }, 400)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: tokenRecord, error: lookupError } = await supabase
    .from('email_unsubscribe_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle()

  if (lookupError || !tokenRecord) {
    return jsonResponse({ error: 'Invalid or expired token' }, 404)
  }

  if (tokenRecord.used_at) {
    try {
      const { normalizedEmail, usersAffected } = await syncUnsubscribeState(
        supabase,
        tokenRecord.email,
      )
      console.log('Email already unsubscribed', {
        email: normalizedEmail,
        users: usersAffected,
      })
    } catch (error) {
      console.error('Failed to repair existing unsubscribe state', {
        error,
        email: tokenRecord.email,
      })
      return jsonResponse({ error: 'Failed to process unsubscribe' }, 500)
    }

    return jsonResponse({ valid: false, reason: 'already_unsubscribed' })
  }

  if (req.method === 'GET') {
    return jsonResponse({ valid: true })
  }

  const { data: updated, error: updateError } = await supabase
    .from('email_unsubscribe_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token)
    .is('used_at', null)
    .select()
    .maybeSingle()

  if (updateError) {
    console.error('Failed to mark token as used', { error: updateError, token })
    return jsonResponse({ error: 'Failed to process unsubscribe' }, 500)
  }

  if (!updated) {
    try {
      const { normalizedEmail, usersAffected } = await syncUnsubscribeState(
        supabase,
        tokenRecord.email,
      )
      console.log('Email already unsubscribed after race', {
        email: normalizedEmail,
        users: usersAffected,
      })
    } catch (error) {
      console.error('Failed to repair raced unsubscribe state', {
        error,
        email: tokenRecord.email,
      })
      return jsonResponse({ error: 'Failed to process unsubscribe' }, 500)
    }

    return jsonResponse({ success: false, reason: 'already_unsubscribed' })
  }

  try {
    const { normalizedEmail, usersAffected } = await syncUnsubscribeState(
      supabase,
      tokenRecord.email,
    )

    console.log('Email unsubscribed', {
      email: normalizedEmail,
      users: usersAffected,
    })

    return jsonResponse({ success: true })
  } catch (error) {
    console.error('Failed to finalize unsubscribe state', {
      error,
      email: tokenRecord.email,
    })
    return jsonResponse({ error: 'Failed to process unsubscribe' }, 500)
  }
})
