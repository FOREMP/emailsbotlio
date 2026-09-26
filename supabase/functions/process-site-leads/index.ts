// Site-lead outreach orchestrator.
// Runs every 10 min (cron) or on-demand. Three phases per tick:
//   1. RECONCILE — advance in-flight generated_sites through scraped → queued
//      → generated → live, mirror status onto site_leads (awaiting_approval
//      when live, failed when the site pipeline errored).
//   2. AUDIT — for up to AUDIT_PER_TICK pending_audit leads: scrape with
//      Firecrawl, score 1-10 with Gemini, extract 2-3 concrete weaknesses.
//      Scores of 7 or more are automatically parked as site_good_enough.
//      Swedish sites with verified hard failures enter build-and-send, while
//      cosmetic-only sites are parked and ambiguous cases remain reviewable. In English
//      audit_only mode, scores 1–6 with a contact email enter the Botlio
//      audit sequence without generating a demo. Low-confidence evidence is
//      retained in the audit email, rather than creating an operator backlog.
//   3. GENERATE — enforce daily cap DAILY_GEN_CAP by counting leads that
//      already moved into generating/awaiting_approval/approved today. If
//      capacity is left, take exactly GEN_PER_TICK needs_site leads, create a
//      synthetic contact + generated_sites row and kick scrape-lead-data.
// The whole file uses the service role; cron sends the anon key just so
// pg_net can hit the function endpoint (verify_jwt is off).
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  activePipelineBreakers,
  recordPipelineFailure,
} from '../_shared/site-pipeline-health.ts'
import { selectedScrapeProvider, ScraperError, type ScrapeProvider } from '../_shared/scraper-client.ts'
import { auditWebsite, classifyAuditDisposition } from '../_shared/site-audit.ts'
import { auditWebsiteWithJev } from '../_shared/jev-audit.ts'
import { callRoutedChat } from '../_shared/ai-provider.ts'
import { classifyNiche, templateForNiche, type NicheKey } from '../_shared/niche.ts'
import {
  blockTemplateFamilyCatalog,
  BLOCK_TEMPLATE_FAMILIES,
  selectBlockTemplateFamilyDecision,
  type BlockTemplateFamily,
  type BlockTemplateFamilyKey,
} from '../_shared/block-templates.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const AUDIT_PER_TICK = 1    // keep Edge runtime stable; JEV mode is fast, current screenshot audit is heavy
const AUDIT_AI_RETRY_LIMIT = 2 // avoid endless scrape+model loops on provider/runtime failures
const STALE_AUDIT_MINUTES = 12 // Edge can terminate mid-audit; reset these rows so the queue keeps moving
// Sites at this quality are parked automatically. The Swedish evidence-led
// disposition below can also park cosmetic-only 5–6 results.
const AUDIT_AUTO_PARK_SCORE = 7
const GEN_PER_TICK = 6      // how many new pipelines may START per tick
const MAX_CONCURRENT_GEN = 24 // how many leads may be mid-pipeline at once
const DAILY_GEN_CAP_FALLBACK = 16  // used only if we can't read sender limits
const OUTREACH_DOMAINS_BY_LANGUAGE = {
  sv: ['foremp.email', 'foremp.one', 'foremp.eu', 'website.foremp.email'],
  en: ['botlio.email', 'botlio.eu', 'website.botlio.email'],
} as const
const GHOST_LIST_NAME = 'Site Leads (auto)'
const ENGLISH_AUDIT_SEQUENCE = 'English Audit Outreach'
// Bump this when the shared audit model changes so Supabase rebuilds the
// function bundle instead of continuing to serve an older _shared/site-audit.ts.
const AUDIT_MODEL_BUNDLE_VERSION = 'audit-jev-selectable-2026-09-24'
const STOCKHOLM_TZ = 'Europe/Stockholm'
const SEND_WINDOW_START = 9
const SEND_WINDOW_END = 16

type EnglishOutreachMode = 'audit_only' | 'demo_sites' | 'paused'
type EnglishOutreachSettings = {
  mode: EnglishOutreachMode
  sourcing_enabled: boolean
  max_audit_score: number
  require_reliable_audit: boolean
  track_first_email: boolean
  daily_first_touch_limit: number
}

const DEFAULT_ENGLISH_OUTREACH_SETTINGS: EnglishOutreachSettings = {
  mode: 'audit_only',
  sourcing_enabled: true,
  max_audit_score: 5,
  require_reliable_audit: false,
  track_first_email: true,
  daily_first_touch_limit: 20,
}

function stockholmParts(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: STOCKHOLM_TZ, hour12: false,
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(now).map((part) => [part.type, part.value])) as any
  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: String(parts.weekday),
  }
}

function insideSendWindow(now = new Date()): boolean {
  const parts = stockholmParts(now)
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false
  const minutes = parts.hour * 60 + parts.minute
  return minutes >= SEND_WINDOW_START * 60 && minutes < SEND_WINDOW_END * 60
}

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
const TEMPLATE_PICKER_NVIDIA_MODEL = 'deepseek-ai/deepseek-v3.2'
const TEMPLATE_PICKER_OPENROUTER_FALLBACK = 'deepseek/deepseek-chat-v3.1'

// Audit-led outreach is only safe when we can connect the destination address
// to the business that was actually audited, and when the audit supplies a
// customer-visible fact. This prevents the very damaging failure mode where a
// perfectly valid email address for Company A receives a message about Company
// B, or an LLM fills a generic "dated design" claim into every first email.
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'icloud.com', 'me.com', 'yahoo.com', 'yahoo.co.uk', 'aol.com', 'proton.me',
  'protonmail.com', 'gmx.com', 'mail.com',
])
const GENERIC_DOMAIN_TOKENS = new Set([
  'www', 'com', 'co', 'uk', 'se', 'net', 'org', 'ltd', 'limited', 'llp',
  'plc', 'inc', 'the', 'and', 'for', 'of', 'company', 'services', 'service',
])
const UNSAFE_AUDIT_OBSERVATION = /\b(dated|outdated|old[- ]fashioned|generic|visual design|user experience|weak hierarchy|thin copy|could improve|needs improving|enhance|enhancement|modernis|better website)\b/i
const CONCRETE_AUDIT_OBSERVATION = /\b(broken|missing|placeholder|default|under construction|not found|404|error|incorrect|wrong (?:company|business|name)|third[- ]party|booking (?:page|profile|platform)|no (?:phone|email|contact|service|opening)|hard to read|unreadable|not visible|does not load|fails? to load|no own (?:website|domain)|only (?:a )?(?:facebook|instagram|booking|profile))\b/i

function hostnameFor(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, '') || null
  } catch {
    return null
  }
}

function domainTokens(value: unknown): Set<string> {
  const host = hostnameFor(value)
  if (!host) return new Set()
  return new Set(host
    .split(/[.\-_/]+/)
    .map((token) => token.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((token) => token.length >= 3 && !GENERIC_DOMAIN_TOKENS.has(token)))
}

function companyTokens(value: unknown): Set<string> {
  return new Set(String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !GENERIC_DOMAIN_TOKENS.has(token)))
}

function overlaps(left: Set<string>, right: Set<string>): boolean {
  for (const token of left) if (right.has(token)) return true
  return false
}

function verifyLeadEmailIdentity(lead: any): { ok: boolean; reason?: string } {
  const email = String(lead?.email ?? '').trim().toLowerCase()
  const emailDomain = email.split('@')[1] ?? ''
  if (!email || !emailDomain) return { ok: false, reason: 'No usable email address is available.' }
  // A personal mailbox cannot be domain-verified, but it is not proof of a
  // mismatch either. The existing duplicate, suppression and reply safeguards
  // still apply to it.
  if (FREE_EMAIL_DOMAINS.has(emailDomain)) return { ok: true }

  const websiteHost = hostnameFor(lead?.website)
  if (!websiteHost) return { ok: true }
  const emailTokens = domainTokens(emailDomain)
  const websiteTokens = domainTokens(websiteHost)
  const businessTokens = companyTokens(lead?.company_name)
  if (emailDomain === websiteHost || overlaps(emailTokens, websiteTokens) || overlaps(emailTokens, businessTokens)) return { ok: true }
  return { ok: false, reason: `The email domain ${emailDomain} does not match the audited website or company name.` }
}

function selectConcreteAuditObservation(lead: any): string | null {
  const structural = Array.isArray(lead?.audit_details?.structural)
    ? lead.audit_details.structural
    : []
  for (const value of structural) {
    const observation = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
    if (!observation || observation.length > 260) continue
    if (UNSAFE_AUDIT_OBSERVATION.test(observation)) continue
    if (CONCRETE_AUDIT_OBSERVATION.test(observation)) return observation
  }
  return null
}

async function holdLeadForOutreachReview(
  supabase: ReturnType<typeof createClient>,
  lead: any,
  reason: string,
) {
  const details = lead?.audit_details && typeof lead.audit_details === 'object' ? lead.audit_details : {}
  await supabase.from('site_leads').update({
    status: 'needs_triage',
    auto_send: false,
    feedback: `Outreach held for review: ${reason}`,
    audit_details: {
      ...details,
      outreach_sync_state: 'held',
      outreach_hold_reason: reason,
      outreach_held_at: new Date().toISOString(),
    },
  }).eq('id', lead.id)
}

async function resolveEnglishOutreachSettings(
  supabase: ReturnType<typeof createClient>,
): Promise<EnglishOutreachSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'english_outreach_pipeline')
    .maybeSingle()
  if (error) throw new Error(`english outreach settings: ${error.message}`)
  const raw = data?.value && typeof data.value === 'object' ? data.value as Record<string, unknown> : {}
  const mode: EnglishOutreachMode = raw.mode === 'demo_sites' || raw.mode === 'paused'
    ? raw.mode
    : 'audit_only'
  return {
    mode,
    sourcing_enabled: raw.sourcing_enabled !== false,
    max_audit_score: Math.max(1, Math.min(6, Number(raw.max_audit_score) || DEFAULT_ENGLISH_OUTREACH_SETTINGS.max_audit_score)),
    require_reliable_audit: raw.require_reliable_audit !== false,
    track_first_email: raw.track_first_email !== false,
    daily_first_touch_limit: Math.max(1, Math.min(100, Number(raw.daily_first_touch_limit) || DEFAULT_ENGLISH_OUTREACH_SETTINGS.daily_first_touch_limit)),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  const report = { audit_model_bundle: AUDIT_MODEL_BUNDLE_VERSION, reconciled: 0, auto_synced: 0, audit_outreach_synced: 0, recovered: 0, audit_recovered: 0, audited: 0, auto_parked: 0, auto_qualified: 0, generated: 0, capacity: 0, errors: [] as string[] }

  // Manual override from the Site Leads UI: build these leads right now,
  // ignoring the automation switch and the daily cap.
  let overrideIds: string[] = []
  let regenerateExisting = false
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      if (body?.force && Array.isArray(body?.lead_ids)) {
        overrideIds = body.lead_ids.filter((v: unknown) => typeof v === 'string').slice(0, 20)
        regenerateExisting = body?.regenerate_existing === true
      }
    } catch { /* no body — normal cron tick */ }
  }

  try {
    if (overrideIds.length > 0) {
      const { data: forced } = await supabase
        .from('site_leads')
        .select('id, user_id, company_name, website, email, phone, address, category, niche, rating, review_snippets, audit_reason, audit_details, feedback, language, generated_site_id')
        .in('id', overrideIds)
      for (const lead of forced ?? []) {
        try {
          if (regenerateExisting && lead.generated_site_id) await reselectAndRegenerate(supabase, supabaseUrl, serviceKey, lead as any)
          else await startGeneration(supabase, supabaseUrl, serviceKey, lead as any)
          report.generated++
        } catch (e) {
          report.errors.push(`force ${lead.id}: ${(e as Error).message}`)
        }
      }
      return json({ ok: true, forced: true, ...report })
    }

    // ---------------- 1. RECONCILE ----------------
    report.reconciled = await reconcile(supabase, supabaseUrl, serviceKey, report)
    // Repair already-live auto-send leads from older deployments. This is
    // intentionally idempotent: a lead/contact can never get two enrollments.
    report.auto_synced = await syncPendingAutoSendLeads(supabase, report)
    report.recovered = await recoverStuckGenerations(supabase, supabaseUrl, serviceKey, report)
    report.audit_recovered = await recoverStuckAudits(supabase, report)


    // Operator on/off switch (Igång / Pausad / Stoppad) from /site-leads.
    const { data: autoRow } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'site_generation_state')
      .maybeSingle()
    const autoState = ((autoRow as any)?.value?.state ?? 'running') as string
    if (autoState !== 'running') {
      report.errors.push(`skip audit+generate: automation is ${autoState}`)
      // Lead sourcing is a separate durable pipeline. Keep its watchdog
      // alive while website generation is paused, or a dead Maps task can
      // hold the sourcing lock forever.
      await invokeFn(supabaseUrl, serviceKey, 'lead-sourcing', { action: 'auto_tick' })
        .catch((error) => report.errors.push(`lead sourcing: ${error.message}`))
      return json({ ok: true, ...report })
    }

    const englishOutreach = await resolveEnglishOutreachSettings(supabase)
    const auditEngine = await resolveSiteAuditEngine(supabase)

    // ---------------- 2. AUDIT --------------------
    const { data: auditRowsRaw } = await supabase
      .from('site_leads')
      .select('id, user_id, website, email, phone, category, company_name, language, audit_details')
      .eq('status', 'pending_audit')
      .not('website', 'is', null)
      .order('created_at', { ascending: true })
      // Read ahead so paused English work cannot hide eligible Swedish work.
      .limit(AUDIT_PER_TICK * 4)

    const auditRows = (auditRowsRaw ?? [])
      .filter((row: any) => row.language !== 'en' || englishOutreach.mode !== 'paused')
      .slice(0, AUDIT_PER_TICK)

    if (auditRows.length) {
      const scrapeProvider = await selectedScrapeProvider(supabase)
      const breakers = await activePipelineBreakers(supabase, [scrapeProvider])
      if (breakers.length) {
        report.errors.push(`skip audit: pipeline paused: ${breakers.map((breaker) => breaker.provider).join(', ')}`)
      } else {
        for (const row of auditRows) {
          try {
            await auditOne(supabase, row as any, englishOutreach, scrapeProvider, auditEngine)
            report.audited++
          } catch (e) {
            report.errors.push(`audit ${row.id}: ${(e as Error).message}`)
          }
        }
      }
    }

    // Repair rows scored by the previous threshold. This is deliberately
    // limited to leads still awaiting an audit decision; it never changes a
    // lead that an operator has already chosen to build, review, or send.
    report.auto_parked = await parkHighQualityAudits(supabase, report)
    report.auto_qualified = await advanceReliableLowQualityAudits(supabase, englishOutreach, report)
    if (englishOutreach.mode === 'audit_only') {
      report.audit_outreach_synced = await syncPendingAuditOnlyLeads(supabase, englishOutreach, report)
    }

    // ---------------- 3. GENERATE -----------------
    // Keep independent Swedish and English build budgets. A busy Swedish day
    // must never consume the English site's capacity (or vice versa).
    const { data: dailySenders } = await supabase
      .from('senders')
      .select('daily_limit, from_email')
      .eq('is_active', true)
    const dailyCaps = (['sv', 'en'] as const).reduce((caps, language) => {
      if (language === 'en' && englishOutreach.mode !== 'demo_sites') {
        caps.en = 0
        return caps
      }
      caps[language] = (dailySenders ?? [])
        .filter((r: any) => OUTREACH_DOMAINS_BY_LANGUAGE[language]
          .some((domain) => String(r.from_email ?? '').toLowerCase().endsWith(`@${domain}`)))
        .reduce((sum: number, r: any) => sum + Math.max(0, Number(r.daily_limit) || 0), 0)
      return caps
    }, { sv: 0, en: 0 } as Record<'sv' | 'en', number>)
    if (dailyCaps.sv + dailyCaps.en === 0) dailyCaps.sv = DAILY_GEN_CAP_FALLBACK

    // Count builds actually STARTED today. Using site_leads.updated_at made
    // approvals of older leads eat today's quota, starving generation.
    const today = new Date().toISOString().slice(0, 10)
    const { data: builtToday } = await supabase
      .from('generated_sites')
      .select('language')
      .gte('created_at', `${today}T00:00:00Z`)
    const usedToday = { sv: 0, en: 0 }
    for (const site of builtToday ?? []) {
      const language = site.language === 'en' ? 'en' : 'sv'
      usedToday[language]++
    }
    const languageCapacity = {
      sv: Math.max(0, dailyCaps.sv - usedToday.sv),
      en: Math.max(0, dailyCaps.en - usedToday.en),
    }
    const capacity = languageCapacity.sv + languageCapacity.en
    report.capacity = capacity

    if (capacity > 0) {
      // Bounded-concurrency pipeline: keep up to MAX_CONCURRENT_GEN leads
      // mid-flight so the daily quota can actually be reached, instead of the
      // old strictly-serial gate where one lead blocked the whole queue.
      const { count: inFlight } = await supabase
        .from('site_leads')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'generating')

      const slots = Math.max(0, MAX_CONCURRENT_GEN - (inFlight ?? 0))
      if (slots === 0) {
        report.errors.push(`skip generate: ${inFlight} lead(s) still in flight`)
      } else {
        const take = Math.min(GEN_PER_TICK, capacity, slots)
        const { data: needsSite } = await supabase
          .from('site_leads')
          .select('id, user_id, company_name, website, email, phone, address, category, niche, rating, review_snippets, audit_reason, audit_details, feedback, language')
          .eq('status', 'needs_site')
          .not('website', 'is', null)
          .not('email', 'is', null)
          .order('audit_score', { ascending: true, nullsFirst: false })
          // Read a few extra rows so one language at capacity cannot hide
          // eligible work for the other language at the front of the queue.
          .limit(Math.max(take * 4, take))

        const selected: any[] = []
        const remaining = { ...languageCapacity }
        for (const lead of needsSite ?? []) {
          const language = lead.language === 'en' ? 'en' : 'sv'
          if (remaining[language] <= 0) continue
          selected.push(lead)
          remaining[language]--
          if (selected.length >= take) break
        }

        if (!selected.length) {
          // Nothing to build right now — the tick simply idles and picks up
          // new needs_site leads as soon as the audit phase produces them.
          report.errors.push('idle: no needs_site leads ready')
        }

        for (const lead of selected) {
          try {
            await startGeneration(supabase, supabaseUrl, serviceKey, lead as any)
            report.generated++
          } catch (e) {
            report.errors.push(`gen ${lead.id}: ${(e as Error).message}`)
          }
        }
      }
    }

    // Sourcing has its own durable queue. This merely asks it to check the
    // approved markets; it never makes an AI call. Imported leads subsequently
    // enter pending_audit, where AUDIT_PER_TICK keeps model traffic bounded.
    await invokeFn(supabaseUrl, serviceKey, 'lead-sourcing', { action: 'auto_tick' })
      .catch((error) => report.errors.push(`lead sourcing: ${error.message}`))

    return json({ ok: true, ...report })
  } catch (err) {
    console.error('process-site-leads fatal', err)
    return json({ error: (err as Error).message, ...report }, 500)
  }
})

// ---------------------------------------------------------------------------
// AUDIT RECOVER — an Edge Function can be terminated after a row is marked
// auditing but before the catch block persists the retry. Reset stale rows so
// one dead audit cannot hide the whole pending_audit queue.
// ---------------------------------------------------------------------------
async function recoverStuckAudits(
  supabase: ReturnType<typeof createClient>,
  report: { errors: string[] },
): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_AUDIT_MINUTES * 60_000).toISOString()
  const { data, error } = await supabase
    .from('site_leads')
    .select('id, audit_details')
    .eq('status', 'auditing')
    .lt('updated_at', cutoff)
    .limit(25)

  if (error) {
    report.errors.push(`recover stale audits: ${error.message}`)
    return 0
  }
  if (!data?.length) return 0

  let recovered = 0
  for (const row of data as any[]) {
    const previousDetails = row.audit_details && typeof row.audit_details === 'object'
      ? row.audit_details
      : {}
    const staleCount = Math.max(0, Number(previousDetails.stale_audit_recovered_count) || 0) + 1
    const details = {
      ...previousDetails,
      stale_audit_recovered_count: staleCount,
      stale_audit_recovered_at: new Date().toISOString(),
    }
    const recoveredStatus = staleCount >= 3 ? 'awaiting_audit_approval' : 'pending_audit'
    const patch: Record<string, unknown> = {
      status: recoveredStatus,
      audit_details: details,
      updated_at: new Date().toISOString(),
    }
    if (recoveredStatus === 'awaiting_audit_approval') {
      patch.audit_score = 5
      patch.audit_reason = 'Auditen fastnade upprepade gånger och behöver kontrolleras manuellt.'
    }

    const { error: updateError } = await supabase
      .from('site_leads')
      .update(patch)
      .eq('id', row.id)

    if (updateError) report.errors.push(`recover stale audit ${row.id}: ${updateError.message}`)
    else recovered++
  }
  return recovered
}

// ---------------------------------------------------------------------------
// RECOVER — site generation is intentionally serial, so one old row stuck in
// scraping/processing/deploying can block every new lead. This watchdog moves
// deterministic states forward and resets dead transient states for retry.
// ---------------------------------------------------------------------------
async function recoverStuckGenerations(
  supabase: ReturnType<typeof createClient>,
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

async function reselectAndRegenerate(
  supabase: ReturnType<typeof createClient>, supabaseUrl: string, serviceKey: string, lead: any,
) {
  const niche = inferLeadNiche(lead)
  const chosen = await chooseTemplateFamilyForLead(supabase, { ...lead, niche: lead?.niche ?? niche ?? null })
  const { data: site, error } = await supabase.from('generated_sites').select('id, contact_id').eq('id', lead.generated_site_id).maybeSingle()
  if (error || !site) return startGeneration(supabase, supabaseUrl, serviceKey, lead)
  if (site.contact_id) {
    const { data: contact } = await supabase.from('contacts').select('custom_fields').eq('id', site.contact_id).maybeSingle()
    await supabase.from('contacts').update({ custom_fields: { ...(contact?.custom_fields ?? {}), regen_feedback: lead.feedback ?? null, category: lead.category ?? null, niche, template_family: chosen.family.key, template_family_source: chosen.source, template_family_reason: chosen.reason ?? null, template_family_confidence: chosen.confidence, template_family_matched_by: chosen.matchedBy, template_classifier_version: chosen.classifierVersion } }).eq('id', site.contact_id)
  }
  await supabase.from('generated_sites').update({ status: 'queued', queued_at: new Date().toISOString(), error_message: null, attempts: 0, generation_mode: 'freeform', template: chosen.family.key, gen_progress: null, generated_files: null }).eq('id', site.id)
  await supabase.from('site_leads').update({ status: 'generating', generated_site_id: site.id }).eq('id', lead.id)
  await invokeFn(supabaseUrl, serviceKey, 'process-site-jobs', { generated_site_id: site.id, force: true })
}

// ---------------------------------------------------------------------------
// RECONCILE — mirror generated_sites status onto linked site_leads, and
// push the site through the next pipeline step when possible.
// ---------------------------------------------------------------------------
async function reconcile(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  report: { errors: string[] },
): Promise<number> {
  // Only look at leads currently mid-flight
  const { data: leads } = await supabase
    .from('site_leads')
    .select('id, user_id, company_name, website, email, phone, category, language, audit_score, audit_reason, audit_details, auto_send, status, generated_site_id')
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
      if (lead.auto_send) {
        try {
          await syncAutoSendLead(supabase, lead, gs.demo_site_url)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await supabase.from('site_leads').update({
            status: 'awaiting_approval',
            demo_url: gs.demo_site_url,
            feedback: `Auto-send sync failed: ${message.slice(0, 350)}`,
          }).eq('id', lead.id)
          report.errors.push(`auto-send sync ${lead.id}: ${message}`)
        }
      } else {
        await supabase.from('site_leads').update({
          status: 'awaiting_approval',
          demo_url: gs.demo_site_url,
        }).eq('id', lead.id)
      }
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

// Existing rows can be live while still showing "Direktutskick väntar på
// synkning" if an older reconciler always routed live sites to approvals.
// Repair a bounded batch every tick; retries are safe because enrollment
// creation below is idempotent.
async function syncPendingAutoSendLeads(
  supabase: ReturnType<typeof createClient>,
  report: { errors: string[] },
): Promise<number> {
  const { data: leads, error } = await supabase
    .from('site_leads')
    .select('id, user_id, company_name, website, email, phone, category, language, audit_score, audit_reason, audit_details, auto_send, demo_url')
    .eq('status', 'awaiting_approval')
    .eq('auto_send', true)
    .not('email', 'is', null)
    .not('demo_url', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(25)
  if (error) {
    report.errors.push(`load pending auto-send: ${error.message}`)
    return 0
  }

  let synced = 0
  for (const lead of leads ?? []) {
    if (!isCanonicalDemoUrl(lead.demo_url)) {
      report.errors.push(`auto-send ${lead.id}: demo URL is not a canonical public URL`)
      continue
    }
    try {
      await syncAutoSendLead(supabase, lead, lead.demo_url)
      synced++
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : String(syncError)
      report.errors.push(`auto-send sync ${lead.id}: ${message}`)
      await supabase.from('site_leads').update({
        feedback: `Auto-send sync failed: ${message.slice(0, 350)}`,
      }).eq('id', lead.id)
    }
  }
  return synced
}

async function syncAutoSendLead(
  supabase: ReturnType<typeof createClient>,
  lead: any,
  demoUrl: string,
): Promise<'enrolled' | 'held_for_review'> {
  const email = String(lead.email ?? '').trim().toLowerCase()
  if (!email) throw new Error('lead has no email')

  const identity = verifyLeadEmailIdentity(lead)
  if (!identity.ok) {
    await holdLeadForOutreachReview(supabase, lead, identity.reason ?? 'The contact identity could not be verified.')
    return 'held_for_review'
  }

  // Demo outreach is a different sequence from audit-only outreach. Do not
  // turn a successfully generated demo into a second cold approach merely
  // because the same address happened to be imported twice.
  const { data: priorSends, error: priorSendsError } = await supabase
    .from('sent_emails')
    .select('id')
    .eq('user_id', lead.user_id)
    .ilike('recipient_email', email)
    .in('status', ['queued', 'sent', 'bounced', 'complained', 'unsubscribed'])
    .limit(1)
  if (priorSendsError) throw new Error(`prior outreach lookup: ${priorSendsError.message}`)
  if (priorSends?.length) {
    await holdLeadForOutreachReview(supabase, lead, 'This address was already contacted by another outreach sequence.')
    return 'held_for_review'
  }

  const language = lead.language === 'en' ? 'en' : 'sv'
  const sequenceName = language === 'en' ? 'Site Demo Outreach EN' : 'Site Demo Outreach'
  const { data: sequences, error: sequenceError } = await supabase
    .from('sequences')
    .select('id, contact_list_id')
    .eq('user_id', lead.user_id)
    .eq('name', sequenceName)
    .limit(1)
  if (sequenceError) throw new Error(`sequence lookup: ${sequenceError.message}`)
  const sequence = sequences?.[0]
  if (!sequence?.id || !sequence.contact_list_id) throw new Error(`${sequenceName} is missing or has no contact list`)

  const { data: entryNodes, error: triggerError } = await supabase
    .from('sequence_nodes')
    .select('id, node_type, position_y')
    .eq('sequence_id', sequence.id)
    .in('node_type', ['trigger', 'send_email'])
    .order('position_y', { ascending: true })
  if (triggerError) throw new Error(`trigger lookup: ${triggerError.message}`)
  const triggerId = entryNodes?.find((node: any) => node.node_type === 'trigger')?.id
  if (!triggerId) throw new Error(`${sequenceName} has no trigger node`)
  const firstSendId = entryNodes?.find((node: any) => node.node_type === 'send_email')?.id
  const entryNodeId = insideSendWindow() && firstSendId ? firstSendId : triggerId

  const weakness = lead.audit_details?.weaknesses?.[0] ?? lead.audit_reason ?? ''
  const siteFields = {
    site_lead_id: lead.id,
    __site_lead_id: lead.id,
    company_name: lead.company_name,
    company: lead.company_name,
    demo_url: demoUrl,
    website: lead.website ?? '',
    audit_weakness: weakness,
    audit_score: lead.audit_score ?? '',
    category: lead.category ?? '',
    language,
  }

  const { data: contacts, error: contactLookupError } = await supabase
    .from('contacts')
    .select('id, custom_fields')
    .eq('user_id', lead.user_id)
    .eq('list_id', sequence.contact_list_id)
    .ilike('email', email)
    .limit(1)
  if (contactLookupError) throw new Error(`contact lookup: ${contactLookupError.message}`)

  let contactId = contacts?.[0]?.id
  if (contactId) {
    const { error: updateError } = await supabase.from('contacts').update({
      custom_fields: { ...(contacts?.[0]?.custom_fields ?? {}), ...siteFields },
      demo_site_url: demoUrl,
      phone: lead.phone ?? null,
    }).eq('id', contactId)
    if (updateError) throw new Error(`contact update: ${updateError.message}`)
  } else {
    const firstName = email.split('@')[0].split(/[._-]/)[0].replace(/^\w/, (char: string) => char.toUpperCase())
    const { data: inserted, error: insertError } = await supabase.from('contacts').insert({
      user_id: lead.user_id,
      list_id: sequence.contact_list_id,
      email,
      first_name: firstName,
      phone: lead.phone ?? null,
      demo_site_url: demoUrl,
      custom_fields: siteFields,
      tags: ['site-demo'],
    }).select('id').single()
    if (insertError) throw new Error(`contact create: ${insertError.message}`)
    contactId = inserted.id
  }

  const { data: enrollments, error: enrollmentLookupError } = await supabase
    .from('enrollments')
    .select('id, status, current_step, last_sent_at')
    .eq('user_id', lead.user_id)
    .eq('sequence_id', sequence.id)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (enrollmentLookupError) throw new Error(`enrollment lookup: ${enrollmentLookupError.message}`)

  const existing = enrollments?.[0]
  if (!existing) {
    const { error: enrollmentError } = await supabase.from('enrollments').insert({
      user_id: lead.user_id,
      sequence_id: sequence.id,
      contact_id: contactId,
      status: 'active',
      current_node_id: entryNodeId,
      current_step: 0,
      next_send_at: new Date().toISOString(),
    })
    if (enrollmentError) throw new Error(`enrollment create: ${enrollmentError.message}`)
  } else if (!existing.last_sent_at && Number(existing.current_step ?? 0) === 0 && existing.status !== 'active') {
    // A pre-send failed/deferred enrollment is safe to resume. Never rewind an
    // enrollment that has already sent mail, which would create duplicates.
    const { error: resumeError } = await supabase.from('enrollments').update({
      status: 'active',
      current_node_id: entryNodeId,
      current_step: 0,
      next_send_at: new Date().toISOString(),
      last_error: null,
      error_at: null,
    }).eq('id', existing.id)
    if (resumeError) throw new Error(`enrollment resume: ${resumeError.message}`)
  }

  const { error: leadError } = await supabase.from('site_leads').update({
    status: 'auto_approved',
    demo_url: demoUrl,
    approved_at: new Date().toISOString(),
    feedback: null,
  }).eq('id', lead.id)
  if (leadError) throw new Error(`lead finalize: ${leadError.message}`)
  return 'enrolled'
}

async function syncAuditOnlyLead(
  supabase: ReturnType<typeof createClient>,
  lead: any,
): Promise<'enrolled' | 'already_contacted' | 'held_for_review'> {
  const email = String(lead.email ?? '').trim().toLowerCase()
  if (!email) throw new Error('lead has no email')
  if (lead.language !== 'en') throw new Error('audit-only outreach accepts English leads only')

  const identity = verifyLeadEmailIdentity(lead)
  if (!identity.ok) {
    await holdLeadForOutreachReview(supabase, lead, identity.reason ?? 'The contact identity could not be verified.')
    return 'held_for_review'
  }
  const observation = selectConcreteAuditObservation(lead)
  if (!observation) {
    await holdLeadForOutreachReview(
      supabase,
      lead,
      'The audit did not contain one concrete, customer-visible website observation.',
    )
    return 'held_for_review'
  }

  const { data: sequences, error: sequenceError } = await supabase
    .from('sequences')
    .select('id, contact_list_id')
    .eq('user_id', lead.user_id)
    .eq('name', ENGLISH_AUDIT_SEQUENCE)
    .limit(1)
  if (sequenceError) throw new Error(`sequence lookup: ${sequenceError.message}`)
  const sequence = sequences?.[0]
  if (!sequence?.id || !sequence.contact_list_id) throw new Error(`${ENGLISH_AUDIT_SEQUENCE} is missing or has no contact list`)

  const { data: entryNodes, error: triggerError } = await supabase
    .from('sequence_nodes')
    .select('id, node_type, position_y')
    .eq('sequence_id', sequence.id)
    .in('node_type', ['trigger', 'send_email'])
    .order('position_y', { ascending: true })
  if (triggerError) throw new Error(`trigger lookup: ${triggerError.message}`)
  const triggerId = entryNodes?.find((node: any) => node.node_type === 'trigger')?.id
  if (!triggerId) throw new Error(`${ENGLISH_AUDIT_SEQUENCE} has no trigger node`)
  const firstSendId = entryNodes?.find((node: any) => node.node_type === 'send_email')?.id
  const entryNodeId = insideSendWindow() && firstSendId ? firstSendId : triggerId

  // Cross-sequence safety: once an address has actually been contacted by
  // this account, do not quietly enroll it into a second sales sequence.
  const { data: priorSends, error: sendLookupError } = await supabase
    .from('sent_emails')
    .select('id, sent_at')
    .eq('user_id', lead.user_id)
    .ilike('recipient_email', email)
    .in('status', ['queued', 'sent', 'bounced', 'complained', 'unsubscribed'])
    .order('sent_at', { ascending: false })
    .limit(1)
  if (sendLookupError) throw new Error(`prior outreach lookup: ${sendLookupError.message}`)
  if (priorSends?.length) {
    await supabase.from('site_leads').update({
      status: 'auto_approved',
      auto_send: false,
      approved_at: new Date().toISOString(),
      last_email_sent_at: priorSends[0].sent_at,
      feedback: 'Audit outreach skipped: this address was already contacted by another sequence.',
    }).eq('id', lead.id)
    return 'already_contacted'
  }

  const customFields = {
    site_lead_id: lead.id,
    __site_lead_id: lead.id,
    outreach_kind: 'audit_only',
    company_name: lead.company_name,
    company: lead.company_name,
    website: lead.website ?? '',
    // Never let a vague cosmetic score become email copy. The only observation
    // supplied to this sequence has passed the concrete-evidence gate above.
    audit_outreach_observation: observation,
    audit_weakness: observation,
    audit_weakness_2: '',
    audit_weakness_3: '',
    audit_score: lead.audit_score ?? '',
    audit_confidence: lead.audit_details?.confidence ?? '',
    category: lead.category ?? '',
    language: 'en',
  }

  const { data: allContacts, error: allContactsError } = await supabase
    .from('contacts')
    .select('id, list_id, custom_fields')
    .eq('user_id', lead.user_id)
    .ilike('email', email)
  if (allContactsError) throw new Error(`contact lookup: ${allContactsError.message}`)

  const contactIds = (allContacts ?? []).map((contact: any) => contact.id)
  if (contactIds.length) {
    const { data: otherEnrollments, error: otherEnrollmentError } = await supabase
      .from('enrollments')
      .select('id, sequence_id, status, last_sent_at')
      .eq('user_id', lead.user_id)
      .in('contact_id', contactIds)
      .neq('sequence_id', sequence.id)
      .in('status', ['active', 'waiting_capacity', 'deferred', 'paused', 'completed', 'stopped', 'unsubscribed'])
      .limit(1)
    if (otherEnrollmentError) throw new Error(`cross-sequence enrollment lookup: ${otherEnrollmentError.message}`)
    if (otherEnrollments?.length) {
      await supabase.from('site_leads').update({
        status: 'auto_approved',
        auto_send: false,
        approved_at: new Date().toISOString(),
        feedback: 'Audit outreach skipped: this address already belongs to another outreach sequence.',
      }).eq('id', lead.id)
      return 'already_contacted'
    }
  }

  const existing = (allContacts ?? []).find((contact: any) => contact.list_id === sequence.contact_list_id)
  let contactId = existing?.id as string | undefined
  if (contactId) {
    const { error: updateError } = await supabase.from('contacts').update({
      custom_fields: { ...(existing.custom_fields ?? {}), ...customFields },
      demo_site_url: null,
      phone: lead.phone ?? null,
      tags: ['site-audit', 'english-outreach'],
    }).eq('id', contactId)
    if (updateError) throw new Error(`contact update: ${updateError.message}`)
  } else {
    const firstName = email.split('@')[0].split(/[._-]/)[0].replace(/^\w/, (char: string) => char.toUpperCase())
    const { data: inserted, error: insertError } = await supabase.from('contacts').insert({
      user_id: lead.user_id,
      list_id: sequence.contact_list_id,
      email,
      first_name: firstName,
      phone: lead.phone ?? null,
      demo_site_url: null,
      custom_fields: customFields,
      tags: ['site-audit', 'english-outreach'],
    }).select('id').single()
    if (insertError) throw new Error(`contact create: ${insertError.message}`)
    contactId = inserted.id
  }

  const { data: enrollments, error: enrollmentLookupError } = await supabase
    .from('enrollments')
    .select('id, status, current_step, last_sent_at')
    .eq('user_id', lead.user_id)
    .eq('sequence_id', sequence.id)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (enrollmentLookupError) throw new Error(`enrollment lookup: ${enrollmentLookupError.message}`)

  const existingEnrollment = enrollments?.[0]
  if (!existingEnrollment) {
    const { error: enrollmentError } = await supabase.from('enrollments').insert({
      user_id: lead.user_id,
      sequence_id: sequence.id,
      contact_id: contactId,
      status: 'active',
      current_node_id: entryNodeId,
      current_step: 0,
      next_send_at: new Date().toISOString(),
    })
    if (enrollmentError) throw new Error(`enrollment create: ${enrollmentError.message}`)
  } else if (!existingEnrollment.last_sent_at && Number(existingEnrollment.current_step ?? 0) === 0) {
    const { error: resumeError } = await supabase.from('enrollments').update({
      status: 'active',
      current_node_id: entryNodeId,
      current_step: 0,
      next_send_at: new Date().toISOString(),
      last_error: null,
      error_at: null,
    }).eq('id', existingEnrollment.id)
    if (resumeError) throw new Error(`enrollment resume: ${resumeError.message}`)
  }

  const { error: leadError } = await supabase.from('site_leads').update({
    status: 'auto_approved',
    auto_send: true,
    approved_at: new Date().toISOString(),
    feedback: null,
  }).eq('id', lead.id)
  if (leadError) throw new Error(`lead finalize: ${leadError.message}`)
  return 'enrolled'
}

async function syncPendingAuditOnlyLeads(
  supabase: ReturnType<typeof createClient>,
  settings: EnglishOutreachSettings,
  report: { errors: string[] },
): Promise<number> {
  const { data, error } = await supabase
    .from('site_leads')
    .select('id, user_id, company_name, website, email, phone, category, language, audit_score, audit_reason, audit_details, auto_send, last_email_sent_at')
    .eq('language', 'en')
    .in('status', ['awaiting_audit_approval', 'needs_triage', 'needs_site', 'auto_approved'])
    .eq('auto_send', true)
    .is('last_email_sent_at', null)
    .not('email', 'is', null)
    .gte('audit_score', 1)
    .lte('audit_score', settings.max_audit_score)
    .order('updated_at', { ascending: true })
    .limit(25)
  if (error) {
    report.errors.push(`load pending audit outreach: ${error.message}`)
    return 0
  }

  let synced = 0
  for (const lead of data ?? []) {
    const details = lead.audit_details && typeof lead.audit_details === 'object'
      ? lead.audit_details as Record<string, any>
      : {}
    // A held row needs an operator decision, not another write attempt every
    // ten minutes. This also avoids needless database I/O while the campaign
    // is intentionally paused for review.
    if (details.outreach_sync_state === 'held') continue
    const evidence = details.evidence && typeof details.evidence === 'object'
      ? details.evidence as Record<string, any>
      : {}
    const reliable = details.uncertain !== true
      && details.confidence !== 'low'
      && evidence.unreadable !== true
      && evidence.screenshot_reliable === true
    if (details.excluded_ecommerce === true || (settings.require_reliable_audit && !reliable)) continue
    try {
      await syncAuditOnlyLead(supabase, lead)
      synced++
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : String(syncError)
      report.errors.push(`audit outreach sync ${lead.id}: ${message}`)
      await supabase.from('site_leads').update({
        status: 'awaiting_audit_approval',
        feedback: `Audit outreach sync failed: ${message.slice(0, 350)}`,
      }).eq('id', lead.id)
    }
  }
  return synced
}

// ---------------------------------------------------------------------------
// AUDIT — one shared screenshot-first evaluator for every audit entry point.
// Scores 7–10 are automatically parked as good enough. English audit_only
// sends scored 1–6 leads with a usable contact into its audit sequence; the
// demo pipeline retains its existing 1–4 auto-build policy. E-commerce and
// leads with no contact remain excluded rather than being enrolled.
// ---------------------------------------------------------------------------
async function auditOne(
  supabase: ReturnType<typeof createClient>,
  row: {
    id: string
    website: string
    company_name: string
    user_id?: string | null
    email?: string | null
    phone?: string | null
    category?: string | null
    language?: string | null
    audit_details?: Record<string, any> | null
  },
  englishOutreach: EnglishOutreachSettings,
  scrapeProvider: ScrapeProvider,
  auditEngine: SiteAuditEngine,
) {
  await supabase.from('site_leads').update({ status: 'auditing' }).eq('id', row.id)

  try {
    const language = row.language === 'en' ? 'en' : 'sv'
    const result = auditEngine === 'jev'
      ? await auditWebsiteWithJev({
          url: row.website,
          companyName: row.company_name,
          language,
          category: row.category ?? null,
          email: row.email ?? null,
          phone: row.phone ?? null,
          supabase,
          scrapeProvider,
        })
      : await auditWebsite(
          row.website,
          row.company_name,
          language,
          supabase,
          scrapeProvider,
        )
    if (auditEngine === 'jev') {
      console.log(`jev audit decision ${row.id}: ${result.decisionLabel ?? 'unknown'} confidence=${result.decisionConfidence ?? 'n/a'} score=${result.score}`)
    }
    // E-commerce with a real cart and checkout is outside the product scope,
    // so it is always parked. The audit model is explicitly told not to mark
    // bookings, menus, catalogues or enquiry forms as e-commerce.
    const automaticallyExcludedEcommerce = result.isEcommerce
    // Swedish audit decisions use evidence, not a bare score: a dated or
    // generic site is parked, verified broken/no-site evidence builds, and
    // only genuinely contradictory/uncertain cases reach manual review.
    const jevConfident = auditEngine === 'jev' && result.confidence === 'high' && !result.uncertain
    const swedishDisposition = auditEngine === 'jev'
      ? {
          disposition: result.isEcommerce || result.score >= AUDIT_AUTO_PARK_SCORE
            ? 'site_good_enough'
            : jevConfident && result.score <= 4
              ? 'needs_site'
              : 'manual_review',
          reason: result.reason,
        } as const
      : classifyAuditDisposition(result)
    const automaticBuildCandidate = auditEngine === 'jev'
      ? jevConfident && !result.isEcommerce && result.score <= 4
      : swedishDisposition.disposition === 'needs_site'
    const isEnglishAuditOnly = row.language === 'en' && englishOutreach.mode === 'audit_only'
    const reliableForAuditOutreach = result.confidence !== 'low'
      && (auditEngine === 'jev' ? jevConfident : result.screenshotReliable)
      && !result.unreadable
      && !result.uncertain
    const auditOutreachObservation = selectConcreteAuditObservation({ audit_details: { structural: result.structural } })
    const contactIdentity = verifyLeadEmailIdentity(row)
    const auditOnlyEligible = auditEngine !== 'jev'
      && isEnglishAuditOnly
      && Boolean(row.email)
      && !automaticallyExcludedEcommerce
      && result.score >= 1
      && result.score <= englishOutreach.max_audit_score
      && Boolean(auditOutreachObservation)
      && contactIdentity.ok
      && (!englishOutreach.require_reliable_audit || reliableForAuditOutreach)
    // E-commerce is outside the offer even when its visual score is low.
    const automaticallyNeedsSite = (auditEngine === 'jev' || !isEnglishAuditOnly)
      && !automaticallyExcludedEcommerce
      && automaticBuildCandidate
    const recommendedStatus = auditEngine === 'jev'
      ? (automaticallyExcludedEcommerce
        ? 'site_good_enough'
        : !jevConfident
          ? 'awaiting_audit_approval'
          : result.score <= 4
            ? 'needs_site'
            : result.score >= AUDIT_AUTO_PARK_SCORE
              ? 'site_good_enough'
              : 'awaiting_audit_approval')
      : automaticallyExcludedEcommerce
      ? 'site_good_enough'
      : row.language === 'en'
        ? (result.score >= AUDIT_AUTO_PARK_SCORE ? 'site_good_enough' : 'needs_site')
        : swedishDisposition.disposition === 'site_good_enough'
          ? 'site_good_enough'
          : 'needs_site'
    const nextStatus = automaticallyExcludedEcommerce
      ? 'site_good_enough'
      : auditOnlyEligible
      ? 'awaiting_audit_approval'
      : automaticallyNeedsSite
      ? 'needs_site'
      : recommendedStatus === 'site_good_enough'
      ? 'site_good_enough'
      : 'awaiting_audit_approval'
    const auditedAt = new Date().toISOString()
    // Do not persist large inline screenshot data. Provider-hosted screenshot
    // URLs are useful evidence; base64 payloads would create avoidable DB I/O.
    const screenshotEvidence = result.screenshot?.startsWith('http')
      ? result.screenshot.slice(0, 2000)
      : null

    const { error: updateError } = await supabase.from('site_leads').update({
      status: nextStatus,
      audit_score: result.score,
      audit_reason: result.reason,
      audit_details: {
        audited_at: auditedAt,
        rubric_version: auditEngine === 'jev' ? 'jev_visual_calibration_v2' : 'screenshot_consensus_v4',
        audit_engine: auditEngine,
        weaknesses: result.weaknesses,
        structural: result.structural,
        cosmetic: result.cosmetic,
        recommended_status: automaticallyExcludedEcommerce
          ? 'site_good_enough'
          : automaticallyNeedsSite ? 'needs_site' : recommendedStatus,
        automated_disposition: auditEngine === 'jev'
          ? swedishDisposition.disposition
          : row.language === 'en'
          ? null
          : swedishDisposition.disposition,
        automated_disposition_reason: auditEngine === 'jev'
          ? swedishDisposition.reason
          : row.language === 'en'
          ? null
          : swedishDisposition.reason,
        website_presence: result.websitePresence,
        excluded_ecommerce: automaticallyExcludedEcommerce,
        auto_qualified_for_build: automaticallyNeedsSite,
        auto_qualified_for_audit_outreach: auditOnlyEligible,
        audit_outreach_observation: auditOutreachObservation,
        audit_outreach_identity_verified: contactIdentity.ok,
        audit_outreach_hold_reason: !contactIdentity.ok
          ? contactIdentity.reason
          : isEnglishAuditOnly && !auditOutreachObservation
            ? 'No concrete customer-visible website observation was found.'
            : null,
        auto_qualified_low_score: automaticBuildCandidate && result.score <= 4,
        uncertain: result.uncertain,
        confidence: result.confidence,
        jev_confidence: auditEngine === 'jev' ? result.decisionConfidence ?? null : null,
        jev_decision: auditEngine === 'jev' ? result.decisionLabel ?? null : null,
        ...(auditEngine === 'jev' ? (result.auditDiagnostics ?? {}) : {}),
        ...(nextStatus === 'awaiting_audit_approval'
          ? {}
          : {
              operator_decision: auditOnlyEligible
                ? 'audit_outreach'
                : automaticallyNeedsSite && !automaticallyExcludedEcommerce ? 'build' : 'site_good_enough',
              operator_decision_source: 'automation',
              operator_decided_at: auditedAt,
            }),
        evidence: {
          rubric_version: auditEngine === 'jev' ? 'jev_visual_calibration_v2' : 'screenshot_consensus_v4',
          audit_engine: auditEngine,
          screenshot_used: Boolean(result.screenshot),
          screenshot_reliable: result.screenshotReliable,
          unreadable: result.unreadable,
          screenshot_quality: result.screenshotQuality,
          screenshot: screenshotEvidence,
          scraped_text_characters: result.markdown.length,
          scrape_provider: result.providerUsed,
          first_model: result.modelUsed,
          decision_confidence: result.decisionConfidence ?? null,
          decision_label: result.decisionLabel ?? null,
          first_score: result.firstScore,
          second_opinion_used: result.secondOpinionUsed,
          second_provider: result.secondProviderUsed,
          second_model: result.secondModelUsed,
          second_score: result.secondScore,
          score_disagreement: result.scoreDisagreement,
          second_opinion_error: result.secondOpinionError,
          supplementary_page_url: result.supplementaryPageUrl,
          supplementary_page_screenshot_reliable: result.supplementaryPageScreenshotReliable,
          supplementary_page_scrape_provider: result.supplementaryPageProviderUsed,
        },
      },
      ...(recommendedStatus === 'site_good_enough' && !automaticallyNeedsSite
        ? { auto_send: false, triaged_at: auditedAt }
        : auditOnlyEligible
          ? { auto_send: true, triaged_at: auditedAt }
        : automaticallyNeedsSite
          ? {
              auto_send: Boolean(row.email),
              triaged_at: auditedAt,
            }
        : {}),
    }).eq('id', row.id)
    if (updateError) throw new Error(`save audit: ${updateError.message}`)
    if (result.scrapeCache) {
      const { error: cacheError } = await supabase.from('site_scrape_cache').upsert({
        site_lead_id: row.id,
        url: result.url,
        payload: result.scrapeCache,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      }, { onConflict: 'site_lead_id' })
      if (cacheError) console.warn(`audit scrape cache unavailable for ${row.id}: ${cacheError.message}`)
    }
    if (auditOnlyEligible) {
      const { data: savedLead, error: savedLeadError } = await supabase
        .from('site_leads')
        .select('id, user_id, company_name, website, email, phone, category, language, audit_score, audit_reason, audit_details')
        .eq('id', row.id)
        .single()
      if (savedLeadError) throw new Error(`load audited lead for outreach: ${savedLeadError.message}`)
      try {
        await syncAuditOnlyLead(supabase, savedLead)
      } catch (syncError) {
        const message = syncError instanceof Error ? syncError.message : String(syncError)
        await supabase.from('site_leads').update({
          status: 'awaiting_audit_approval',
          feedback: `Audit outreach sync failed: ${message.slice(0, 350)}`,
        }).eq('id', row.id)
        // The audit itself succeeded. Do not reset this lead to pending_audit
        // and pay to scrape/score it again merely because enrollment failed.
        console.error(`audit outreach sync ${row.id}: ${message}`)
      }
    }
    return
  } catch (error) {
    const typed = error instanceof ScraperError ? error : null
    if (!typed) {
      // AI/provider and persistence failures are not website verdicts. Leave
      // the lead retryable briefly, then hold it for manual review instead of
      // burning screenshot + model calls every scheduled tick.
      const previousDetails = row.audit_details && typeof row.audit_details === 'object'
        ? row.audit_details
        : {}
      const retryCount = Math.max(0, Number(previousDetails.audit_retry_count) || 0) + 1
      const message = error instanceof Error ? error.message : String(error)
      const retryDetails = {
        ...previousDetails,
        audit_retry_count: retryCount,
        last_audit_error: message.slice(0, 500),
        last_audit_error_at: new Date().toISOString(),
      }
      if (retryCount >= AUDIT_AI_RETRY_LIMIT) {
        const reason = row.language === 'en'
          ? 'The audit provider failed repeatedly and this lead needs a manual check.'
          : 'Auditmodellen misslyckades upprepade gånger och leadet behöver kontrolleras manuellt.'
        await supabase.from('site_leads').update({
          status: 'awaiting_audit_approval',
          auto_send: false,
          audit_score: 5,
          audit_reason: reason,
          audit_details: {
            ...retryDetails,
            weaknesses: [reason],
            structural: [],
            cosmetic: [],
            recommended_status: 'needs_site',
            uncertain: true,
            confidence: 'low',
            evidence: {
              ...(previousDetails.evidence && typeof previousDetails.evidence === 'object' ? previousDetails.evidence : {}),
              rubric_version: 'screenshot_consensus_v4',
              screenshot_used: false,
              audit_retry_limit_reached: true,
            },
          },
        }).eq('id', row.id)
      } else {
        await supabase.from('site_leads').update({
          status: 'pending_audit',
          audit_details: retryDetails,
        }).eq('id', row.id)
      }
      throw error
    }
    const providerFailure = typed && (
      typed.retryable || typed.status === 0 || typed.status === 401 ||
      typed.status === 402 || typed.status === 403 || typed.status === 429 || typed.status >= 500
    )
    if (providerFailure) {
      await recordPipelineFailure(supabase, {
        provider: typed.provider,
        sourceFunction: 'process-site-leads:audit',
        message: typed.message,
        httpStatus: typed.status,
        siteLeadId: row.id,
      })
      await supabase.from('site_leads').update({ status: 'pending_audit' }).eq('id', row.id)
      throw new Error(`${typed.provider} provider error (${typed.status}): ${typed.message}`)
    }
    // A target-specific failure is not proof of a bad website. Put a neutral,
    // explicitly uncertain result in manual review instead of auto-building.
    const reason = row.language === 'en'
      ? 'The website could not be inspected reliably and needs a manual check.'
      : 'Webbplatsen kunde inte granskas tillförlitligt och behöver kontrolleras manuellt.'
    await supabase.from('site_leads').update({
      status: 'awaiting_audit_approval',
      audit_score: 5,
      audit_reason: reason,
      audit_details: {
        weaknesses: [reason],
        structural: [],
        cosmetic: [],
        recommended_status: 'needs_site',
        uncertain: true,
        confidence: 'low',
        evidence: { rubric_version: 'screenshot_consensus_v3', screenshot_used: false },
      },
    }).eq('id', row.id)
    return
  }
}

// Repair untouched low-score rows produced immediately before this policy was
// deployed. Only rows with a recorded reliable screenshot qualify; old audits
// with missing/failed visual evidence stay in the manual queue.
async function advanceReliableLowQualityAudits(
  supabase: ReturnType<typeof createClient>,
  englishOutreach: EnglishOutreachSettings,
  report: { errors: string[] },
): Promise<number> {
  const { data, error } = await supabase
    .from('site_leads')
    .select('id, email, language, audit_details')
    .in('status', ['awaiting_audit_approval', 'needs_triage'])
    .lte('audit_score', 4)
    .limit(100)

  if (error) {
    report.errors.push(`auto-qualify low-score audits: ${error.message}`)
    return 0
  }

  let advanced = 0
  for (const row of data ?? []) {
    // English audit-only leads are handled by syncPendingAuditOnlyLeads and
    // must never be moved into the website generation queue.
    if (row.language === 'en' && englishOutreach.mode !== 'demo_sites') continue
    const details = row.audit_details && typeof row.audit_details === 'object'
      ? row.audit_details as Record<string, any>
      : {}
    const evidence = details.evidence && typeof details.evidence === 'object'
      ? details.evidence as Record<string, any>
      : {}
    if (details.excluded_ecommerce === true
      || evidence.screenshot_reliable !== true
      || evidence.unreadable === true) continue

    const decidedAt = new Date().toISOString()
    const { data: updated, error: updateError } = await supabase.from('site_leads').update({
      status: 'needs_site',
      auto_send: Boolean(row.email),
      triaged_at: decidedAt,
      audit_details: {
        ...details,
        recommended_status: 'needs_site',
        auto_qualified_for_build: true,
        auto_qualified_low_score: true,
        operator_decision: 'build',
        operator_decision_source: 'automation',
        operator_decided_at: decidedAt,
      },
    })
      .eq('id', row.id)
      .in('status', ['awaiting_audit_approval', 'needs_triage'])
      .select('id')

    if (updateError) report.errors.push(`auto-qualify audit ${row.id}: ${updateError.message}`)
    else advanced += updated?.length ?? 0
  }
  return advanced
}

// The policy is score 7–10 = existing site is good enough. Older versions
// placed a score of exactly 7 into a manual queue, so normal ticks repair
// those untouched rows without any destructive bulk migration.
async function parkHighQualityAudits(
  supabase: ReturnType<typeof createClient>,
  report: { errors: string[] },
): Promise<number> {
  const { data, error } = await supabase
    .from('site_leads')
    .update({
      status: 'site_good_enough',
      auto_send: false,
      triaged_at: new Date().toISOString(),
    })
    .in('status', ['awaiting_audit_approval', 'needs_triage'])
    .gte('audit_score', AUDIT_AUTO_PARK_SCORE)
    .select('id')

  if (error) {
    report.errors.push(`auto-park high-quality audits: ${error.message}`)
    return 0
  }
  return data?.length ?? 0
}

type SiteAuditEngine = 'current' | 'jev'
let cachedAuditEngine: { value: SiteAuditEngine; expiresAt: number } | null = null
async function resolveSiteAuditEngine(
  supabase: ReturnType<typeof createClient>,
): Promise<SiteAuditEngine> {
  const envMode = Deno.env.get('SITE_AUDIT_ENGINE')
  if (envMode === 'jev' || envMode === 'current') return envMode
  if (cachedAuditEngine && cachedAuditEngine.expiresAt > Date.now()) return cachedAuditEngine.value
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'site_audit_engine')
    .maybeSingle()
  if (error) {
    console.warn(`site_audit_engine read failed; keeping current audit: ${error.message}`)
    cachedAuditEngine = { value: 'current', expiresAt: Date.now() + 10_000 }
    return cachedAuditEngine.value
  }
  cachedAuditEngine = {
    value: (data?.value as any)?.engine === 'jev' ? 'jev' : 'current',
    expiresAt: Date.now() + 30_000,
  }
  return cachedAuditEngine.value
}

// ---------------------------------------------------------------------------
// Which site engine new jobs use. Controlled from /site-leads via
// app_settings.site_generation_mode ('template' = current template engine,
// 'freeform' = AI builds the whole site). Env var is a hard override.
let cachedGenerationMode: 'template' | 'freeform' | null = null
async function resolveGenerationMode(
  supabase: ReturnType<typeof createClient>,
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

async function chooseTemplateFamilyForLead(supabase: ReturnType<typeof createClient>, lead: any): Promise<{
  family: BlockTemplateFamily
  source: 'ai' | 'rules'
  reason?: string
  confidence: number
  matchedBy: string
  classifierVersion: number
}> {
  const fallback = selectBlockTemplateFamilyDecision({
    category: lead?.category ?? null,
    niche: lead?.niche ?? null,
    businessName: lead?.company_name ?? null,
  })
  // Exact uploaded categories are safer and faster than an LLM. Only ask AI
  // when the deterministic classifier is genuinely unsure.
  if (fallback.confidence >= .9) {
    return {
      family: fallback.family,
      source: 'rules',
      reason: `High-confidence ${fallback.matchedBy} match${fallback.matchedTerm ? `: ${fallback.matchedTerm}` : ''}`,
      confidence: fallback.confidence,
      matchedBy: fallback.matchedBy,
      classifierVersion: fallback.classifierVersion,
    }
  }
  const familyCatalog = blockTemplateFamilyCatalog()
  try {
    const routed = await callRoutedChat({
      supabase,
      nvidiaModel: TEMPLATE_PICKER_NVIDIA_MODEL,
      openrouterModel: TEMPLATE_PICKER_OPENROUTER_FALLBACK,
      preferredProvider: 'nvidia',
      nvidiaAttempts: 2,
      // Rule-based family selection is deliberately the safe fallback. Do
      // not spend a paid model call merely because the NVIDIA picker is busy.
      allowOpenRouterFallback: false,
      title: 'Botlio Template Picker Fallback',
      timeoutMs: 25_000,
      requireJsonObject: true,
      body: {
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
      },
    })
    const content = routed.data?.choices?.[0]?.message?.content
    const raw = Array.isArray(content)
      ? content.map((part: any) => part?.text || '').join('')
      : String(content ?? '{}')
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned) as { templateFamily?: string; reason?: string; confidence?: number }
    const key = parsed?.templateFamily
    if (!key || !(key in BLOCK_TEMPLATE_FAMILIES)) {
      return {
        family: fallback.family,
        source: 'rules',
        reason: 'AI picker returned unknown family',
        confidence: fallback.confidence,
        matchedBy: fallback.matchedBy,
        classifierVersion: fallback.classifierVersion,
      }
    }
    const aiConfidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? .7)))
    return {
      family: BLOCK_TEMPLATE_FAMILIES[key as BlockTemplateFamilyKey],
      source: 'ai',
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 240) : undefined,
      confidence: Number.isFinite(aiConfidence) ? aiConfidence : .7,
      matchedBy: 'ai',
      classifierVersion: fallback.classifierVersion,
    }
  } catch (err) {
    return {
      family: fallback.family,
      source: 'rules',
      reason: `AI picker error: ${(err as Error).message}`,
      confidence: fallback.confidence,
      matchedBy: fallback.matchedBy,
      classifierVersion: fallback.classifierVersion,
    }
  }
}

// GENERATE — creates synthetic contact + generated_sites row, kicks off
// scrape-lead-data. The reconciler above then walks the pipeline forward.
// ---------------------------------------------------------------------------
async function startGeneration(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  lead: any,
) {
  // Only the chosen scraper should gate this generation. A paused Firecrawl
  // breaker must not stop Botlio-server mode (or the reverse); OpenRouter and
  // Vercel remain shared dependencies for both paths.
  const scrapeProvider = await selectedScrapeProvider(supabase)
  const breakers = await activePipelineBreakers(supabase, [scrapeProvider, 'openrouter', 'vercel'])
  if (breakers.length) throw new Error(`pipeline paused: ${breakers.map((row) => row.provider).join(', ')}`)

  // Resolve the niche up-front: it is used both on the ghost contact and on
  // the generated_sites row (previously declared after first use -> TDZ crash).
  const niche = inferLeadNiche(lead)
  const nicheTemplate = templateForNiche(niche)
  const chosenFamily = await chooseTemplateFamilyForLead(supabase, {
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
          template_family_confidence: chosenFamily.confidence,
          template_family_matched_by: chosenFamily.matchedBy,
          template_classifier_version: chosenFamily.classifierVersion,
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
        template_family_confidence: chosenFamily.confidence,
        template_family_matched_by: chosenFamily.matchedBy,
        template_classifier_version: chosenFamily.classifierVersion,
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
    try { providerFailure = JSON.parse(body)?.provider === scrapeProvider } catch { /* plain error body */ }
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
