// Audits an existing website: scrapes it with Firecrawl, then uses AI to score
// quality 1-10. High scores (>= skip_threshold) mean the lead has a decent
// site already — we can skip generation and save cost.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { auditWebsite } from '../_shared/site-audit.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}


interface AuditRequest {
  generated_site_id?: string
  url?: string
  /** Calibration mode: re-score these site_leads WITHOUT writing anything. */
  calibrate_lead_ids?: string[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { generated_site_id, url, calibrate_lead_ids }: AuditRequest = await req.json()

    if (Array.isArray(calibrate_lead_ids) && calibrate_lead_ids.length) {
      return await calibrate(calibrate_lead_ids)
    }

    if (!generated_site_id) {
      return json({ error: 'generated_site_id required' }, 400)
    }


    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Load the row + optional URL fallback from contacts
    const { data: site, error: siteErr } = await supabase
      .from('generated_sites')
      .select('id, contact_id, source_url')
      .eq('id', generated_site_id)
      .single()
    if (siteErr || !site) return json({ error: 'site not found' }, 404)

    let targetUrl = url || site.source_url
    if (!targetUrl) {
      // Try to derive from contact.website / email domain
      const { data: contact } = await supabase
        .from('contacts')
        .select('email, custom_fields')
        .eq('id', site.contact_id)
        .single()
      const cf = (contact?.custom_fields ?? {}) as Record<string, unknown>
      const websiteField = (cf.website ?? cf.url ?? cf.homepage ?? cf.hemsida ?? cf.webbsida ?? cf.webbplats ?? cf.site ?? cf.domain) as string | undefined
      if (websiteField) targetUrl = normaliseUrl(String(websiteField))
      else if (contact?.email) {
        const domain = String(contact.email).split('@')[1]
        if (domain && !isFreeEmail(domain)) targetUrl = `https://${domain}`
      }
    }

    await supabase.from('generated_sites').update({ status: 'auditing', source_url: targetUrl }).eq('id', generated_site_id)

    if (!targetUrl) {
      // No site to audit — score = 0, needs full generation
      await supabase.from('generated_sites').update({
        status: 'audited',
        audit_score: 0,
        audit_reason: 'No existing website found — needs full generation.',
      }).eq('id', generated_site_id)
      return json({ score: 0, reason: 'no site' })
    }

    const fcKey = Deno.env.get('FIRECRAWL_API_KEY')
    if (!fcKey) return json({ error: 'FIRECRAWL_API_KEY not configured' }, 500)
    const openrouterKey = Deno.env.get('OPENROUTER_API_KEY')
    if (!openrouterKey) return json({ error: 'OPENROUTER_API_KEY missing' }, 500)

    // Same screenshot-first rubric as the outreach pipeline.
    const { data: contactRow } = await supabase
      .from('contacts')
      .select('first_name, last_name, custom_fields')
      .eq('id', site.contact_id)
      .maybeSingle()
    const cfName = (contactRow?.custom_fields ?? {}) as Record<string, unknown>
    const companyName = String(
      cfName.company_name ?? cfName.company ?? cfName.foretag ?? contactRow?.first_name ?? '',
    )

    let result
    try {
      result = await auditWebsite(targetUrl, companyName, fcKey, openrouterKey)
    } catch (e) {
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: `AI audit failed: ${(e as Error).message}`.slice(0, 400),
      }).eq('id', generated_site_id)
      return json({ error: 'ai audit failed', details: (e as Error).message }, 500)
    }

    await supabase.from('generated_sites').update({
      status: 'audited',
      audit_score: result.score,
      audit_reason: result.reason?.slice(0, 500) ?? null,
      source_url: result.url,
    }).eq('id', generated_site_id)

    return json({
      score: result.score,
      reason: result.reason,
      weaknesses: result.weaknesses,
      structural: result.structural,
      cosmetic: result.cosmetic,
      uncertain: result.uncertain,
      url: result.url,
    })


  } catch (err) {
    console.error('audit-site error', err)
    return json({ error: (err as Error).message }, 500)
  }
})

// Re-score already-decided leads under the current rubric and report how the
// new score compares to the human decision. Writes nothing — this exists purely
// to check the bands before trusting them in the pipeline.
async function calibrate(leadIds: string[]): Promise<Response> {
  const fcKey = Deno.env.get('FIRECRAWL_API_KEY')
  const openrouterKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!fcKey || !openrouterKey) return json({ error: 'missing FIRECRAWL_API_KEY or OPENROUTER_API_KEY' }, 500)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { data: leads, error } = await supabase
    .from('site_leads')
    .select('id, company_name, website, status, audit_score')
    .in('id', leadIds.slice(0, 40))
  if (error) return json({ error: error.message }, 500)

  const results: unknown[] = []
  let agree = 0
  let scored = 0

  let first = true
  for (const lead of leads ?? []) {
    if (!lead.website) continue
    // Stay under Firecrawl's per-minute cap: a burst here starves the live pipeline.
    if (!first) await new Promise((r) => setTimeout(r, 2000))
    first = false
    try {
      const r = await auditWebsite(lead.website, lead.company_name ?? '', fcKey, openrouterKey)

      // audit_score is website quality: high means the current site is good.
      // Human decision: parked means "good enough", anything built means the
      // current website quality was low enough to justify a redesign.
      const humanWontBuy = lead.status === 'site_good_enough'
      const modelWontBuy = r.score >= 7
      const match = humanWontBuy === modelWontBuy
      if (match) agree++
      scored++
      results.push({
        company: lead.company_name,
        website: lead.website,
        human_status: lead.status,
        old_score: lead.audit_score,
        new_score: r.score,
        structural: r.structural,
        cosmetic: r.cosmetic,
        agrees_with_human: match,
      })
    } catch (e) {
      results.push({ company: lead.company_name, error: (e as Error).message })
    }
  }

  return json({
    scored,
    agreement_pct: scored ? Math.round((agree / scored) * 100) : 0,
    results,
  })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}


function normaliseUrl(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  return `https://${s.replace(/^\/+/, '')}`
}

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com',
  'aol.com', 'me.com', 'protonmail.com', 'proton.me', 'yahoo.co.uk', 'yahoo.se',
  'hotmail.se', 'live.se', 'telia.com', 'spray.se', 'bredband.net',
])
function isFreeEmail(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.toLowerCase())
}
