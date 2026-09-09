import { createClient } from 'npm:@supabase/supabase-js@2'
import { signLeadSource } from '../_shared/lead-source-auth.ts'
import { LEGACY_SCRAPE_COVERAGE } from '../_shared/legacy-scrape-history.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const LEAD_STOCK_MULTIPLIER = 4
const STOCK_TOLERANCE = 5
const BACKLOG_MULTIPLIER = 2
const MIN_BACKLOG_CAP = 10
const STALE_JOB_MINUTES = 45
const TIMEOUT_CIRCUIT_WINDOW_MINUTES = 90
const TIMEOUT_CIRCUIT_FAILURES = 2
const FAILED_MARKET_COOLDOWN_HOURS = 6

type Language = 'sv' | 'en'
type State = {
  state?: 'manual' | 'auto' | 'paused'
  // buffer_days is retained only for compatibility with old saved settings.
  buffer_days?: number
  max_auto_jobs_per_language_per_day?: number
  lead_stock_multiplier?: number
  stock_tolerance?: number
  backlog_multiplier?: number
}

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
    if (body?.action === 'add_matrix') {
      const language = body?.language === 'en' ? 'en' : body?.language === 'sv' ? 'sv' : null
      if (!language) return json({ error: 'language must be sv or en' }, 400)
      const cities = Array.isArray(body?.cities) ? body.cities : []
      const niches = Array.isArray(body?.niches) ? body.niches : []
      const result = await addMatrix(supabase, userId, language, cities, niches)
      return json({ ok: true, ...result })
    }
    if (body?.action === 'status') {
      // Status must be read-only: refreshing the dashboard must not create
      // database writes or alter the sourcing queue.
      const { data: settingsRow, error: settingsError } = await supabase.from('app_settings')
        .select('value').eq('key', 'lead_sourcing_state').maybeSingle()
      if (settingsError) throw settingsError
      const settings = ((settingsRow?.value ?? {}) as State)
      const coverage = await Promise.all((['sv', 'en'] as Language[]).map((language) => getCoverage(supabase, userId, language, settings)))
      const { data: activeJobs, error: activeJobsError } = await supabase.from('lead_scrape_jobs')
        .select('id, language, search_query, state, created_at').eq('user_id', userId)
        .in('state', ['queued', 'dispatched', 'running', 'importing']).order('created_at').limit(1)
      if (activeJobsError) throw activeJobsError
      const nextMarkets = activeJobs?.length ? {} : Object.fromEntries(await Promise.all(
        (['sv', 'en'] as Language[]).map(async (language) => [language, await findCandidate(supabase, userId, {
          action: 'plan', requestedMarketId: null, language,
        }, coverage)]),
      ))
      return json({ ok: true, coverage, active_job: activeJobs?.[0] ?? null, next_markets: nextMarkets })
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
  await ensureLegacyHistory(supabase, userId)
  const { data: settingsRow } = await supabase.from('app_settings').select('value').eq('key', 'lead_sourcing_state').maybeSingle()
  const settings = ((settingsRow?.value ?? {}) as State)
  const mode = settings.state === 'auto' || settings.state === 'paused' ? settings.state : 'manual'
  if (request.action === 'plan' && mode !== 'auto') return { state: mode, dispatched: false, reason: 'automatic sourcing is not enabled' }
  if (mode === 'paused') return { state: mode, dispatched: false, reason: 'lead sourcing is paused' }

  // A process restart or a wedged internal Maps request can otherwise leave
  // one row "running" indefinitely, which prevents every future source run.
  await recoverStaleJobs(supabase, userId)

  const timeoutCircuit = await recentTimeoutCircuit(supabase, userId)
  if (timeoutCircuit.open) {
    return {
      state: mode,
      dispatched: false,
      reason: `lead worker timeout protection is active (${timeoutCircuit.failures} failures in the last ${TIMEOUT_CIRCUIT_WINDOW_MINUTES} minutes)`,
    }
  }

  const languages: Language[] = request.language ? [request.language] : ['sv', 'en']
  const coverage = await Promise.all(languages.map((language) => getCoverage(supabase, userId, language, settings)))
  // There is one Maps worker and one deliberate source pipeline. A second
  // request waits for the first job to import, so stock is recalculated from
  // real lead counts before another city × niche is chosen.
  const { data: activeJobs, error: activeJobsError } = await supabase.from('lead_scrape_jobs').select('id, search_query')
    .eq('user_id', userId).in('state', ['queued', 'dispatched', 'running', 'importing']).limit(1)
  if (activeJobsError) throw activeJobsError
  if (activeJobs?.length) return { state: mode, dispatched: false, coverage, reason: `sourcing already in progress: ${activeJobs[0].search_query}` }
  const candidate = await findCandidate(supabase, userId, request, coverage)
  if (!candidate) return {
    state: mode, dispatched: false, coverage,
    reason: coverage.map((item: any) => `${item.language}: ${item.reason}`).join(' · ') || 'no eligible market needs a run',
  }

  const { data: active } = await supabase.from('lead_scrape_jobs')
    .select('id').eq('market_id', candidate.id).in('state', ['queued', 'dispatched', 'running', 'importing']).limit(1)
  if (active?.length) return { state: mode, dispatched: false, coverage, reason: 'market already has an active job' }

  const jobRow = {
    user_id: userId,
    market_id: candidate.id,
    language: candidate.language,
    search_query: candidate.search_query,
    // Zero means "download every result returned by this one Maps search".
    // The stock/backlog gates decide whether another search is permitted after
    // import; a result cap would silently discard valid businesses instead.
    max_results: 0,
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

async function getCoverage(supabase: any, userId: string, language: Language, settings: State) {
  const { data: senders, error: senderError } = await supabase.from('senders').select('daily_limit, from_email').eq('is_active', true)
  if (senderError) throw senderError
  const domains = language === 'en' ? ['foremp.eu', 'foremp.one'] : ['foremp.email']
  const dailyCapacity = (senders ?? []).filter((sender: any) => domains.some((domain) => String(sender.from_email ?? '').toLowerCase().endsWith(`@${domain}`)))
    .reduce((total: number, sender: any) => total + Math.max(0, Number(sender.daily_limit) || 0), 0)
  const stockMultiplier = Math.max(1, Math.min(10, Number(settings.lead_stock_multiplier) || LEAD_STOCK_MULTIPLIER))
  const tolerance = Math.max(0, Math.min(20, Number(settings.stock_tolerance) || STOCK_TOLERANCE))
  const backlogMultiplier = Math.max(1, Math.min(6, Number(settings.backlog_multiplier) || BACKLOG_MULTIPLIER))
  // Match the sourcing intake rule: a lead only has usable outbound value when
  // it has both a website to audit/build from and an email to contact. This is
  // deliberately repeated at count time so a future manual or legacy import
  // cannot silently inflate the stock target.
  const contactableLeads = (statuses: string[], onlyUnsentApproved = false) => {
    let query = supabase.from('site_leads').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('language', language)
      .not('email', 'is', null).neq('email', '')
      .not('website', 'is', null).neq('website', '')
      .in('status', statuses)
    if (onlyUnsentApproved) query = query.is('last_email_sent_at', null)
    return query
  }
  const stockQueries = await Promise.all([
    // These statuses all represent leads which can still become an outbound
    // first email. They are the usable stock, not merely raw imported rows.
    contactableLeads(['pending_audit', 'auditing', 'awaiting_audit_approval', 'needs_site', 'generating', 'awaiting_approval']),
    contactableLeads(['approved', 'auto_approved'], true),
    contactableLeads(['pending_audit', 'auditing']),
    contactableLeads(['awaiting_audit_approval', 'awaiting_approval', 'needs_triage']),
    contactableLeads(['needs_site', 'generating']),
  ])
  const queryFailure = stockQueries.find((result: any) => result.error)
  if (queryFailure?.error) throw queryFailure.error
  const [
    { count: pipelineCount },
    { count: unsentApprovedCount },
    { count: auditBacklog },
    { count: reviewBacklog },
    { count: buildBacklog },
  ] = stockQueries as any[]
  const daily = Math.max(1, dailyCapacity || 10)
  const target = daily * stockMultiplier
  const stock = (pipelineCount ?? 0) + (unsentApprovedCount ?? 0)
  const backlogCap = Math.max(MIN_BACKLOG_CAP, daily * backlogMultiplier)
  const upperStockLimit = target + tolerance
  const remainingDiscoveryCapacity = Math.max(0, upperStockLimit - stock)
  let reason = 'stock target reached'
  if ((auditBacklog ?? 0) >= backlogCap) reason = `audit backlog is ${auditBacklog}/${backlogCap}`
  else if ((reviewBacklog ?? 0) >= backlogCap) reason = `approval backlog is ${reviewBacklog}/${backlogCap}`
  else if ((buildBacklog ?? 0) >= backlogCap) reason = `build backlog is ${buildBacklog}/${backlogCap}`
  else if (stock < target - tolerance) reason = 'needs sourcing'
  const shouldSource = stock < target - tolerance
    && (auditBacklog ?? 0) < backlogCap
    && (reviewBacklog ?? 0) < backlogCap
    && (buildBacklog ?? 0) < backlogCap
    && remainingDiscoveryCapacity > 0
  return {
    language, daily_capacity: dailyCapacity, stock, target, tolerance,
    upper_stock_limit: upperStockLimit, remaining_discovery_capacity: remainingDiscoveryCapacity,
    audit_backlog: auditBacklog ?? 0, review_backlog: reviewBacklog ?? 0,
    build_backlog: buildBacklog ?? 0, backlog_cap: backlogCap, should_source: shouldSource, reason,
  }
}

async function findCandidate(supabase: any, userId: string, request: { action: 'plan' | 'run_now'; requestedMarketId: string | null; language: Language | null }, coverage: any[]) {
  const { data: history, error: historyError } = await supabase.from('lead_scrape_history')
    .select('language, city_key, niche_key, search_key').eq('user_id', userId)
  if (historyError) throw historyError
  const failedSince = new Date(Date.now() - FAILED_MARKET_COOLDOWN_HOURS * 3_600_000).toISOString()
  const { data: recentFailures, error: recentFailuresError } = await supabase.from('lead_scrape_jobs')
    .select('market_id').eq('user_id', userId).eq('state', 'failed').gte('completed_at', failedSince)
  if (recentFailuresError) throw recentFailuresError
  const recentlyFailedMarkets = new Set((recentFailures ?? []).map((row: any) => row.market_id).filter(Boolean))
  // Older local coverage has search_key = "all", meaning the entire family
  // was already searched in that city. New catalogue rows have a specific
  // search key, so restaurant/bistro/bar searches can each run once without
  // repeating the same query forever.
  const completed = new Set((history ?? []).map((row: any) => `${row.language}:${row.city_key}:${row.niche_key}:${row.search_key ?? 'all'}`))
  const requestedLanguages: Array<Language | null> = request.language
    ? [request.language]
    : coverage
      .filter((item) => item.should_source)
      // When both countries need stock, work on the relatively emptier lane
      // first. This prevents a larger English catalogue from starving Sweden.
      .sort((left, right) => (left.stock / Math.max(1, left.target)) - (right.stock / Math.max(1, right.target)))
      .map((item) => item.language)
  const languages = request.requestedMarketId && !request.language ? [null] : requestedLanguages
  const now = Date.now()

  for (const language of languages) {
    // The recommended catalogue intentionally contains many small,
    // specialised queries. Inspect the whole relevant language catalogue; a
    // 50-row cap would leave the planner stuck on completed early markets.
    let query = supabase.from('lead_markets').select('*').eq('user_id', userId).eq('is_enabled', true)
      .order('priority', { ascending: true }).order('last_scraped_at', { ascending: true, nullsFirst: true }).limit(2_000)
    if (request.requestedMarketId) query = query.eq('id', request.requestedMarketId)
    if (language) query = query.eq('language', language)
    const { data: markets, error } = await query
    if (error) throw error
    for (const market of markets ?? []) {
      // Do not immediately repeat an individual market that has just failed.
      // The scheduler can make useful progress with another city × niche once
      // the global timeout circuit allows a new attempt.
      if (recentlyFailedMarkets.has(market.id)) continue
      const marketCoverage = coverage.find((item) => item.language === market.language)
      // Manual "run now" is still subject to stock and backlog controls. It is
      // a request to choose the next safe market, not a way to flood the queue.
      if (!marketCoverage || !marketCoverage.should_source) continue
      // Completed coverage is permanent until a future explicit re-run tool is
      // added. Cooldowns alone are not enough: they would repeat local work.
      if (market.niche_key) {
        const base = `${market.language}:${cityKey(market.city)}:${market.niche_key}`
        const key = String(market.search_key ?? 'all')
        if (completed.has(`${base}:all`) || completed.has(`${base}:${key}`)) continue
      }
      const last = market.last_scraped_at ? Date.parse(market.last_scraped_at) : 0
      if (last && now - last < Number(market.cooldown_days) * 86_400_000) continue
      return {
        ...market,
        remaining_discovery_capacity: Number(marketCoverage.remaining_discovery_capacity) || 0,
      }
    }
  }
  return null
}

async function recoverStaleJobs(supabase: any, userId: string) {
  const staleBefore = new Date(Date.now() - STALE_JOB_MINUTES * 60_000).toISOString()
  const { data: stale, error } = await supabase.from('lead_scrape_jobs')
    .select('id, worker_job_id, search_query')
    .eq('user_id', userId)
    .in('state', ['queued', 'dispatched', 'running', 'importing'])
    .lt('updated_at', staleBefore)
  if (error) throw error
  for (const job of stale ?? []) {
    // Best effort: an old worker may already be gone, but cancel when it is
    // still alive before releasing the database scheduling lock.
    await cancelWorker(job).catch((cancelError) => console.warn('stale lead job cancellation failed', job.id, cancelError))
    const { error: updateError } = await supabase.from('lead_scrape_jobs').update({
      state: 'failed',
      completed_at: new Date().toISOString(),
      error_message: `Worker heartbeat expired after ${STALE_JOB_MINUTES} minutes`,
    }).eq('id', job.id).in('state', ['queued', 'dispatched', 'running', 'importing'])
    if (updateError) throw updateError
  }
}

async function recentTimeoutCircuit(supabase: any, userId: string) {
  const since = new Date(Date.now() - TIMEOUT_CIRCUIT_WINDOW_MINUTES * 60_000).toISOString()
  const { count, error } = await supabase.from('lead_scrape_jobs').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('state', 'failed')
    .ilike('error_message', '%Maps job timed out%')
    .gte('completed_at', since)
  if (error) throw error
  const failures = count ?? 0
  return { failures, open: failures >= TIMEOUT_CIRCUIT_FAILURES }
}

async function ensureLegacyHistory(supabase: any, userId: string) {
  const rows = LEGACY_SCRAPE_COVERAGE.map((item) => ({
    user_id: userId,
    language: item.language,
    city_key: cityKey(item.city),
    niche_key: item.nicheKey,
    search_key: 'all',
    city: item.city,
    source: 'legacy_local',
    source_note: item.sourceFile,
  }))
  if (!rows.length) return
  const { error } = await supabase.from('lead_scrape_history').upsert(rows, {
    onConflict: 'user_id,language,city_key,niche_key,search_key',
    ignoreDuplicates: true,
  })
  if (error) throw error
}

function cityKey(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('sv-SE').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, '-')
}

function canonicalNicheKey(value: unknown): string {
  const text = String(value ?? '').trim().toLocaleLowerCase('sv-SE')
  // "salong" by itself is too broad: it also appears in Swedish beauty,
  // nail and massage businesses.  Require a genuine hair/barber signal.
  if (/(hair|frisör|frisor|hårsalong|harsalong|barber)/.test(text)) return 'hair_salon'
  if (/(beauty|skönhet|skonhet|nail|nagel|lash|frans|brow|bryn)/.test(text)) return 'beauty_salon'
  if (/(massage|wellness)/.test(text)) return 'massage_wellness'
  if (/(restaurant|restaurang|bistro|cafe|café|bar|pub|pizzeria|brasserie)/.test(text)) return 'restaurant_food'
  if (/(electric|elektr|elfirma|elinstall)/.test(text)) return 'electrician'
  if (/(plumb|rörmok|vvs)/.test(text)) return 'plumber'
  if (/(roof|taklägg|takfirma)/.test(text)) return 'roofer'
  if (/(paint|målare|malare)/.test(text)) return 'painter'
  if (/(clean|städ|stad)/.test(text)) return 'cleaning'
  if (/(garden|landscap|trädgård|tradgard|markarbete|tree)/.test(text)) return 'landscaping'
  if (/(floor|golv|window|fönster|fonster|door|dörr|dorr|fenc|staket)/.test(text)) return 'flooring_exterior'
  if (/(pet|dog|hund|trim)/.test(text)) return 'pet_grooming'
  if (/(detail|valet|rekond|bilvård|bilvard|car wash|biltvätt|biltvatt)/.test(text)) return 'car_detailing'
  if (/(auto|garage|mekanik|bilverk|tyre|tire|däck|dack)/.test(text)) return 'auto_workshop'
  if (/(build|bygg|carpent|snick|renovat|renover)/.test(text)) return 'builder_renovation'
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48) || 'other'
}

function searchTerm(language: Language, nicheKey: string, supplied: string): string {
  const defaults: Record<string, { sv: string; en: string }> = {
    hair_salon: { sv: 'frisör', en: 'hair salon' },
    beauty_salon: { sv: 'skönhetssalong', en: 'beauty salon' },
    massage_wellness: { sv: 'massage', en: 'massage therapist' },
    restaurant_food: { sv: 'restaurang', en: 'restaurant' },
    builder_renovation: { sv: 'byggfirma', en: 'builder' },
    electrician: { sv: 'elektriker', en: 'electrician' },
    plumber: { sv: 'rörmokare', en: 'plumber' },
    roofer: { sv: 'takläggare', en: 'roofer' },
    painter: { sv: 'målare', en: 'painter' },
    cleaning: { sv: 'städfirma', en: 'cleaning service' },
    landscaping: { sv: 'trädgårdsskötsel', en: 'landscaping' },
    flooring_exterior: { sv: 'golvläggare', en: 'flooring contractor' },
    pet_grooming: { sv: 'hundtrim', en: 'dog groomer' },
    car_detailing: { sv: 'bilvård', en: 'car detailing' },
    auto_workshop: { sv: 'bilverkstad', en: 'auto repair shop' },
  }
  return defaults[nicheKey]?.[language] ?? supplied
}

async function addMatrix(supabase: any, userId: string, language: Language, rawCities: unknown[], rawNiches: unknown[]) {
  const cities = [...new Set(rawCities.map((value) => String(value ?? '').trim()).filter((value) => value.length >= 2 && value.length <= 80))].slice(0, 30)
  const niches = [...new Set(rawNiches.map((value) => String(value ?? '').trim()).filter((value) => value.length >= 2 && value.length <= 80))].slice(0, 12)
  if (!cities.length || !niches.length) throw new Error('add at least one place and one niche')
  if (cities.length * niches.length > 100) throw new Error('a maximum of 100 place × niche combinations can be added at once')
  await ensureLegacyHistory(supabase, userId)
  const { data: history, error: historyError } = await supabase.from('lead_scrape_history')
    .select('city_key, niche_key, search_key').eq('user_id', userId).eq('language', language)
  if (historyError) throw historyError
  const completed = new Set((history ?? []).map((row: any) => `${row.city_key}:${row.niche_key}:${row.search_key ?? 'all'}`))
  const countryCode = language === 'sv' ? 'SE' : 'GB'
  const countryName = language === 'sv' ? 'Sverige' : 'UK'
  const rows = cities.flatMap((city) => niches.map((niche) => {
    const nicheKey = canonicalNicheKey(niche)
    const isCovered = completed.has(`${cityKey(city)}:${nicheKey}:all`)
    return {
      user_id: userId, language, country_code: countryCode, city,
      category: niche, niche_key: nicheKey,
      search_key: 'all',
      search_query: `${searchTerm(language, nicheKey, niche)} ${city} ${countryName}`,
      is_enabled: !isCovered, priority: 100, max_results: 0, cooldown_days: 90,
    }
  }))
  let added = 0
  for (const row of rows) {
    const { data: existing, error: existingError } = await supabase.from('lead_markets').select('id')
      .eq('user_id', userId).eq('language', language).eq('country_code', countryCode)
      .eq('city', row.city).eq('niche_key', row.niche_key).eq('search_key', row.search_key).limit(1)
    if (existingError) throw existingError
    if (!existing?.length) {
      const { error: insertError } = await supabase.from('lead_markets').insert(row)
      // The pre-existing unique search-query index remains the race-safe
      // fallback if two planner requests arrive at once.
      if (insertError && insertError.code !== '23505') throw insertError
      if (!insertError) added++
    }
  }
  // Older market rows may have existed before history was introduced. Keep
  // their visible switch honest as well; findCandidate independently checks
  // history, so this is a UX safeguard rather than the only protection.
  for (const row of rows.filter((item) => !item.is_enabled)) {
    const { error: disableError } = await supabase.from('lead_markets').update({ is_enabled: false })
      .eq('user_id', userId).eq('language', language).eq('country_code', countryCode)
      .eq('city', row.city).eq('niche_key', row.niche_key).eq('search_key', row.search_key)
    if (disableError) throw disableError
  }
  return { added, already_covered: rows.filter((row) => !row.is_enabled).length, combinations: rows.length }
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
