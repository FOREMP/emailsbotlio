import { createClient } from 'npm:@supabase/supabase-js@2'
import type { PipelineProvider } from '../_shared/site-pipeline-health.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return json({ error: 'unauthorized' }, 401)

  const body = await req.json().catch(() => ({}))
  const provider = body?.provider as PipelineProvider | 'all'
  if (!['firecrawl', 'openrouter', 'vercel', 'all'].includes(provider)) {
    return json({ error: 'provider must be firecrawl, openrouter, vercel, or all' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceKey)
  let update = admin.from('site_pipeline_breakers').update({
    is_paused: false,
    resumed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  if (provider !== 'all') update = update.eq('provider', provider)
  else update = update.in('provider', ['firecrawl', 'openrouter', 'vercel'])
  const { error: updateError } = await update
  if (updateError) return json({ error: updateError.message }, 500)

  const incrementTargets = provider === 'all' ? ['firecrawl', 'openrouter', 'vercel'] : [provider]
  for (const target of incrementTargets) {
    const { data: row } = await admin.from('site_pipeline_breakers').select('ignored_count').eq('provider', target).maybeSingle()
    await admin.from('site_pipeline_breakers').update({ ignored_count: Number(row?.ignored_count ?? 0) + 1 }).eq('provider', target)
  }

  // Resume both queue producers and consumers. These calls are intentionally
  // not awaited; cron remains the durable fallback if either kick is lost.
  for (const name of ['process-site-leads', 'process-site-jobs']) {
    fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({}),
    }).catch((error) => console.error(`resume kick failed for ${name}`, error))
  }

  return json({ ok: true, resumed: provider })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

