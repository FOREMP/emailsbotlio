import { createClient } from 'npm:@supabase/supabase-js@2'
import { verifyLeadSourceRequest } from '../_shared/lead-source-auth.ts'

const allowedStates = new Set(['dispatched', 'running', 'importing', 'completed', 'failed', 'cancelled'])

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const raw = await req.text()
  if (!(await verifyLeadSourceRequest(req, raw))) return json({ error: 'invalid worker signature' }, 401)
  try {
    const body = JSON.parse(raw)
    if (typeof body.job_id !== 'string' || !allowedStates.has(body.state)) return json({ error: 'invalid job update' }, 400)
    const patch: Record<string, unknown> = { state: body.state }
    if (typeof body.worker_job_id === 'string') patch.worker_job_id = body.worker_job_id.slice(0, 200)
    if (Number.isInteger(body.discovered_count)) patch.discovered_count = Math.max(0, body.discovered_count)
    if (Number.isInteger(body.imported_count)) patch.imported_count = Math.max(0, body.imported_count)
    if (Number.isInteger(body.duplicate_count)) patch.duplicate_count = Math.max(0, body.duplicate_count)
    if (Number.isInteger(body.rejected_count)) patch.rejected_count = Math.max(0, body.rejected_count)
    if (typeof body.error_message === 'string') patch.error_message = body.error_message.slice(0, 800)
    if (body.state === 'running') patch.started_at = new Date().toISOString()
    if (['completed', 'failed', 'cancelled'].includes(body.state)) patch.completed_at = new Date().toISOString()
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { error } = await supabase.from('lead_scrape_jobs').update(patch).eq('id', body.job_id)
    if (error) throw error
    if (body.state === 'completed') {
      const { data: job } = await supabase.from('lead_scrape_jobs')
        .select('market_id, user_id, language, search_query').eq('id', body.job_id).maybeSingle()
      if (job?.market_id) {
        const completedAt = new Date().toISOString()
        const { data: market } = await supabase.from('lead_markets')
          .select('city, niche_key').eq('id', job.market_id).maybeSingle()
        await supabase.from('lead_markets').update({ last_scraped_at: completedAt }).eq('id', job.market_id)
        if (market?.city && market?.niche_key) {
          const { error: historyError } = await supabase.from('lead_scrape_history').upsert({
            user_id: job.user_id,
            language: job.language,
            city_key: cityKey(market.city),
            niche_key: market.niche_key,
            city: market.city,
            search_query: job.search_query,
            source: 'server',
            market_id: job.market_id,
            completed_at: completedAt,
          }, { onConflict: 'user_id,language,city_key,niche_key' })
          if (historyError) throw historyError
        }
      }
    }
    return json({ ok: true })
  } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 500) }
})

function cityKey(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('sv-SE').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, '-')
}

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }) }
