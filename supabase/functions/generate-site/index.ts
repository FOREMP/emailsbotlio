// Thin enqueuer: flips a generated_sites row to 'queued' and fires off the
// worker (process-site-jobs) without waiting for it. Returns in <1s.
// Cron also polls the worker every minute as a fallback.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { activePipelineBreakers, pipelinePausedPayload } from '../_shared/site-pipeline-health.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Req { generated_site_id: string; generation_mode?: 'template' | 'freeform' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { generated_site_id, generation_mode }: Req = await req.json()
    if (!generated_site_id) return json({ error: 'generated_site_id required' }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceKey)
    const breakers = await activePipelineBreakers(supabase)
    if (breakers.length) return json(pipelinePausedPayload(breakers), 423)

    // Look up the row so we can validate and return a useful 404
    const { data: site, error: siteErr } = await supabase
      .from('generated_sites')
      .select('id, status, scraped_content')
      .eq('id', generated_site_id)
      .single()
    if (siteErr || !site) return json({ error: 'site not found' }, 404)
    if (!site.scraped_content) return json({ error: 'no scraped_content — run scrape first' }, 400)

    // Any status except in-flight can be re-queued
    if (['queued', 'processing'].includes(site.status)) {
      const workerUrl = `${supabaseUrl}/functions/v1/process-site-jobs`
      fetch(workerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ generated_site_id, force: true }),
      }).catch((e) => console.error('worker re-kick failed (cron will retry)', e))
      return json({ ok: true, status: site.status, message: 'already in queue, worker re-kicked' })
    }

    const { error: updErr } = await supabase
      .from('generated_sites')
      .update({
        status: 'queued',
        queued_at: new Date().toISOString(),
        error_message: null,
        attempts: 0, // manual re-queue resets the retry counter
        // Freeform builds page-by-page, so a fresh run must start from scratch.
        // Template mode keeps the last generated files until the new ones land.
        ...(generation_mode === 'freeform' ? { gen_progress: null, generated_files: null } : {}),
        ...(generation_mode ? { generation_mode } : {}),
      })
      .eq('id', generated_site_id)
    if (updErr) return json({ error: `queue failed: ${updErr.message}` }, 500)

    // Fire-and-forget the worker so happy path doesn't wait for cron
    const workerUrl = `${supabaseUrl}/functions/v1/process-site-jobs`
    fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ generated_site_id }),
    }).catch((e) => console.error('worker kick failed (cron will retry)', e))

    return json({ ok: true, status: 'queued' }, 202)
  } catch (err) {
    console.error('generate-site enqueue error', err)
    return json({ error: (err as Error).message }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
