import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  checkTrackingHost,
  TRACKING_RECHECK_MIN_AGE_MS,
  trackingHostForDomain,
} from '../_shared/tracking-health.ts'

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return json({ error: 'server_not_configured' }, 500)

  const supabase = createClient(supabaseUrl, serviceKey)
  const { data: rows, error } = await supabase
    .from('sending_domains')
    .select('id, domain, tracking_host_last_checked_at')
    .eq('is_active', true)
    .eq('is_verified', true)
    .order('domain')

  if (error) return json({ error: 'could_not_load_domains', detail: error.message }, 500)

  const now = Date.now()
  const results = await Promise.all((rows ?? []).map(async (row: any) => {
    const lastChecked = Date.parse(String(row.tracking_host_last_checked_at ?? ''))
    if (Number.isFinite(lastChecked) && lastChecked > now - TRACKING_RECHECK_MIN_AGE_MS) {
      return { domain: row.domain, skipped: true, reason: 'checked_recently' }
    }

    const candidate = trackingHostForDomain(row.domain)
    const checkedAt = new Date().toISOString()
    if (!candidate) {
      await supabase.from('sending_domains').update({
        tracking_host: null,
        tracking_host_verified_at: null,
        tracking_host_last_checked_at: checkedAt,
        tracking_host_last_error: 'Invalid domain name',
      }).eq('id', row.id)
      return { domain: row.domain, healthy: false, error: 'Invalid domain name' }
    }

    const health = await checkTrackingHost(candidate)
    const patch = health.healthy
      ? {
          tracking_host: candidate,
          tracking_host_verified_at: checkedAt,
          tracking_host_last_checked_at: checkedAt,
          tracking_host_last_error: null,
        }
      : {
          tracking_host: null,
          tracking_host_verified_at: null,
          tracking_host_last_checked_at: checkedAt,
          tracking_host_last_error: health.error,
        }
    const { error: updateError } = await supabase
      .from('sending_domains')
      .update(patch)
      .eq('id', row.id)

    return {
      domain: row.domain,
      tracking_host: candidate,
      healthy: health.healthy,
      status: health.status,
      error: updateError?.message ?? health.error,
    }
  }))

  return json({
    success: true,
    checked_at: new Date().toISOString(),
    results,
  })
})

