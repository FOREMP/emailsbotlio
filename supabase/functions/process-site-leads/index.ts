// Site-lead outreach orchestrator.
// Runs every 10 min (cron) or on-demand. Three phases per tick:
//   1. RECONCILE — advance in-flight generated_sites through scraped → queued
//      → generated → live, mirror status onto site_leads (awaiting_approval
//      when live, failed when the site pipeline errored).
//   2. AUDIT — for up to AUDIT_PER_TICK pending_audit leads: scrape with
//      Firecrawl, score 1-10 with Gemini, extract 2-3 concrete weaknesses.
//      Scores of 7 or more are automatically parked as site_good_enough; all
//      other results wait for an operator audit decision. An audit must never
//      start a website build by itself.
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
import { selectedScrapeProvider, ScraperError } from '../_shared/scraper-client.ts'
import { auditWebsite } from '../_shared/site-audit.ts'
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

const AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1'

const AUDIT_PER_TICK = 3    // Firecrawl+Gemini per invocation — keep memory low
const GEN_PER_TICK = 6      // how many new pipelines may START per tick
const MAX_CONCURRENT_GEN = 24 // how many leads may be mid-pipeline at once
const DAILY_GEN_CAP_FALLBACK = 16  // used only if we can't read sender limits
const OUTREACH_DOMAINS = ['foremp.email', 'foremp.eu'] as const
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  const report = { reconciled: 0, auto_synced: 0, recovered: 0, audited: 0, auto_parked: 0, generated: 0, capacity: 0, errors: [] as string[] }

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
    // Repair already-live auto-send leads from older deployments. This is
    // intentionally idempotent: a lead/contact can never get two enrollments.
    report.auto_synced = await syncPendingAutoSendLeads(supabase, report)
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
      // Lead sourcing is a separate durable pipeline. Keep its watchdog
      // alive while website generation is paused, or a dead Maps task can
      // hold the sourcing lock forever.
      await invokeFn(supabaseUrl, serviceKey, 'lead-sourcing', { action: 'auto_tick' })
        .catch((error) => report.errors.push(`lead sourcing: ${error.message}`))
      return json({ ok: true, ...report })
    }

    // ---------------- 2. AUDIT --------------------
    const { data: auditRows } = await supabase
      .from('site_leads')
      .select('id, user_id, website, email, company_name, language')
      .eq('status', 'pending_audit')
      .not('website', 'is', null)
      .order('created_at', { ascending: true })
      .limit(AUDIT_PER_TICK)

    for (const row of auditRows ?? []) {
      try {
        await auditOne(supabase, row as any)
        report.audited++
      } catch (e) {
        report.errors.push(`audit ${row.id}: ${(e as Error).message}`)
      }
    }

    // Repair rows scored by the previous threshold. This is deliberately
    // limited to leads still awaiting an audit decision; it never changes a
    // lead that an operator has already chosen to build, review, or send.
    report.auto_parked = await parkHighQualityAudits(supabase, report)

    // ---------------- 3. GENERATE -----------------
    // Daily generation cap = today's outreach send capacity (sum of active
    // sender daily_limits on the outreach domain). Keeps sites-created/day in
    // lockstep with contacts-emailed/day so we never build stock we can't send.
    const { data: dailySenders } = await supabase
      .from('senders')
      .select('daily_limit, from_email')
      .eq('is_active', true)
    const dailyCap = (dailySenders ?? [])
      .filter((r: any) => OUTREACH_DOMAINS.some((domain) => String(r.from_email ?? '').toLowerCase().endsWith(`@${domain}`)))
      .reduce((s: number, r: any) => s + (r.daily_limit ?? 0), 0)
      || DAILY_GEN_CAP_FALLBACK

    // Count builds actually STARTED today. Using site_leads.updated_at made
    // approvals of older leads eat today's quota, starving generation.
    const today = new Date().toISOString().slice(0, 10)
    const { count: doneToday } = await supabase
      .from('generated_sites')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', `${today}T00:00:00Z`)
    const capacity = Math.max(0, dailyCap - (doneToday ?? 0))
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
          .limit(take)

        if (!needsSite?.length) {
          // Nothing to build right now — the tick simply idles and picks up
          // new needs_site leads as soon as the audit phase produces them.
          report.errors.push('idle: no needs_site leads ready')
        }

        for (const lead of needsSite ?? []) {
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
): Promise<void> {
  const email = String(lead.email ?? '').trim().toLowerCase()
  if (!email) throw new Error('lead has no email')

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

  const { data: triggerNodes, error: triggerError } = await supabase
    .from('sequence_nodes')
    .select('id')
    .eq('sequence_id', sequence.id)
    .eq('node_type', 'trigger')
    .limit(1)
  if (triggerError) throw new Error(`trigger lookup: ${triggerError.message}`)
  const triggerId = triggerNodes?.[0]?.id
  if (!triggerId) throw new Error(`${sequenceName} has no trigger node`)

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
      current_node_id: triggerId,
      current_step: 0,
      next_send_at: new Date().toISOString(),
    })
    if (enrollmentError) throw new Error(`enrollment create: ${enrollmentError.message}`)
  } else if (!existing.last_sent_at && Number(existing.current_step ?? 0) === 0 && existing.status !== 'active') {
    // A pre-send failed/deferred enrollment is safe to resume. Never rewind an
    // enrollment that has already sent mail, which would create duplicates.
    const { error: resumeError } = await supabase.from('enrollments').update({
      status: 'active',
      current_node_id: triggerId,
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
}

// ---------------------------------------------------------------------------
// AUDIT — one shared screenshot-first evaluator for every audit entry point.
// Scores 8–10 are automatically parked as good enough. Scores 1–7 remain in
// the operator review queue, so borderline sites are never auto-dismissed.
// ---------------------------------------------------------------------------
async function auditOne(
  supabase: ReturnType<typeof createClient>,
  row: { id: string; website: string; company_name: string; language?: string | null },
) {
  const scrapeProvider = await selectedScrapeProvider(supabase)
  // Vercel is unrelated to auditing and must never block it. AI routing has
  // its own NVIDIA -> OpenRouter fallback, so only the selected scraper's
  // explicit circuit breaker is checked here.
  const breakers = await activePipelineBreakers(supabase, [scrapeProvider])
  if (breakers.length) throw new Error(`pipeline paused: ${breakers.map((breaker) => breaker.provider).join(', ')}`)

  await supabase.from('site_leads').update({ status: 'auditing' }).eq('id', row.id)

  try {
    const result = await auditWebsite(
      row.website,
      row.company_name,
      row.language === 'en' ? 'en' : 'sv',
      supabase,
      scrapeProvider,
    )
    // A 7 is already a good enough existing site. Only scores 1–6 should
    // consume an operator decision and possibly a generated demo.
    const recommendedStatus = result.score >= 7 ? 'site_good_enough' : 'needs_site'
    const nextStatus = recommendedStatus === 'site_good_enough'
      ? 'site_good_enough'
      : 'awaiting_audit_approval'
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
        weaknesses: result.weaknesses,
        structural: result.structural,
        cosmetic: result.cosmetic,
        recommended_status: recommendedStatus,
        uncertain: result.uncertain,
        confidence: result.confidence,
        evidence: {
          rubric_version: 'screenshot_consensus_v3',
          screenshot_used: Boolean(result.screenshot),
          screenshot: screenshotEvidence,
          scraped_text_characters: result.markdown.length,
          scrape_provider: result.providerUsed,
          first_model: result.modelUsed,
          first_score: result.firstScore,
          second_opinion_used: result.secondOpinionUsed,
          second_provider: result.secondProviderUsed,
          second_model: result.secondModelUsed,
          second_score: result.secondScore,
          score_disagreement: result.scoreDisagreement,
          second_opinion_error: result.secondOpinionError,
        },
      },
      ...(recommendedStatus === 'site_good_enough'
        ? { triaged_at: new Date().toISOString() }
        : {}),
    }).eq('id', row.id)
    if (updateError) throw new Error(`save audit: ${updateError.message}`)
    return
  } catch (error) {
    const typed = error instanceof ScraperError ? error : null
    if (!typed) {
      // AI/provider and persistence failures are not website verdicts. Leave
      // the lead retryable instead of saving a fabricated neutral score.
      await supabase.from('site_leads').update({ status: 'pending_audit' }).eq('id', row.id)
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
    .gte('audit_score', 7)
    .select('id')

  if (error) {
    report.errors.push(`auto-park high-quality audits: ${error.message}`)
    return 0
  }
  return data?.length ?? 0
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
