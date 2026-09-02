// Site-lead outreach orchestrator.
// Runs every 10 min (cron) or on-demand. Three phases per tick:
//   1. RECONCILE — advance in-flight generated_sites through scraped → queued
//      → generated → live, mirror status onto site_leads (awaiting_approval
//      when live, failed when the site pipeline errored).
//   2. GENERATE — derive independent SV/EN build targets from each outreach
//      sequence's throttle (2x daily first-mail capacity), atomically claim
//      leads, then create generated_sites jobs without cross-language starvation.
//   3. AUDIT — atomically claim up to AUDIT_PER_TICK pending leads and score
//      their screenshots through the shared Firecrawl + OpenRouter audit.
// The whole file uses the service role; cron sends the anon key just so
// pg_net can hit the function endpoint (verify_jwt is off).
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  activePipelineBreakers,
  pipelinePausedPayload,
  recordPipelineFailure,
} from '../_shared/site-pipeline-health.ts'
import { auditWebsite, ScrapeProviderError } from '../_shared/site-audit.ts'
import { classifyNiche, templateForNiche, type NicheKey } from '../_shared/niche.ts'
import {
  blockTemplateFamilyCatalog,
  BLOCK_TEMPLATE_FAMILIES,
  selectBlockTemplateFamily,
  type BlockTemplateFamily,
  type BlockTemplateFamilyKey,
} from '../process-site-jobs/block-templates.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
// Template selection still uses the existing Lovable gateway. Website audits
// use OpenRouter through the shared scorer below.
const AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1'

const AUDIT_PER_TICK = 3    // Firecrawl+Gemini per invocation — keep memory low
const GEN_PER_TICK = 6      // how many new pipelines may START per tick
const MAX_CONCURRENT_GEN = 24 // how many leads may be mid-pipeline at once
const BUILD_BUFFER_MULTIPLIER = 2
const BUILD_ATTEMPT_BUFFER_RATIO = 0.25
const PIPELINE_LANGUAGES = ['sv', 'en'] as const
type PipelineLanguage = typeof PIPELINE_LANGUAGES[number]
const OUTREACH_SEQUENCES: Record<PipelineLanguage, { name: string; fallbackDailyLimit: number }> = {
  sv: { name: 'Site Demo Outreach', fallbackDailyLimit: 24 },
  en: { name: 'Site Demo Outreach EN', fallbackDailyLimit: 10 },
}
const GHOST_LIST_NAME = 'Site Leads (auto)'

function isCanonicalDemoUrl(value?: string | null): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    if (!url.hostname.endsWith('.vercel.app')) return false
    if (url.hostname.endsWith('-foremp.vercel.app')) return false
    return true
  } catch {
    return false
  }
}
const STALE_PIPELINE_MINUTES = 180 // queued work may legitimately wait; don't fail healthy backlog
const ORPHAN_GRACE_MINUTES = 10   // 'generating' with no generated_sites row = dead job
const TEMPLATE_PICKER_MODEL = 'deepseek/deepseek-chat-v3.1'

type LanguageBudget = {
  language: PipelineLanguage
  emailLimit: number
  target: number
  productive: number
  completed: number
  inFlight: number
  attempts: number
  remaining: number
  attemptRemaining: number
}

type PipelineReport = {
  reconciled: number
  recovered: number
  audited: number
  generated: number
  capacity: number
  budgets: Record<PipelineLanguage, LanguageBudget> | null
  errors: string[]
}

type SupabaseAdmin = ReturnType<typeof createClient<any>>

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  const report: PipelineReport = {
    reconciled: 0,
    recovered: 0,
    audited: 0,
    generated: 0,
    capacity: 0,
    budgets: null,
    errors: [],
  }

  // Manual override from the Site Leads UI: build these leads right now,
  // ignoring the automation switch and the daily cap.
  let overrideIds: string[] = []
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      if (body?.force && Array.isArray(body?.lead_ids)) {
        overrideIds = body.lead_ids.filter((v: unknown) => typeof v === 'string').slice(0, 20)
      }
    } catch { /* no body — normal cron tick */ }
  }

  const activeBreakers = await activePipelineBreakers(supabase)
  if (activeBreakers.length) return json(pipelinePausedPayload(activeBreakers), 423)

  try {
    if (overrideIds.length > 0) {
      const { data: forced } = await supabase
        .from('site_leads')
        .select('id, user_id, company_name, website, email, phone, address, category, niche, rating, review_snippets, audit_reason, audit_details, feedback, language')
        .in('id', overrideIds)
      for (const lead of forced ?? []) {
        try {
          await startGeneration(supabase, supabaseUrl, serviceKey, lead as any)
          report.generated++
        } catch (e) {
          report.errors.push(`force ${lead.id}: ${(e as Error).message}`)
        }
      }
      return json({ ok: true, forced: true, ...report })
    }

    // ---------------- 1. RECONCILE ----------------
    report.reconciled = await reconcile(supabase, supabaseUrl, serviceKey, report)
    report.recovered = await recoverStuckGenerations(supabase, supabaseUrl, serviceKey, report)


    // Operator on/off switch (Igång / Pausad / Stoppad) from /site-leads.
    const { data: autoRow } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'site_generation_state')
      .maybeSingle()
    const autoState = ((autoRow as any)?.value?.state ?? 'running') as string
    if (autoState !== 'running') {
      report.errors.push(`skip audit+generate: automation is ${autoState}`)
      return json({ ok: true, ...report })
    }

    // ---------------- 2. GENERATE -----------------
    // Swedish and English outreach are independent products with independent
    // send limits. Each language keeps a two-day inventory buffer, and one
    // language can never consume the other language's build allowance.
    const budgets = await calculateLanguageBudgets(supabase)
    report.budgets = budgets
    report.capacity = PIPELINE_LANGUAGES.reduce((sum, language) => sum + budgets[language].remaining, 0)

    const { count: generatingCount } = await supabase
      .from('site_leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'generating')
    const slots = Math.max(0, MAX_CONCURRENT_GEN - (generatingCount ?? 0))

    if (slots === 0) {
      report.errors.push(`skip generate: ${generatingCount} lead(s) still in flight`)
    } else {
      const allocations = allocateGenerationSlots(budgets, Math.min(GEN_PER_TICK, slots))
      for (const language of PIPELINE_LANGUAGES) {
        const take = allocations[language]
        if (take <= 0) continue

        const { data: claimed, error: claimError } = await supabase.rpc('claim_site_leads_for_generation', {
          p_language: language,
          p_limit: take,
        })
        if (claimError) {
          report.errors.push(`claim ${language} generation: ${claimError.message}`)
          continue
        }

        for (const lead of claimed ?? []) {
          try {
            await startGeneration(supabase, supabaseUrl, serviceKey, lead as any)
            report.generated++
          } catch (e) {
            await releaseGenerationClaim(supabase, lead.id)
            report.errors.push(`gen ${language} ${lead.id}: ${(e as Error).message}`)
          }
        }
      }
    }

    // ---------------- 3. AUDIT --------------------
    // Claim audit work atomically after generation. This ensures an existing
    // needs_site backlog is used before spending more Firecrawl credits.
    const auditAllocations = await allocateAuditSlots(supabase, budgets, AUDIT_PER_TICK)
    for (const language of PIPELINE_LANGUAGES) {
      const take = auditAllocations[language]
      if (take <= 0) continue

      const { data: auditRows, error: claimError } = await supabase.rpc('claim_site_leads_for_audit', {
        p_language: language,
        p_limit: take,
      })
      if (claimError) {
        report.errors.push(`claim ${language} audit: ${claimError.message}`)
        continue
      }

      for (const row of auditRows ?? []) {
        try {
          await auditOne(supabase, row as any)
          report.audited++
        } catch (e) {
          report.errors.push(`audit ${language} ${row.id}: ${(e as Error).message}`)
        }
      }
    }


    return json({ ok: true, ...report })
  } catch (err) {
    console.error('process-site-leads fatal', err)
    return json({ error: (err as Error).message, ...report }, 500)
  }
})

function normaliseLanguage(value: unknown): PipelineLanguage {
  return value === 'en' ? 'en' : 'sv'
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  )
  return representedAsUtc - date.getTime()
}

function stockholmDayBounds(now = new Date()): { start: string; end: string } {
  const timeZone = 'Europe/Stockholm'
  const localParts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(localParts.map((part) => [part.type, part.value]))
  const localMidnightAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day))
  const startGuess = new Date(localMidnightAsUtc)
  const start = new Date(localMidnightAsUtc - timeZoneOffsetMs(startGuess, timeZone))

  const nextLocalMidnightAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + 1)
  const endGuess = new Date(nextLocalMidnightAsUtc)
  const end = new Date(nextLocalMidnightAsUtc - timeZoneOffsetMs(endGuess, timeZone))
  return { start: start.toISOString(), end: end.toISOString() }
}

async function calculateLanguageBudgets(
  supabase: SupabaseAdmin,
): Promise<Record<PipelineLanguage, LanguageBudget>> {
  const sequenceNames = PIPELINE_LANGUAGES.map((language) => OUTREACH_SEQUENCES[language].name)
  const { data: sequences } = await supabase
    .from('sequences')
    .select('id, name')
    .in('name', sequenceNames)
    .eq('status', 'active')

  const sequenceIds = (sequences ?? []).map((row: any) => row.id)
  const { data: throttleNodes } = sequenceIds.length
    ? await supabase
      .from('sequence_nodes')
      .select('sequence_id, config')
      .in('sequence_id', sequenceIds)
      .eq('node_type', 'throttle')
    : { data: [] as any[] }

  const sequenceByName = new Map((sequences ?? []).map((row: any) => [row.name, row.id]))
  const limitBySequence = new Map<string, number>()
  for (const row of throttleNodes ?? []) {
    const value = Number((row.config as any)?.max_per_day)
    if (Number.isFinite(value) && value > 0) limitBySequence.set(row.sequence_id, Math.floor(value))
  }

  const { start, end } = stockholmDayBounds()
  const { data: generatedRows, error } = await supabase
    .from('generated_sites')
    .select('id, site_lead_id, language, status')
    .gte('created_at', start)
    .lt('created_at', end)
  if (error) throw new Error(`daily build usage: ${error.message}`)

  const completedStatuses = new Set(['live'])
  const productiveStatuses = new Set(['pending', 'scraping', 'scraped', 'queued', 'processing', 'generated', 'deploying', 'live'])
  const rowsByLanguage: Record<PipelineLanguage, any[]> = { sv: [], en: [] }
  for (const row of generatedRows ?? []) rowsByLanguage[normaliseLanguage(row.language)].push(row)

  const result = {} as Record<PipelineLanguage, LanguageBudget>
  for (const language of PIPELINE_LANGUAGES) {
    const config = OUTREACH_SEQUENCES[language]
    const sequenceId = sequenceByName.get(config.name)
    const emailLimit = (sequenceId && limitBySequence.get(sequenceId)) || config.fallbackDailyLimit
    const target = emailLimit * BUILD_BUFFER_MULTIPLIER
    const rows = rowsByLanguage[language]
    const productiveIds = new Set<string>()
    const completedIds = new Set<string>()
    const inFlightIds = new Set<string>()

    for (const row of rows) {
      const leadId = String(row.site_lead_id ?? row.id)
      if (completedStatuses.has(row.status)) completedIds.add(leadId)
      if (productiveStatuses.has(row.status)) {
        productiveIds.add(leadId)
        if (!completedStatuses.has(row.status)) inFlightIds.add(leadId)
      }
    }

    const attemptCap = target + Math.max(5, Math.ceil(target * BUILD_ATTEMPT_BUFFER_RATIO))
    const attemptRemaining = Math.max(0, attemptCap - rows.length)
    const targetRemaining = Math.max(0, target - productiveIds.size)
    result[language] = {
      language,
      emailLimit,
      target,
      productive: productiveIds.size,
      completed: completedIds.size,
      inFlight: inFlightIds.size,
      attempts: rows.length,
      remaining: Math.min(targetRemaining, attemptRemaining),
      attemptRemaining,
    }
  }
  return result
}

function allocateGenerationSlots(
  budgets: Record<PipelineLanguage, LanguageBudget>,
  slots: number,
): Record<PipelineLanguage, number> {
  const allocations: Record<PipelineLanguage, number> = { sv: 0, en: 0 }
  for (let i = 0; i < slots; i++) {
    const candidates = PIPELINE_LANGUAGES
      .filter((language) => allocations[language] < budgets[language].remaining)
      .sort((a, b) => {
        const aProgress = (budgets[a].productive + allocations[a]) / Math.max(1, budgets[a].target)
        const bProgress = (budgets[b].productive + allocations[b]) / Math.max(1, budgets[b].target)
        return aProgress - bProgress || a.localeCompare(b)
      })
    if (!candidates.length) break
    allocations[candidates[0]]++
  }
  return allocations
}

async function allocateAuditSlots(
  supabase: SupabaseAdmin,
  budgets: Record<PipelineLanguage, LanguageBudget>,
  slots: number,
): Promise<Record<PipelineLanguage, number>> {
  const pending: Record<PipelineLanguage, number> = { sv: 0, en: 0 }
  const ready: Record<PipelineLanguage, number> = { sv: 0, en: 0 }
  await Promise.all(PIPELINE_LANGUAGES.flatMap((language) => [
    supabase.from('site_leads').select('id', { count: 'exact', head: true })
      .eq('status', 'pending_audit').eq('language', language)
      .then(({ count }) => { pending[language] = count ?? 0 }),
    supabase.from('site_leads').select('id', { count: 'exact', head: true })
      .eq('status', 'needs_site').eq('language', language)
      .then(({ count }) => { ready[language] = count ?? 0 }),
  ]))

  const allocations: Record<PipelineLanguage, number> = { sv: 0, en: 0 }
  for (let i = 0; i < slots; i++) {
    const candidates = PIPELINE_LANGUAGES
      .filter((language) => allocations[language] < pending[language])
      .sort((a, b) => {
        const aShort = ready[a] + allocations[a] < budgets[a].remaining ? 0 : 1
        const bShort = ready[b] + allocations[b] < budgets[b].remaining ? 0 : 1
        if (aShort !== bShort) return aShort - bShort
        if (aShort === 0) {
          const aRatio = (ready[a] + allocations[a]) / Math.max(1, budgets[a].remaining)
          const bRatio = (ready[b] + allocations[b]) / Math.max(1, budgets[b].remaining)
          if (aRatio !== bRatio) return aRatio - bRatio
        }
        return (pending[b] - allocations[b]) - (pending[a] - allocations[a])
      })
    if (!candidates.length) break
    allocations[candidates[0]]++
  }
  return allocations
}

async function releaseGenerationClaim(
  supabase: SupabaseAdmin,
  leadId: string,
): Promise<void> {
  await supabase
    .from('site_leads')
    .update({ status: 'needs_site', generated_site_id: null, updated_at: new Date().toISOString() })
    .eq('id', leadId)
    .eq('status', 'generating')
}

// ---------------------------------------------------------------------------
// RECOVER — site generation is intentionally serial, so one old row stuck in
// scraping/processing/deploying can block every new lead. This watchdog moves
// deterministic states forward and resets dead transient states for retry.
// ---------------------------------------------------------------------------
async function recoverStuckGenerations(
  supabase: SupabaseAdmin,
  supabaseUrl: string,
  serviceKey: string,
  report: { errors: string[] },
): Promise<number> {
  const cutoffMs = Date.now() - STALE_PIPELINE_MINUTES * 60_000

  // 1a. Orphans: status='generating' but no generated_sites row was ever
  // linked (the start-generation call died mid-way). These used to be
  // invisible to the watchdog and permanently blocked the queue.
  const orphanCutoff = new Date(Date.now() - ORPHAN_GRACE_MINUTES * 60_000).toISOString()
  const { data: orphans } = await supabase
    .from('site_leads')
    .select('id')
    .eq('status', 'generating')
    .is('generated_site_id', null)
    .lt('updated_at', orphanCutoff)
    .limit(50)

  let orphanFixed = 0
  if (orphans?.length) {
    const { error: orphanErr } = await supabase
      .from('site_leads')
      .update({ status: 'needs_site', updated_at: new Date().toISOString() })
      .in('id', orphans.map((o: any) => o.id))
    if (orphanErr) report.errors.push(`recover orphans: ${orphanErr.message}`)
    else orphanFixed = orphans.length
  }

  const { data: leads, error: leadErr } = await supabase
    .from('site_leads')
    .select('id, generated_site_id, feedback')
    .eq('status', 'generating')
    .not('generated_site_id', 'is', null)
    .limit(50)
  if (leadErr) {
    report.errors.push(`recover lead read: ${leadErr.message}`)
    return orphanFixed
  }
  if (!leads?.length) return orphanFixed

  const ids = leads.map((l: any) => l.generated_site_id).filter(Boolean)
  if (!ids.length) return orphanFixed

  const { data: sites, error: siteErr } = await supabase
    .from('generated_sites')
    .select('id, status, updated_at, error_message')
    .in('id', ids)
  if (siteErr) {
    report.errors.push(`recover site read: ${siteErr.message}`)
    return orphanFixed
  }

  const byId = new Map((sites ?? []).map((s: any) => [s.id, s]))
  let recovered = orphanFixed

  for (const lead of leads as any[]) {
    const gs = byId.get(lead.generated_site_id)
    if (!gs) {
      await supabase.from('site_leads').update({ status: 'needs_site', generated_site_id: null }).eq('id', lead.id)
      recovered++
      continue
    }

    const updatedAt = Date.parse(gs.updated_at ?? '')
    const isStale = Number.isFinite(updatedAt) && updatedAt < cutoffMs
    if (!isStale) continue

    if (gs.status === 'scraped') {
      await supabase.from('generated_sites').update({ updated_at: new Date().toISOString() }).eq('id', gs.id)
      await invokeFn(supabaseUrl, serviceKey, 'generate-site', { generated_site_id: gs.id })
        .catch((e) => report.errors.push(`recover generate ${gs.id}: ${e.message}`))
      recovered++
      continue
    }

    if (gs.status === 'queued') {
      await supabase.from('generated_sites').update({
        queued_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', gs.id)
      await invokeFn(supabaseUrl, serviceKey, 'process-site-jobs', { generated_site_id: gs.id, force: true })
        .catch((e) => report.errors.push(`recover queued ${gs.id}: ${e.message}`))
      recovered++
      continue
    }

    if (gs.status === 'processing') {
      await supabase.from('generated_sites').update({
        status: 'queued',
        queued_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error_message: `Recovered a stalled processing step after ${STALE_PIPELINE_MINUTES} minutes; retrying automatically.`,
      }).eq('id', gs.id)
      await invokeFn(supabaseUrl, serviceKey, 'process-site-jobs', { generated_site_id: gs.id, force: true })
        .catch((e) => report.errors.push(`recover processing ${gs.id}: ${e.message}`))
      recovered++
      continue
    }

    if (gs.status === 'generated') {
      await supabase.from('generated_sites').update({ updated_at: new Date().toISOString() }).eq('id', gs.id)
      await invokeFn(supabaseUrl, serviceKey, 'deploy-site', { generated_site_id: gs.id })
        .catch((e) => report.errors.push(`recover deploy ${gs.id}: ${e.message}`))
      recovered++
      continue
    }

    if (gs.status === 'deploying') {
      await supabase.from('generated_sites').update({ updated_at: new Date().toISOString() }).eq('id', gs.id)
      await invokeFn(supabaseUrl, serviceKey, 'deploy-site', { generated_site_id: gs.id })
        .catch((e) => report.errors.push(`recover verify deploy ${gs.id}: ${e.message}`))
      recovered++
      continue
    }

    if (gs.status === 'failed') {
      await supabase.from('site_leads').update({
        status: 'failed',
        feedback: `Site pipeline failed: ${(gs.error_message ?? '').slice(0, 400)}`,
      }).eq('id', lead.id)
      recovered++
      continue
    }

    await supabase.from('generated_sites').update({
      status: 'queued',
      queued_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_message: `Recovered stale ${gs.status} step after ${STALE_PIPELINE_MINUTES} minutes; keeping the job in queue.`,
    }).eq('id', gs.id)
    await invokeFn(supabaseUrl, serviceKey, 'process-site-jobs', { generated_site_id: gs.id, force: true })
      .catch((e) => report.errors.push(`recover generic ${gs.id}: ${e.message}`))
    recovered++
  }

  return recovered
}

// ---------------------------------------------------------------------------
// RECONCILE — mirror generated_sites status onto linked site_leads, and
// push the site through the next pipeline step when possible.
// ---------------------------------------------------------------------------
async function reconcile(
  supabase: SupabaseAdmin,
  supabaseUrl: string,
  serviceKey: string,
  report: { errors: string[] },
): Promise<number> {
  // Only look at leads currently mid-flight
  const { data: leads } = await supabase
    .from('site_leads')
    .select('id, status, generated_site_id')
    .eq('status', 'generating')
    .not('generated_site_id', 'is', null)
    .limit(50)
  if (!leads?.length) return 0

  const ids = leads.map((l) => l.generated_site_id!).filter(Boolean)
  const { data: sites } = await supabase
    .from('generated_sites')
    .select('id, status, demo_site_url, error_message')
    .in('id', ids)

  const byId = new Map((sites ?? []).map((s: any) => [s.id, s]))
  let moved = 0

  for (const lead of leads) {
    const gs: any = byId.get(lead.generated_site_id!)
    if (!gs) continue

    if (gs.status === 'scraped') {
      await invokeFn(supabaseUrl, serviceKey, 'generate-site', { generated_site_id: gs.id })
        .catch((e) => report.errors.push(`kick generate ${gs.id}: ${e.message}`))
      moved++
    } else if (gs.status === 'generated') {
      await invokeFn(supabaseUrl, serviceKey, 'deploy-site', { generated_site_id: gs.id })
        .catch((e) => report.errors.push(`kick deploy ${gs.id}: ${e.message}`))
      moved++
    } else if (gs.status === 'deploying') {
      await invokeFn(supabaseUrl, serviceKey, 'deploy-site', { generated_site_id: gs.id })
        .catch((e) => report.errors.push(`kick verify deploy ${gs.id}: ${e.message}`))
      moved++
    } else if (gs.status === 'live' && gs.demo_site_url) {
      if (!isCanonicalDemoUrl(gs.demo_site_url)) {
        await supabase.from('site_leads').update({
          status: 'failed',
          feedback: 'Site pipeline failed: demo URL was not published as a stable public URL. Re-run deploy.',
        }).eq('id', lead.id)
        moved++
        continue
      }
      await supabase.from('site_leads').update({
        status: 'awaiting_approval',
        demo_url: gs.demo_site_url,
      }).eq('id', lead.id)
      moved++
    } else if (gs.status === 'failed') {
      await supabase.from('site_leads').update({
        status: 'failed',
        feedback: `Site pipeline failed: ${(gs.error_message ?? '').slice(0, 400)}`,
      }).eq('id', lead.id)
      moved++
    }
  }
  return moved
}

// ---------------------------------------------------------------------------
// AUDIT — shared screenshot-first Firecrawl + OpenRouter scorer. Keeping this
// in one shared implementation prevents cron and manual audits from disagreeing.
// ---------------------------------------------------------------------------
async function auditOne(
  supabase: SupabaseAdmin,
  row: { id: string; website: string; company_name: string; language?: string | null },
) {
  const breakers = await activePipelineBreakers(supabase)
  if (breakers.length) throw new Error(`pipeline paused: ${breakers.map((breaker) => breaker.provider).join(', ')}`)

  const fcKey = Deno.env.get('FIRECRAWL_API_KEY')
  const openrouterKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!fcKey || !openrouterKey) {
    await supabase.from('site_leads').update({ status: 'pending_audit' }).eq('id', row.id)
    throw new Error('missing FIRECRAWL_API_KEY or OPENROUTER_API_KEY')
  }

  const language = normaliseLanguage(row.language)
  let result
  try {
    result = await auditWebsite(row.website, row.company_name ?? '', fcKey, openrouterKey, language)
  } catch (error) {
    const provider = error instanceof ScrapeProviderError ? 'firecrawl' : 'openrouter'
    const httpStatus = error instanceof ScrapeProviderError ? error.status : undefined
    await recordPipelineFailure(supabase, {
      provider,
      sourceFunction: 'process-site-leads:audit',
      message: (error as Error).message,
      httpStatus,
      siteLeadId: row.id,
    })
    await supabase.from('site_leads').update({ status: 'pending_audit' }).eq('id', row.id)
    throw error
  }

  const nextStatus = result.unreadable && result.uncertain
    ? 'needs_triage'
    : result.score >= 7
      ? 'site_good_enough'
      : 'needs_site'
  const { error: saveError } = await supabase.from('site_leads').update({
    status: nextStatus,
    audit_score: result.score,
    audit_reason: result.reason.slice(0, 500),
    audit_details: {
      weaknesses: result.weaknesses.slice(0, 6),
      structural: result.structural.slice(0, 5),
      cosmetic: result.cosmetic.slice(0, 5),
      uncertain: result.uncertain,
      screenshot: result.screenshot,
    },
  }).eq('id', row.id)
  if (saveError) {
    await supabase.from('site_leads').update({ status: 'pending_audit' }).eq('id', row.id)
    throw new Error(`save audit: ${saveError.message}`)
  }
}

// ---------------------------------------------------------------------------
// Which site engine new jobs use. Controlled from /site-leads via
// app_settings.site_generation_mode ('template' = current template engine,
// 'freeform' = AI builds the whole site). Env var is a hard override.
let cachedGenerationMode: 'template' | 'freeform' | null = null
async function resolveGenerationMode(
  supabase: SupabaseAdmin,
): Promise<'template' | 'freeform'> {
  const envMode = Deno.env.get('SITE_GENERATION_MODE')
  if (envMode === 'freeform' || envMode === 'template') return envMode
  if (cachedGenerationMode) return cachedGenerationMode
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'site_generation_mode')
    .maybeSingle()
  const mode = (data?.value as any)?.mode
  cachedGenerationMode = mode === 'freeform' ? 'freeform' : 'template'
  return cachedGenerationMode
}

async function chooseTemplateFamilyForLead(lead: any): Promise<{
  family: BlockTemplateFamily
  source: 'ai' | 'rules'
  reason?: string
}> {
  const fallback = selectBlockTemplateFamily({
    category: lead?.category ?? null,
    niche: lead?.niche ?? null,
    businessName: lead?.company_name ?? null,
  })
  const lovableKey = Deno.env.get('LOVABLE_API_KEY')
  if (!lovableKey) return { family: fallback, source: 'rules', reason: 'LOVABLE_API_KEY missing' }

  const familyCatalog = blockTemplateFamilyCatalog()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 12_000)
  try {
    const resp = await fetch(`${AI_GATEWAY}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Lovable-API-Key': lovableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TEMPLATE_PICKER_MODEL,
        temperature: 0,
        top_p: 1,
        seed: 42,
        messages: [
          {
            role: 'system',
            content: [
              'You choose the best website template family for a local-business lead.',
              'You must choose ONLY from the provided template families.',
              'Use the lead category as the strongest signal, then niche, then company name.',
              'If operator feedback says the previous template was wrong or asks for a more fitting template, treat that feedback as high priority when choosing a better family.',
              'Read the notes carefully: some templates fit visual/beauty businesses with many images, some fit practical service companies, some fit clinics, restaurants, mechanics or construction.',
              'Do not choose based on one random keyword if the broader business type points elsewhere.',
              'If the lead is unclear, choose the safest broad fit instead of forcing a niche-specific template.',
              'Return strict JSON only.',
              '{"templateFamily":"one of the provided keys","reason":"short explanation","confidence":0}',
            ].join('\n'),
          },
          {
            role: 'user',
            content: JSON.stringify({
              lead: {
                category: lead?.category ?? null,
                niche: lead?.niche ?? null,
                company_name: lead?.company_name ?? null,
                language: lead?.language ?? 'sv',
                feedback: lead?.feedback ?? null,
              },
              templateFamilies: familyCatalog,
            }),
          },
        ],
        response_format: { type: 'json_object' },
      }),
    })
    clearTimeout(timeoutId)
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      return { family: fallback, source: 'rules', reason: `AI picker failed (${resp.status})` }
    }
    const raw = String(data?.choices?.[0]?.message?.content ?? '{}')
    const parsed = JSON.parse(raw) as { templateFamily?: string; reason?: string; confidence?: number }
    const key = parsed?.templateFamily
    if (!key || !(key in BLOCK_TEMPLATE_FAMILIES)) {
      return { family: fallback, source: 'rules', reason: 'AI picker returned unknown family' }
    }
    return {
      family: BLOCK_TEMPLATE_FAMILIES[key as BlockTemplateFamilyKey],
      source: 'ai',
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 240) : undefined,
    }
  } catch (err) {
    return {
      family: fallback,
      source: 'rules',
      reason: (err as Error).name === 'AbortError' ? 'AI picker timed out' : `AI picker error: ${(err as Error).message}`,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

// GENERATE — creates synthetic contact + generated_sites row, kicks off
// scrape-lead-data. The reconciler above then walks the pipeline forward.
// ---------------------------------------------------------------------------
async function startGeneration(
  supabase: SupabaseAdmin,
  supabaseUrl: string,
  serviceKey: string,
  lead: any,
) {
  const breakers = await activePipelineBreakers(supabase)
  if (breakers.length) throw new Error(`pipeline paused: ${breakers.map((row) => row.provider).join(', ')}`)

  // Resolve the niche up-front: it is used both on the ghost contact and on
  // the generated_sites row (previously declared after first use -> TDZ crash).
  const niche = inferLeadNiche(lead)
  const nicheTemplate = templateForNiche(niche)
  const chosenFamily = await chooseTemplateFamilyForLead({
    ...lead,
    niche: lead?.niche ?? niche ?? null,
  })
  const blockFamily = chosenFamily.family

  // No template exists for this category yet -> the site can only be built by
  // the freeform (AI-from-scratch) engine.
  const resolvedMode = await resolveGenerationMode(supabase)
  const shouldUseBlockTemplateRenderer = lead.language !== 'en'
    && blockFamily.key !== 'service_clarity_default'
  const generationMode = lead.language === 'en'
    ? 'freeform'
    : shouldUseBlockTemplateRenderer
      ? 'freeform'
    : nicheTemplate
      ? resolvedMode
      : 'freeform'


  // Ensure ghost list for this user
  const { data: list } = await supabase
    .from('contact_lists')
    .select('id')
    .eq('user_id', lead.user_id)
    .eq('name', GHOST_LIST_NAME)
    .maybeSingle()
  let listId = list?.id
  if (!listId) {
    const { data: created, error: listErr } = await supabase
      .from('contact_lists')
      .insert({ user_id: lead.user_id, name: GHOST_LIST_NAME })
      .select('id')
      .single()
    if (listErr) throw new Error(`list create: ${listErr.message}`)
    listId = created.id
  }

  // Reuse existing ghost contact for this lead if we have one, else create
  const { data: existingContact } = await supabase
    .from('contacts')
    .select('id')
    .eq('user_id', lead.user_id)
    .eq('list_id', listId)
    .contains('custom_fields', { __site_lead_id: lead.id })
    .maybeSingle()

  let contactId = existingContact?.id
  if (!contactId) {
    const { data: newContact, error: cErr } = await supabase
      .from('contacts')
      .insert({
        user_id: lead.user_id,
        list_id: listId,
        email: lead.email,
        first_name: '',
        last_name: '',
        custom_fields: {
          __site_lead_id: lead.id,
          company: lead.company_name,
          phone: lead.phone ?? null,
          address: lead.address ?? null,
          website: lead.website,
          category: lead.category ?? null,
          rating: lead.rating ?? null,
          reviews: (lead.review_snippets ?? []).slice(0, 3),
          audit_reason: lead.audit_reason ?? null,
          audit_details: lead.audit_details ?? null,
          language: lead.language === 'en' ? 'en' : 'sv',
          niche,
          template_family: blockFamily.key,
          template_family_source: chosenFamily.source,
          template_family_reason: chosenFamily.reason ?? null,
        },
      })
      .select('id')
      .single()
    if (cErr) throw new Error(`contact create: ${cErr.message}`)
    contactId = newContact.id
  }

  // Create the generated_sites row wired to the lead. Template is picked
  // from the lead's niche tag so the AI knows which layout to build.
  const { data: gs, error: gsErr } = await supabase
    .from('generated_sites')
    .insert({
      user_id: lead.user_id,
      contact_id: contactId,
      site_lead_id: lead.id,
      source_url: normaliseUrl(lead.website),
      status: 'pending',
      language: lead.language === 'en' ? 'en' : 'sv',
      // NOT NULL column: freeform builds have no template, use a marker so the
      // insert can't fail (this used to abort every non-template category).
      template: generationMode === 'freeform' ? blockFamily.key : (nicheTemplate ?? 'freeform'),
      generation_mode: generationMode,
    })
    .select('id')
    .single()
  if (gsErr) throw new Error(`generated_sites: ${gsErr.message}`)

  // Always refresh custom_fields so latest feedback is available to
  // process-site-jobs on this generation attempt.
  await supabase
    .from('contacts')
    .update({
      custom_fields: {
        __site_lead_id: lead.id,
        company: lead.company_name,
        phone: lead.phone ?? null,
        address: lead.address ?? null,
        website: lead.website,
        category: lead.category ?? null,
        rating: lead.rating ?? null,
        reviews: (lead.review_snippets ?? []).slice(0, 3),
        audit_reason: lead.audit_reason ?? null,
        audit_details: lead.audit_details ?? null,
        language: lead.language === 'en' ? 'en' : 'sv',
        regen_feedback: lead.feedback ?? null,
        niche,
        template_family: blockFamily.key,
        template_family_source: chosenFamily.source,
        template_family_reason: chosenFamily.reason ?? null,
      },
    })
    .eq('id', contactId)

  await supabase.from('site_leads').update({
    status: 'generating',
    generated_site_id: gs.id,
  }).eq('id', lead.id)

  // Start scrape reliably. This used to be fire-and-forget, which meant the
  // parent worker could finish before the HTTP request was actually delivered,
  // leaving rows stuck in `pending`/`generating` and blocking the serial queue.
  const scrapeResp = await invokeFn(supabaseUrl, serviceKey, 'scrape-lead-data', { generated_site_id: gs.id })
  if (!scrapeResp.ok) {
    const body = await scrapeResp.text().catch(() => '')
    let providerFailure = false
    try { providerFailure = JSON.parse(body)?.provider === 'firecrawl' } catch { /* plain error body */ }
    await supabase.from('generated_sites').update({
      status: 'failed',
      error_message: `Scrape failed (${scrapeResp.status}): ${body.slice(0, 400)}`,
    }).eq('id', gs.id)
    await supabase.from('site_leads').update({
      status: providerFailure || scrapeResp.status === 423 ? 'needs_site' : 'failed',
      generated_site_id: providerFailure || scrapeResp.status === 423 ? null : gs.id,
      feedback: providerFailure || scrapeResp.status === 423 ? null : `Scrape failed: ${body.slice(0, 400)}`,
    }).eq('id', lead.id)
    throw new Error(`scrape failed (${scrapeResp.status}): ${body.slice(0, 200)}`)
  }

  // Start generation immediately after a successful scrape instead of waiting
  // for the next reconcile/cron sweep. This removes the long "building" gap
  // where the UI says generating but OpenRouter has not been called yet.
  const generateResp = await invokeFn(supabaseUrl, serviceKey, 'generate-site', { generated_site_id: gs.id })
  if (!generateResp.ok) {
    const body = await generateResp.text().catch(() => '')
    await supabase.from('generated_sites').update({
      status: 'failed',
      error_message: `Generate queue failed (${generateResp.status}): ${body.slice(0, 400)}`,
    }).eq('id', gs.id)
    await supabase.from('site_leads').update({
      status: 'failed',
      feedback: `Generate queue failed: ${body.slice(0, 400)}`,
    }).eq('id', lead.id)
    throw new Error(`generate queue failed (${generateResp.status}): ${body.slice(0, 200)}`)
  }
}

// ---------------------------------------------------------------------------
async function invokeFn(supabaseUrl: string, serviceKey: string, name: string, body: unknown) {
  return fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify(body),
  })
}

function normaliseUrl(raw: string): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  return `https://${s.replace(/^\/+/, '')}`
}

function inferLeadNiche(lead: any): NicheKey | null {
  // The category column from the uploaded lead file is the source of truth.
  // The stored niche tag (if any) is only a fallback for older leads.
  return classifyNiche(lead?.category) ?? classifyNiche(lead?.niche) ?? classifyNiche(lead?.company_name)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
