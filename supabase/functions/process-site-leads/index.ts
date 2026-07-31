// Site-lead outreach orchestrator.
// Runs every 10 min (cron) or on-demand. Three phases per tick:
//   1. RECONCILE — advance in-flight generated_sites through scraped → queued
//      → generated → live, mirror status onto site_leads (awaiting_approval
//      when live, failed when the site pipeline errored).
//   2. AUDIT — for up to AUDIT_PER_TICK pending_audit leads: scrape with
//      Firecrawl, score 1-10 with Gemini, extract 2-3 concrete weaknesses.
//      Score ≥ 7 → site_good_enough (no outreach). Else → needs_site.
//   3. GENERATE — enforce daily cap DAILY_GEN_CAP by counting leads that
//      already moved into generating/awaiting_approval/approved today. If
//      capacity is left, take exactly GEN_PER_TICK needs_site leads, create a
//      synthetic contact + generated_sites row and kick scrape-lead-data.
// The whole file uses the service role; cron sends the anon key just so
// pg_net can hit the function endpoint (verify_jwt is off).
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FIRECRAWL_V2 = 'https://api.firecrawl.dev/v2'
const AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1'

const AUDIT_PER_TICK = 3    // Firecrawl+Gemini per invocation — keep memory low
const GEN_PER_TICK = 2      // how many new pipelines may START per tick
const MAX_CONCURRENT_GEN = 3 // how many leads may be mid-pipeline at once
const DAILY_GEN_CAP_FALLBACK = 16  // used only if we can't read sender limits
const OUTREACH_DOMAIN = 'foremp.email'  // sites/day tracks daily send capacity on this domain
const GHOST_LIST_NAME = 'Site Leads (auto)'
const STALE_PIPELINE_MINUTES = 30 // never let one dead scrape/generate/deploy block the whole queue
const ORPHAN_GRACE_MINUTES = 10   // 'generating' with no generated_sites row = dead job

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  const report = { reconciled: 0, recovered: 0, audited: 0, generated: 0, capacity: 0, errors: [] as string[] }

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
        .select('id, user_id, company_name, website, email, phone, address, category, niche, rating, review_snippets, audit_reason, audit_details, feedback')
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


    // ---------------- 2. AUDIT --------------------
    const { data: auditRows } = await supabase
      .from('site_leads')
      .select('id, user_id, website, email, company_name')
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

    // ---------------- 3. GENERATE -----------------
    // Respect the operator on/off switch stored in app_settings.
    const { data: autoRow } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'site_generation_state')
      .maybeSingle()
    const autoState = ((autoRow as any)?.value?.state ?? 'running') as string
    if (autoState !== 'running') {
      report.errors.push(`skip generate: automation is ${autoState}`)
      return json({ ok: true, ...report })
    }

    // Daily generation cap = today's outreach send capacity (sum of active
    // sender daily_limits on the outreach domain). Keeps sites-created/day in
    // lockstep with contacts-emailed/day so we never build stock we can't send.
    const { data: dailySenders } = await supabase
      .from('senders')
      .select('daily_limit')
      .eq('is_active', true)
      .ilike('from_email', `%@${OUTREACH_DOMAIN}`)
    const dailyCap = (dailySenders ?? []).reduce((s: number, r: any) => s + (r.daily_limit ?? 0), 0)
      || DAILY_GEN_CAP_FALLBACK

    const today = new Date().toISOString().slice(0, 10)
    const { count: doneToday } = await supabase
      .from('site_leads')
      .select('id', { count: 'exact', head: true })
      .in('status', ['generating', 'awaiting_approval', 'approved'])
      .gte('updated_at', `${today}T00:00:00Z`)
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
          .select('id, user_id, company_name, website, email, phone, address, category, niche, rating, review_snippets, audit_reason, audit_details, feedback')
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
    .select('id, generated_site_id')
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

    if (gs.status === 'generated') {
      await supabase.from('generated_sites').update({ updated_at: new Date().toISOString() }).eq('id', gs.id)
      await invokeFn(supabaseUrl, serviceKey, 'deploy-site', { generated_site_id: gs.id })
        .catch((e) => report.errors.push(`recover deploy ${gs.id}: ${e.message}`))
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
      status: 'failed',
      error_message: `Stale ${gs.status} job was reset after ${STALE_PIPELINE_MINUTES} minutes so the queue can continue.`,
    }).eq('id', gs.id)

    await supabase.from('site_leads').update({
      status: 'needs_site',
      generated_site_id: null,
    }).eq('id', lead.id)
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
    } else if (gs.status === 'live' && gs.demo_site_url) {
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
// AUDIT — Firecrawl (markdown only) + Gemini (deterministic scoring).
// Also asks for 2-3 concrete weaknesses to reuse in outreach emails later.
// ---------------------------------------------------------------------------
async function auditOne(
  supabase: ReturnType<typeof createClient>,
  row: { id: string; website: string; company_name: string },
) {
  const fcKey = Deno.env.get('FIRECRAWL_API_KEY')
  const lovableKey = Deno.env.get('LOVABLE_API_KEY')
  if (!fcKey || !lovableKey) throw new Error('missing FIRECRAWL_API_KEY or LOVABLE_API_KEY')

  await supabase.from('site_leads').update({ status: 'auditing' }).eq('id', row.id)

  const url = normaliseUrl(row.website)
  let markdown = ''
  let title = ''
  let unreachable = false

  try {
    const fcResp = await fetch(`${FIRECRAWL_V2}/scrape`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fcKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
    })
    const fcData = await fcResp.json()
    if (!fcResp.ok) {
      unreachable = true
    } else {
      markdown = fcData.data?.markdown ?? fcData.markdown ?? ''
      title = fcData.data?.metadata?.title ?? fcData.metadata?.title ?? ''
    }
  } catch (_) {
    unreachable = true
  }

  if (unreachable || !markdown) {
    await supabase.from('site_leads').update({
      status: 'needs_site',
      audit_score: 1,
      audit_reason: unreachable ? 'Could not reach existing website.' : 'Site returned empty content.',
      audit_details: { weaknesses: ['Ingen nåbar eller läsbar hemsida idag.'] },
    }).eq('id', row.id)
    return
  }

  const aiResp = await fetch(`${AI_GATEWAY}/chat/completions`, {
    method: 'POST',
    headers: { 'Lovable-API-Key': lovableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-3-flash-preview',
      temperature: 0,
      top_p: 1,
      seed: 42,
      messages: [
        {
          role: 'system',
          content: [
            'Du auditerar små företags hemsidor och betygsätter dem 1-10 för hur moderna, förtroendeingivande och konverterande de ser ut.',
            'Var STRIKT, KONSEKVENT och DETERMINISTISK — samma input MÅSTE ge samma svar.',
            '',
            'Rubrik för poäng:',
            '  1  = trasig, tom, parkerad domän',
            '  2-3 = extremt föråldrad (pre-2010), ingen mobil, tunt innehåll',
            '  4  = daterad men fungerande, ful typografi/layout',
            '  5  = genomsnittlig småföretagssajt, generisk, tunn hero',
            '  6  = hyfsad modern-ish, tydliga tjänster + kontakt',
            '  7  = klart modern, responsiv, tydlig hierarki, tydliga CTA',
            '  8  = polerad, on-brand, trust signals',
            '  9-10 = förstklassig, inget meningsfullt att förbättra',
            '',
            'Om innehållet är väldigt tunt (<300 tecken riktig copy) — cap 4.',
            '',
            'Svara ENDAST med strikt JSON:',
            '{"score": <heltal 1-10>, "reason": "<max 200 tecken, konkret evidens>", "weaknesses": ["<konkret svaghet 1>", "<konkret svaghet 2>", "<konkret svaghet 3>"]}',
            'Svagheterna ska vara på svenska, konkreta (t.ex. "generisk stock-hero", "ingen mobil-nav", "saknar priser", "gammal design 2015-typ"), och användbara i ett kallmail som argument för varför de behöver ny hemsida.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `URL: ${url}\nFöretag: ${row.company_name}\nTitel: ${title}\n\nInnehåll:\n${markdown.slice(0, 3000)}`,
        },
      ],
      response_format: { type: 'json_object' },
    }),
  })
  const aiData = await aiResp.json()
  if (!aiResp.ok) throw new Error(`AI audit ${aiResp.status}: ${JSON.stringify(aiData).slice(0, 200)}`)

  let parsed: { score: number; reason: string; weaknesses?: string[] } = { score: 5, reason: 'unparsed' }
  try { parsed = JSON.parse(aiData.choices?.[0]?.message?.content ?? '{}') } catch (_) { /* keep default */ }
  const score = Math.max(1, Math.min(10, Math.round(parsed.score)))
  const nextStatus = score >= 7 ? 'site_good_enough' : 'needs_site'

  await supabase.from('site_leads').update({
    status: nextStatus,
    audit_score: score,
    audit_reason: (parsed.reason ?? '').slice(0, 500),
    audit_details: { weaknesses: (parsed.weaknesses ?? []).slice(0, 5) },
  }).eq('id', row.id)
}

// ---------------------------------------------------------------------------
// GENERATE — creates synthetic contact + generated_sites row, kicks off
// scrape-lead-data. The reconciler above then walks the pipeline forward.
// ---------------------------------------------------------------------------
async function startGeneration(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  lead: any,
) {
  // Resolve the niche up-front: it is used both on the ghost contact and on
  // the generated_sites row (previously declared after first use -> TDZ crash).
  const niche = inferLeadNiche(lead)
  const nicheTemplate = ({
    auto_workshop: 'auto_workshop_v1',
    hair_salon: 'hair_salon_v1',
  } as Record<string, string>)[niche]

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
        niche,
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
      template: nicheTemplate,
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
        regen_feedback: lead.feedback ?? null,
        niche,
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
    await supabase.from('site_leads').update({
      status: 'failed',
      feedback: `Scrape failed: ${body.slice(0, 400)}`,
    }).eq('id', lead.id)
    throw new Error(`scrape failed (${scrapeResp.status}): ${body.slice(0, 200)}`)
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

function inferLeadNiche(lead: any): 'auto_workshop' | 'hair_salon' {
  if (lead?.niche === 'hair_salon') return 'hair_salon'
  const text = [lead?.company_name, lead?.category, lead?.niche]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (/hair|hairdresser|hair\s*salon|fris[öo]r|frisörsalong|salong|barber|barbershop|fade|klipp|beauty|sk[öo]nhet|nail|hudv[åa]rd|spa|lashes|brow|laser hair/.test(text)) {
    return 'hair_salon'
  }
  return 'auto_workshop'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
