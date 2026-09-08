import { createClient } from 'npm:@supabase/supabase-js@2'
import { signLeadSource } from '../_shared/lead-source-auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const MAX_RESULTS_PER_JOB = 150
const DEFAULT_BUFFER_DAYS = 3

type Language = 'sv' | 'en'
type State = { state?: 'manual' | 'auto' | 'paused'; buffer_days?: number; max_auto_jobs_per_language_per_day?: number }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)
    const body = await req.json().catch(() => ({}))
    if (body?.action === 'auto_tick' && jwt === serviceKey) {
      // Only the existing service-key process-site-leads cron can use this
      // path. It cannot be triggered with a browser or anon token.
      const { data: owners, error } = await supabase.from('lead_markets').select('user_id').eq('is_enabled', true)
      if (error) throw error
      const runs = []
      for (const userId of [...new Set((owners ?? []).map((row: any) => row.user_id).filter(Boolean))]) {
        try { runs.push(await planAndDispatch(supabase, userId as string, { action: 'plan', requestedMarketId: null, language: null })) }
        catch (error) { runs.push({ dispatched: false, reason: error instanceof Error ? error.message : String(error) }) }
      }
      return json({ ok: true, automatic: true, runs })
    }
    if (!jwt) return json({ error: 'missing auth' }, 401)
    const { data: userResult } = await supabase.auth.getUser(jwt)
    const userId = userResult?.user?.id
    if (!userId) return json({ error: 'invalid auth' }, 401)
    if (body?.action === 'cancel') {
      const jobId = typeof body?.job_id === 'string' ? body.job_id : ''
      if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json({ error: 'invalid job_id' }, 400)
      const { data: job, error: jobError } = await supabase.from('lead_scrape_jobs').select('*').eq('id', jobId).eq('user_id', userId).maybeSingle()
      if (jobError) throw jobError
      if (!job) return json({ error: 'lead job not found' }, 404)
      if (['completed', 'failed', 'cancelled'].includes(job.state)) return json({ ok: true, cancelled: false, state: job.state })
      await cancelWorker(job)
      const { error: cancelError } = await supabase.from('lead_scrape_jobs').update({
        state: 'cancelled', completed_at: new Date().toISOString(), error_message: 'Cancelled by user',
      }).eq('id', job.id)
      if (cancelError) throw cancelError
      return json({ ok: true, cancelled: true, job_id: job.id })
    }
    const action = body?.action === 'run_now' ? 'run_now' : 'plan'
    const requestedMarketId = typeof body?.market_id === 'string' ? body.market_id : null
    const language = body?.language === 'en' ? 'en' : body?.language === 'sv' ? 'sv' : null
    const result = await planAndDispatch(supabase, userId, { action, requestedMarketId, language })
    return json({ ok: true, ...result })
  } catch (error) {
    console.error('lead-sourcing', error)
    return json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})

async function planAndDispatch(supabase: any, userId: string, request: { action: 'plan' | 'run_now'; requestedMarketId: string | null; language: Language | null }) {
  const { data: settingsRow } = await supabase.from('app_settings').select('value').eq('key', 'lead_sourcing_state').maybeSingle()
  const settings = ((settingsRow?.value ?? {}) as State)
  const mode = settings.state === 'auto' || settings.state === 'paused' ? settings.state : 'manual'
  if (request.action === 'plan' && mode !== 'auto') return { state: mode, dispatched: false, reason: 'automatic sourcing is not enabled' }
  if (mode === 'paused') return { state: mode, dispatched: false, reason: 'lead sourcing is paused' }

  if (request.action === 'plan') {
    const maxPerLanguage = Math.max(1, Number(settings.max_auto_jobs_per_language_per_day) || 1)
    const since = new Date(Date.now() - 30 * 60 * 60_000).toISOString()
    const { data: recentJobs } = await supabase.from('lead_scrape_jobs').select('language, created_at')
      .eq('user_id', userId).gte('created_at', since)
    const today = stockholmDateKey(new Date())
    const counts = new Map<Language, number>()
    for (const job of recentJobs ?? []) {
      if (job.language === 'sv' || job.language === 'en') {
        if (stockholmDateKey(new Date(job.created_at)) === today) counts.set(job.language, (counts.get(job.language) ?? 0) + 1)
      }
    }
    if ([...counts.values()].every((count) => count >= maxPerLanguage)) return { state: mode, dispatched: false, reason: 'daily automatic sourcing limit reached' }
  }

  const languages: Language[] = request.language ? [request.language] : ['sv', 'en']
  const coverage = await Promise.all(languages.map((language) => getCoverage(supabase, userId, language, settings)))
  const candidate = await findCandidate(supabase, userId, request, coverage)
  if (!candidate) return { state: mode, dispatched: false, coverage, reason: 'no eligible market needs a run' }

  const { data: active } = await supabase.from('lead_scrape_jobs')
    .select('id').eq('market_id', candidate.id).in('state', ['queued', 'dispatched', 'running', 'importing']).limit(1)
  if (active?.length) return { state: mode, dispatched: false, coverage, reason: 'market already has an active job' }

  const jobRow = {
    user_id: userId,
    market_id: candidate.id,
    language: candidate.language,
    search_query: candidate.search_query,
    max_results: Math.min(MAX_RESULTS_PER_JOB, Math.max(1, Number(candidate.max_results) || 75)),
    state: 'queued',
  }
  const { data: job, error: createError } = await supabase.from('lead_scrape_jobs').insert(jobRow).select('*').single()
  if (createError) throw createError
  try {
    const worker = await dispatchWorker(job)
    const { error: updateError } = await supabase.from('lead_scrape_jobs').update({
      state: 'dispatched', worker_job_id: worker.worker_job_id ?? null,
    }).eq('id', job.id)
    if (updateError) throw updateError
    return { state: mode, dispatched: true, coverage, job_id: job.id, market: candidate, worker_job_id: worker.worker_job_id ?? null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await supabase.from('lead_scrape_jobs').update({ state: 'failed', error_message: message.slice(0, 800), completed_at: new Date().toISOString() }).eq('id', job.id)
    throw error
  }
}

function stockholmDateKey(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
}

async function getCoverage(supabase: any, userId: string, language: Language, settings: State) {
  const { data: senders } = await supabase.from('senders').select('daily_limit, from_email').eq('is_active', true)
  const domains = language === 'en' ? ['foremp.eu', 'foremp.one'] : ['foremp.email']
  const dailyCapacity = (senders ?? []).filter((sender: any) => domains.some((domain) => String(sender.from_email ?? '').toLowerCase().endsWith(`@${domain}`)))
    .reduce((total: number, sender: any) => total + Math.max(0, Number(sender.daily_limit) || 0), 0)
  const target = Math.max(1, dailyCapacity || 10) * Math.max(1, Number(settings.buffer_days) || DEFAULT_BUFFER_DAYS)
  const { count } = await supabase.from('site_leads').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('language', language)
    .in('status', ['pending_audit', 'auditing', 'needs_site', 'generating', 'awaiting_approval'])
  return { language, available: count ?? 0, daily_capacity: dailyCapacity, target, deficit: Math.max(0, target - (count ?? 0)) }
}

async function findCandidate(supabase: any, userId: string, request: { action: 'plan' | 'run_now'; requestedMarketId: string | null; language: Language | null }, coverage: any[]) {
  let query = supabase.from('lead_markets').select('*').eq('user_id', userId).eq('is_enabled', true).order('priority', { ascending: true }).order('last_scraped_at', { ascending: true, nullsFirst: true }).limit(50)
  if (request.requestedMarketId) query = query.eq('id', request.requestedMarketId)
  if (request.language) query = query.eq('language', request.language)
  const { data: markets, error } = await query
  if (error) throw error
  const now = Date.now()
  for (const market of markets ?? []) {
    const marketCoverage = coverage.find((item) => item.language === market.language)
    if (request.action === 'plan' && (!marketCoverage || marketCoverage.deficit <= 0)) continue
    if (request.action === 'plan' && await automaticLimitReached(supabase, userId, market.language)) continue
    const last = market.last_scraped_at ? Date.parse(market.last_scraped_at) : 0
    if (last && now - last < Number(market.cooldown_days) * 86_400_000) continue
    return market
  }
  return null
}

async function automaticLimitReached(supabase: any, userId: string, language: Language): Promise<boolean> {
  const { data: settingsRow } = await supabase.from('app_settings').select('value').eq('key', 'lead_sourcing_state').maybeSingle()
  const settings = (settingsRow?.value ?? {}) as State
  const maxPerLanguage = Math.max(1, Number(settings.max_auto_jobs_per_language_per_day) || 1)
  const { data: rows } = await supabase.from('lead_scrape_jobs').select('created_at')
    .eq('user_id', userId).eq('language', language).gte('created_at', new Date(Date.now() - 30 * 60 * 60_000).toISOString())
  const today = stockholmDateKey(new Date())
  return (rows ?? []).filter((row: any) => stockholmDateKey(new Date(row.created_at)) === today).length >= maxPerLanguage
}

async function dispatchWorker(job: any): Promise<{ worker_job_id?: string }> {
  const baseUrl = String(Deno.env.get('SCRAPER_WORKER_URL') ?? '').replace(/\/$/, '')
  const secret = Deno.env.get('LEAD_SOURCE_SHARED_SECRET') ?? Deno.env.get('SCRAPER_SHARED_SECRET')
  if (!baseUrl || !secret) throw new Error('SCRAPER_WORKER_URL and LEAD_SOURCE_SHARED_SECRET are required')
  const body = JSON.stringify({ job_id: job.id, query: job.search_query, language: job.language, max_results: job.max_results })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = await signLeadSource(`${timestamp}.${body}`, secret)
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`${baseUrl}/v1/lead-jobs`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'X-Botlio-Timestamp': timestamp, 'X-Botlio-Signature': signature }, body,
    })
    const payload = await response.json().catch(() => ({}))
    if (response.status === 404) {
      throw new Error('Lead worker endpoint is unavailable (404). The Lightsail server still needs the lead_runner service and updated Caddy route installed and restarted.')
    }
    if (!response.ok || !payload?.ok) throw new Error(String(payload?.error ?? `lead worker returned ${response.status}`))
    return payload
  } finally { clearTimeout(timeout) }
}

async function cancelWorker(job: any): Promise<void> {
  const baseUrl = String(Deno.env.get('SCRAPER_WORKER_URL') ?? '').replace(/\/$/, '')
  const secret = Deno.env.get('LEAD_SOURCE_SHARED_SECRET') ?? Deno.env.get('SCRAPER_SHARED_SECRET')
  if (!baseUrl || !secret) throw new Error('SCRAPER_WORKER_URL and LEAD_SOURCE_SHARED_SECRET are required')
  const body = JSON.stringify({ job_id: job.id })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = await signLeadSource(`${timestamp}.${body}`, secret)
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`${baseUrl}/v1/lead-jobs/${job.id}/cancel`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'X-Botlio-Timestamp': timestamp, 'X-Botlio-Signature': signature }, body,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload?.ok) throw new Error(String(payload?.error ?? `lead worker returned ${response.status}`))
  } finally { clearTimeout(timeout) }
}

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } }) }
